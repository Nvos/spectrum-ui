import { resizeCanvasToDisplaySize } from "twgl.js";
import { POWER_NO_READING } from "./constants";
import type { RingBuffer } from "./RingBuffer";
import type { TimeCursor } from "./TimeCursor";
import type { Viewport } from "./Viewport";

// Hot magenta — never appears in SDR heat-map colormaps (black→blue→cyan→green→yellow→red)
const BORDER_OUTLINE_COLOR = "rgba(0, 0, 0, 0.75)";
const BORDER_OUTLINE_WIDTH = 4;
const BORDER_COLOR = "rgba(255, 0, 200, 0.95)";
const BORDER_WIDTH = 1.5;
const BORDER_DASH = [4, 4];
const CORNER_SIZE = 12;
const CORNER_OUTLINE_WIDTH = 5;
const CORNER_WIDTH = 2.5;

// Cap on how many single-row incremental steps are worth replaying before a
// full rescan is cheaper (e.g. after the tab was hidden for a while).
const MAX_INCREMENTAL_CATCHUP = 32;

type Group = { startBin: number; endBin: number };

/**
 * A run of consecutive rows sharing the same bin extent, in **absolute** row
 * indices. Absolute indices remove the modular arithmetic entirely and let a
 * block describe rows outside the current display window — which it must, now
 * that the block list spans the whole ring rather than one screen.
 */
type Block = {
  startBin: number;
  endBin: number;
  /** Newest row of the run. */
  topAbs: number;
  /** Oldest row of the run. */
  botAbs: number;
};

type VisibleRect = { xL: number; xR: number; yTop: number; yBot: number };

export class AnnotationRenderer {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private viewport!: Viewport;
  private timeCursor!: TimeCursor;
  private annBuf: RingBuffer;
  private historyRows: number;
  private displayRows = 1;
  private binCount: number;
  /** Indexed by ring slot — `rowActivity[abs % historyRows]`. */
  readonly rowActivity: Uint8Array;
  private visible: boolean;
  private cachedBlocks: Block[] = [];
  private cachedTotal = 0;
  private historicalBlocks: Block[] = [];
  private historicalKey = "";
  private profileRanges: { start: number; end: number }[] = [];
  private visibleRects: VisibleRect[] = [];

  constructor(annBuf: RingBuffer, historyRows: number, binCount: number, visible: boolean) {
    this.annBuf = annBuf;
    this.historyRows = historyRows;
    this.binCount = binCount;
    this.rowActivity = new Uint8Array(historyRows);
    this.visible = visible;

    for (let abs = annBuf.residentOldestAbs(); abs < annBuf.totalWritten; abs++) {
      const row = annBuf.rowViewAbs(abs);
      for (let b = 0; b < binCount; b++) {
        if (row[b] !== POWER_NO_READING) {
          this.rowActivity[abs % historyRows] = 1;
          break;
        }
      }
    }

    // The only full scan in the lifetime of the renderer.
    this.cachedBlocks = this.computeBlocksFull();
    this.cachedTotal = annBuf.totalWritten;
  }

  /** Records row activity only. Block topology is synced lazily in `render()`. */
  push(absRow: number, row: Int8Array) {
    let active = false;
    for (let b = 0; b < this.binCount; b++) {
      if (row[b] !== POWER_NO_READING) {
        active = true;
        break;
      }
    }
    this.rowActivity[absRow % this.historyRows] = active ? 1 : 0;
  }

