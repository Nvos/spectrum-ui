import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { Band } from "./BandTypes";
import * as coreStyles from "./styles.css";
import { font } from "../tokens";

const ROW_HEIGHT_PX = 22;
const ROW_PADDING_PX = 2;
const MIN_LABEL_PX = 50;
const OVERFLOW_ALPHA = 0.5;

type Assignment = { band: Band; row: number; overflow: boolean; normStart: number; normEnd: number };
type PoolItem = { el: HTMLDivElement; label: HTMLSpanElement };

const assignRows = (bands: Band[], freqStart: number, freqEnd: number, numRows: number): Assignment[] => {
  const span = freqEnd - freqStart;
  const sorted = [...bands].sort((a, b) => a.freqStartMHz - b.freqStartMHz);
  const rowEnds: number[] = [];
  const result: Assignment[] = [];

  for (const band of sorted) {
    const normStart = (band.freqStartMHz - freqStart) / span;
    const normEnd = (band.freqEndMHz - freqStart) / span;
    let assigned = false;

    for (let r = 0; r < rowEnds.length; r++) {
      if (normStart >= rowEnds[r]) {
        rowEnds[r] = normEnd;
        result.push({ band, row: r, overflow: false, normStart, normEnd });
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      if (rowEnds.length < numRows) {
        const r = rowEnds.length;
        rowEnds.push(normEnd);
        result.push({ band, row: r, overflow: false, normStart, normEnd });
      } else {
        result.push({ band, row: numRows - 1, overflow: true, normStart, normEnd });
      }
    }
  }

  return result;
};

export class BandController {
  private freqStart: number;
  private freqEnd: number;
  private numRows: number;
  private container: HTMLElement | null = null;
  private tooltip: HTMLDivElement | null = null;
  private pool: PoolItem[] = [];
  private assignments: Assignment[] = [];

  constructor(freqStartMHz: number, freqEndMHz: number, numRows = 2) {
    this.freqStart = freqStartMHz;
    this.freqEnd = freqEndMHz;
    this.numRows = numRows;
  }

  mount(container: HTMLElement, tooltip: HTMLDivElement) {
    this.container = container;
    this.tooltip = tooltip;
    container.style.cssText = `position:relative;height:${this.numRows * ROW_HEIGHT_PX}px;overflow:hidden;`;
  }

  setBands(bands: Band[]) {
    this.assignments = assignRows(bands, this.freqStart, this.freqEnd, this.numRows);
  }

  update(viewStart: number, viewEnd: number) {
    const container = this.container;
    if (!container) return;

    const { assignments, pool } = this;
    const viewSpan = viewEnd - viewStart;
    const containerWidth = container.clientWidth;

    while (pool.length < assignments.length) {
      pool.push(this.createItem(container));
    }

    assignments.forEach(({ band, row, overflow, normStart, normEnd }, i) => {
      const item = pool[i];
      this.syncItem(item, band);
      const { el, label } = item;

      const leftNorm = (normStart - viewStart) / viewSpan;
      const rightNorm = (normEnd - viewStart) / viewSpan;

      if (rightNorm <= 0 || leftNorm >= 1) {
        el.style.display = "none";
        return;
      }

      const leftPct = Math.max(0, leftNorm) * 100;
      const rightPct = Math.min(1, rightNorm) * 100;
      const pixelWidth = (Math.min(1, rightNorm) - Math.max(0, leftNorm)) * containerWidth;
      const top = row * ROW_HEIGHT_PX + ROW_PADDING_PX;

      el.style.display = "";
      el.style.left = `${leftPct}%`;
      el.style.width = `${rightPct - leftPct}%`;
      el.style.top = `${top}px`;
      el.style.opacity = overflow ? String(OVERFLOW_ALPHA) : "1";
      el.style.borderStyle = overflow ? "dashed" : "solid";
      label.style.visibility = pixelWidth < MIN_LABEL_PX ? "hidden" : "visible";
    });

    for (let i = assignments.length; i < pool.length; i++) {
      pool[i].el.style.display = "none";
    }
  }

  private createItem(container: HTMLElement): PoolItem {
    const itemHeight = ROW_HEIGHT_PX - ROW_PADDING_PX * 2;
    const el = document.createElement("div");

    el.style.cssText = [
      "position:absolute",
      `height:${itemHeight}px`,
      "box-sizing:border-box",
      "border-radius:2px",
      "border-width:1px",
      "border-style:solid",
      "overflow:hidden",
      "cursor:default",
    ].join(";");

    const label = document.createElement("span");
    label.style.cssText = [
      "position:absolute",
      "inset:0",
      "display:block",
      `line-height:${itemHeight}px`,
      "font-size:10px",
      `font-family:${font.mono}`,
      "color:rgba(255,255,255,0.9)",
      "text-shadow:0 1px 2px rgba(0,0,0,0.9),0 -1px 2px rgba(0,0,0,0.9)",
      "overflow:hidden",
      "white-space:nowrap",
      "text-overflow:ellipsis",
      "pointer-events:none",
      "padding:0 4px",
    ].join(";");

    el.append(label);
    container.append(el);

    el.addEventListener("mouseenter", () => this.showTooltip(el));
    el.addEventListener("mouseleave", () => this.hideTooltip());

    return { el, label };
  }

  private syncItem(item: PoolItem, band: Band) {
    item.el.style.backgroundColor = `color-mix(in srgb, ${band.color} 25%, transparent)`;
    item.el.style.borderColor = `color-mix(in srgb, ${band.color} 80%, transparent)`;
    item.label.textContent = band.name;
  }

  private showTooltip(anchor: HTMLElement) {
    const tt = this.tooltip;
    if (!tt) return;

    const idx = this.pool.findIndex((p) => p.el === anchor);
    if (idx === -1) return;
    const assignment = this.assignments[idx];
    if (!assignment) return;

    const { band } = assignment;
    const cell = (l: string, v: string) =>
      `<span class="${coreStyles.tooltipLabel}">${l}</span><span>${v}</span>`;

    tt.innerHTML =
      cell("name", band.name) +
      cell("range", `${band.freqStartMHz.toFixed(3)} – ${band.freqEndMHz.toFixed(3)} MHz`);

    tt.style.display = "grid";

    computePosition(anchor, tt, {
      placement: "top",
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      tt.style.left = `${x}px`;
      tt.style.top = `${y}px`;
    });
  }

  private hideTooltip() {
    if (this.tooltip) this.tooltip.style.display = "none";
  }

  destroy() {
    this.hideTooltip();
    for (const { el } of this.pool) el.remove();
    this.pool = [];
    this.container = null;
    this.tooltip = null;
  }
}
