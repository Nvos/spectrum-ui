import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { Band } from "./BandTypes";
import { BAND_COLORS } from "./BandTypes";
import * as coreStyles from "./styles.css";
import { font } from "../tokens";

const ROW_HEIGHT_PX = 22;
const ROW_PADDING_PX = 2;
const MIN_LABEL_PX = 50;
const OVERFLOW_ALPHA = 0.5;

type Assignment = { band: Band; row: number; overflow: boolean; normStart: number; normEnd: number; parentId?: string };
type PoolItem = { el: HTMLDivElement; label: HTMLSpanElement };

const assignRows = (bands: Band[], freqStart: number, freqEnd: number, numRows: number): Assignment[] => {
  const span = freqEnd - freqStart;
  const sorted = [...bands].sort((a, b) => a.freqStartMHz - b.freqStartMHz);
  const rowEnds: number[] = [];
  const result: Assignment[] = [];

  for (const band of sorted) {
    const normStart = (band.freqStartMHz - freqStart) / span;
    const normEnd = (band.freqEndMHz - freqStart) / span;
    let row = numRows - 1;
    let overflow = false;
    let placed = false;

    for (let r = 0; r < rowEnds.length; r++) {
      if (normStart >= rowEnds[r]) {
        rowEnds[r] = normEnd;
        row = r;
        placed = true;
        break;
      }
    }

    if (!placed) {
      if (rowEnds.length < numRows) {
        row = rowEnds.length;
        rowEnds.push(normEnd);
      } else {
        overflow = true;
      }
    }

    result.push({ band, row, overflow, normStart, normEnd });

    if (band.children?.length) {
      for (const child of band.children) {
        const cNormStart = (child.freqStartMHz - freqStart) / span;
        const cNormEnd = (child.freqEndMHz - freqStart) / span;
        result.push({ band: child, row, overflow: false, normStart: cNormStart, normEnd: cNormEnd, parentId: band.id });
      }
    }
  }

  return result;
};

export class BandController {
  onHover?: (range: { normStart: number; normEnd: number } | null) => void;

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

    // Compute per-assignment label constraints based on visual stacking order.
    // A label is only readable if it starts in an uncovered region and has enough
    // width before the next covering band. Two cases handled generically:
    //   1. Covered from the right: another band starts within this band's range
    //      → label is constrained to the gap before that band's left edge.
    //   2. Covered from the left: another band starts at or before this band and
    //      extends into it → label text would begin invisible → force gap = 0.
    //
    // Z-order tiers: overflow = 0 (behind), normal = 1, children = 2 (on top).
    const zLevel = (a: Assignment): number => (a.overflow ? 0 : a.parentId != null ? 2 : 1);
    const labelConstraints = new Map<number, number>(); // index → constraining leftNorm

    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i];
      const az = zLevel(a);
      const aLeft = (a.normStart - viewStart) / viewSpan;
      const aRight = (a.normEnd - viewStart) / viewSpan;
      let minC = Infinity;

      for (let j = 0; j < assignments.length; j++) {
        if (i === j) continue;
        const b = assignments[j];
        if (b.row !== a.row) continue;
        const bz = zLevel(b);
        if (!(bz > az || (bz === az && j > i))) continue; // b must render on top of a

        const bLeft = (b.normStart - viewStart) / viewSpan;
        const bRight = (b.normEnd - viewStart) / viewSpan;

        if (bLeft <= aLeft && bRight > aLeft) {
          // Covered from the left: text would start hidden → force gap = 0
          minC = aLeft;
          break;
        }
        if (bLeft > aLeft && bLeft < Math.min(aRight, 1.0)) {
          minC = Math.min(minC, bLeft);
        }
      }

      if (minC < Infinity) labelConstraints.set(i, minC);
    }

    assignments.forEach(({ band, row, overflow, normStart, normEnd, parentId }, i) => {
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
      el.style.zIndex = overflow ? "0" : parentId != null ? "2" : "1";
      el.style.opacity = overflow ? String(OVERFLOW_ALPHA) : "1";
      el.style.borderStyle = overflow ? "dashed" : "solid";

      const constraintLeft = labelConstraints.get(i);
      let showLabel: boolean;
      let labelWidth = "";

      if (constraintLeft !== undefined) {
        const visibleLeft = Math.max(0, leftNorm);
        const gapPx = Math.max(0, constraintLeft - visibleLeft) * containerWidth;
        showLabel = gapPx >= MIN_LABEL_PX;
        if (showLabel) labelWidth = `${gapPx}px`;
      } else {
        showLabel = pixelWidth >= MIN_LABEL_PX;
      }

      label.style.visibility = showLabel ? "visible" : "hidden";
      label.style.width = labelWidth;
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
    const hex = BAND_COLORS[band.color];
    item.el.style.backgroundColor = `color-mix(in srgb, ${hex} 25%, transparent)`;
    item.el.style.borderColor = `color-mix(in srgb, ${hex} 80%, transparent)`;
    item.label.textContent = band.name;
  }

  private showTooltip(anchor: HTMLElement) {
    const tt = this.tooltip;
    if (!tt) return;

    const idx = this.pool.findIndex((p) => p.el === anchor);
    if (idx === -1) return;
    const a = this.assignments[idx];
    if (!a) return;

    const { band, normStart, normEnd, parentId } = a;

    this.onHover?.({ normStart, normEnd });

    const cell = (l: string, v: string, muted = false) =>
      `<span class="${coreStyles.tooltipLabel}"${muted ? ' style="opacity:0.55"' : ""}>${l}</span>` +
      `<span${muted ? ' style="opacity:0.55"' : ""}>${v}</span>`;

    let html =
      cell("name", band.name) +
      cell("range", `${band.freqStartMHz.toFixed(3)} – ${band.freqEndMHz.toFixed(3)} MHz`);

    const overlapping = this.assignments.filter((other, i) =>
      i !== idx && !(other.normEnd <= normStart || other.normStart >= normEnd)
    );

    const contextRows: string[] = [];

    if (parentId) {
      const parent = overlapping.find((o) => o.band.id === parentId);
      if (parent) contextRows.push(cell("part of", parent.band.name));
    }

    for (const other of overlapping) {
      if (other.band.id === parentId || other.parentId === band.id) continue;
      contextRows.push(cell("overlaps", other.band.name, true));
    }

    if (contextRows.length > 0) {
      html += `<span class="${coreStyles.tooltipDivider}"></span>` + contextRows.join("");
    }

    tt.innerHTML = html;
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
    this.onHover?.(null);
  }

  destroy() {
    this.hideTooltip();
    for (const { el } of this.pool) el.remove();
    this.pool = [];
    this.container = null;
    this.tooltip = null;
  }
}