  mount(canvas: HTMLCanvasElement, viewport: Viewport, timeCursor: TimeCursor) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context not available");
    this.ctx = ctx;
    this.viewport = viewport;
    this.timeCursor = timeCursor;
  }

  private activityAt(absRow: number): number {
    return this.rowActivity[absRow % this.historyRows];
  }

  private collectGroups(absRow: number): Group[] {
    const { binCount } = this;
    if (!this.annBuf.hasAbs(absRow)) return [];
    const data = this.annBuf.rowViewAbs(absRow);
    const groups: Group[] = [];
    let gs = -1;
    for (let b = 0; b <= binCount; b++) {
      const active = b < binCount && data[b] !== POWER_NO_READING;
      if (active && gs === -1) gs = b;
      else if (!active && gs !== -1) {
        groups.push({ startBin: gs, endBin: b });
        gs = -1;
      }
    }
    return groups;
  }

  setVisible(v: boolean) {
    this.visible = v;
  }

  /**
   * Display size no longer participates in block computation, so a resize is a
   * field write. Dragging a window edge stops triggering rescans entirely.
   */
  setDisplayRows(n: number) {
    this.displayRows = Math.max(1, Math.round(n));
  }

  setProfileRanges(ranges: { start: number; end: number }[]) {
    this.profileRanges = ranges;
  }

  /**
   * Full scan over the **whole ring**, newest→oldest, merging contiguous
   * same-extent groups. Scrolling means any part of the ring can become
   * visible, so blocks must exist for all of it — not just one screen.
   */
  private computeBlocksFull(): Block[] {
    return this.computeBlocksRange(
      this.annBuf.totalWritten - 1,
      this.annBuf.residentOldestAbs(),
      true,
    );
  }

  private computeBlocksRange(newest: number, oldest: number, useActivity: boolean): Block[] {
    type OpenBlock = { startBin: number; endBin: number; topAbs: number; curAbs: number };
    const blocks: Block[] = [];
    let open: OpenBlock[] = [];

    for (let abs = newest; abs >= oldest; abs--) {
      const groups = (!useActivity || this.activityAt(abs)) ? this.collectGroups(abs) : [];

      const nextOpen: OpenBlock[] = [];
      for (const ob of open) {
        if (groups.some((g) => g.startBin === ob.startBin && g.endBin === ob.endBin)) {
          nextOpen.push({ ...ob, curAbs: abs });
        } else {
          blocks.push({
            startBin: ob.startBin,
            endBin: ob.endBin,
            topAbs: ob.topAbs,
            botAbs: ob.curAbs,
          });
        }
      }
      for (const g of groups) {
        if (!nextOpen.some((ob) => ob.startBin === g.startBin && ob.endBin === g.endBin)) {
          nextOpen.push({ startBin: g.startBin, endBin: g.endBin, topAbs: abs, curAbs: abs });
        }
      }
      open = nextOpen;
    }

    for (const ob of open) {
      blocks.push({
        startBin: ob.startBin,
        endBin: ob.endBin,
        topAbs: ob.topAbs,
        botAbs: ob.curAbs,
      });
    }

    return blocks;
  }

  /**
   * Extend / trim / create blocks for the single row that made `totalWritten`
   * become `targetTotal`.
   *
   * In absolute terms the whole thing collapses to three comparisons — there is
   * no ring wrap to reason about and no dependence on the display size:
   *
   *   • `topAbs === newAbs - 1`  → block is open, may be extended by the new row
   *   • `topAbs < oldest`        → block has expired entirely, drop it
   *   • `botAbs < oldest`        → block's tail has expired, trim it to `oldest`
   */
  private computeBlocksIncremental(targetTotal: number): Block[] {
    const newAbs = targetTotal - 1;
    const prevAbs = newAbs - 1;
    const oldest = this.annBuf.residentOldestAbs(targetTotal);
    const newGroups = this.activityAt(newAbs) ? this.collectGroups(newAbs) : [];
    const matchedGroupIdx = new Set<number>();
    const blocks: Block[] = [];

    for (const block of this.cachedBlocks) {
      // A block is "open" only if its top is the immediately preceding newest row.
      // Extending a closed block (gap in signal) would merge separate appearances into one.
      const isOpen = block.topAbs === prevAbs;
      const gi = isOpen
        ? newGroups.findIndex((g) => g.startBin === block.startBin && g.endBin === block.endBin)
        : -1;
      const matched = gi !== -1;
      if (matched) matchedGroupIdx.add(gi);

      const topAbs = matched ? newAbs : block.topAbs;
      if (topAbs < oldest) continue; // wholly expired
      const botAbs = Math.max(block.botAbs, oldest);

      blocks.push(
        topAbs === block.topAbs && botAbs === block.botAbs ? block : { ...block, topAbs, botAbs },
      );
    }

    for (let i = 0; i < newGroups.length; i++) {
      if (!matchedGroupIdx.has(i)) {
        const g = newGroups[i];
        blocks.push({ startBin: g.startBin, endBin: g.endBin, topAbs: newAbs, botAbs: newAbs });
      }
    }

    return blocks;
  }

  // Recompute block topology only when rows have been written. Between writes
  // (zoom / pan / scroll renders) the ring contents are unchanged so the cached
  // result is still valid — scrolling costs nothing here.
  private syncBlocks() {
    const T = this.annBuf.totalWritten;
    const delta = T - this.cachedTotal;
    if (delta === 0) return;
    if (delta > 0 && delta <= MAX_INCREMENTAL_CATCHUP) {
      for (let t = this.cachedTotal + 1; t <= T; t++) {
        this.cachedBlocks = this.computeBlocksIncremental(t);
      }
    } else {
      this.cachedBlocks = this.computeBlocksFull();
    }
    this.cachedTotal = T;
  }

  render = () => {
    const { canvas, ctx, viewport, binCount } = this;
    if (!canvas) return;

    resizeCanvasToDisplaySize(canvas, window.devicePixelRatio || 1);
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const { start, end } = viewport;

    if (this.profileRanges.length > 0) {
      const span = end - start;
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(59, 130, 246, 0.12)";
      for (const r of this.profileRanges) {
        const xL = ((r.start - start) / span) * width;
        ctx.fillRect(xL, 0, ((r.end - start) / span) * width - xL, height);
      }
      ctx.strokeStyle = "rgba(59, 130, 246, 0.5)";
      ctx.lineWidth = 1;
      for (const r of this.profileRanges) {
        const xL = ((r.start - start) / span) * width;
        const xR = ((r.end - start) / span) * width;
        ctx.beginPath();
        ctx.moveTo(xL, 0); ctx.lineTo(xL, height);
        ctx.moveTo(xR, 0); ctx.lineTo(xR, height);
        ctx.stroke();
      }
    }

    if (!this.visible) return;

    const D = this.displayRows;
    const anchor = this.timeCursor.anchorRow;
    const bottomAbs = anchor - D + 1;
    const historical = bottomAbs < this.annBuf.residentOldestAbs();
    let blocks: Block[];
    if (historical) {
      const key = `${anchor}:${D}:${this.annBuf.historyVersion}`;
      if (key !== this.historicalKey) {
        this.historicalBlocks = this.computeBlocksRange(
          anchor,
          Math.max(this.annBuf.oldestAbs(), bottomAbs),
          false,
        );
        this.historicalKey = key;
      }
      blocks = this.historicalBlocks;
    } else {
      this.syncBlocks();
      blocks = this.cachedBlocks;
    }

    const binToX = (bin: number) => ((bin / binCount - start) / (end - start)) * width;

    // With N >> D most blocks are off-screen, and the draw below walks the list
    // four times. Cull once, then run the passes over the survivors.
    const rects = this.visibleRects;
    rects.length = 0;
    for (const block of blocks) {
      if (block.topAbs < bottomAbs || block.botAbs > anchor) continue;
      const ageTop = Math.max(0, anchor - block.topAbs);
      const ageBot = anchor - block.botAbs;
      rects.push({
        xL: binToX(block.startBin),
        xR: binToX(block.endBin),
        yTop: Math.round((ageTop * height) / D),
        yBot: Math.round(((ageBot + 1) * height) / D),
      });
    }

    if (rects.length === 0) return;

    // Dashed border: dark outline pass then magenta on top.
    ctx.setLineDash(BORDER_DASH);
    ctx.strokeStyle = BORDER_OUTLINE_COLOR;
    ctx.lineWidth = BORDER_OUTLINE_WIDTH;
    for (const { xL, xR, yTop, yBot } of rects) {
      ctx.beginPath();
      ctx.rect(xL, yTop, xR - xL, yBot - yTop);
      ctx.stroke();
    }
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = BORDER_WIDTH;
    for (const { xL, xR, yTop, yBot } of rects) {
      ctx.beginPath();
      ctx.rect(xL, yTop, xR - xL, yBot - yTop);
      ctx.stroke();
    }

    // Solid corner marks: L-shapes at all four corners, same double-stroke.
    // Corner arm length is clamped to half the block dimensions so they stay
    // proportional when the block is small (zoomed out).
    const cornerPaths = (xL: number, xR: number, yTop: number, yBot: number) => {
      const C = Math.min(CORNER_SIZE, (xR - xL) / 2, (yBot - yTop) / 2);
      ctx.beginPath();
      ctx.moveTo(xL + C, yTop);
      ctx.lineTo(xL, yTop);
      ctx.lineTo(xL, yTop + C);
      ctx.moveTo(xR - C, yTop);
      ctx.lineTo(xR, yTop);
      ctx.lineTo(xR, yTop + C);
      ctx.moveTo(xL + C, yBot);
      ctx.lineTo(xL, yBot);
      ctx.lineTo(xL, yBot - C);
      ctx.moveTo(xR - C, yBot);
      ctx.lineTo(xR, yBot);
      ctx.lineTo(xR, yBot - C);
    };
    ctx.setLineDash([]);
    ctx.strokeStyle = BORDER_OUTLINE_COLOR;
    ctx.lineWidth = CORNER_OUTLINE_WIDTH;
    for (const { xL, xR, yTop, yBot } of rects) {
      cornerPaths(xL, xR, yTop, yBot);
      ctx.stroke();
    }
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = CORNER_WIDTH;
    for (const { xL, xR, yTop, yBot } of rects) {
      cornerPaths(xL, xR, yTop, yBot);
      ctx.stroke();
    }
  };
}
