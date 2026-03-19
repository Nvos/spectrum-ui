import { resizeCanvasToDisplaySize } from "twgl.js";
import { POWER_NO_READING } from "./constants";
import type { RingBuffer } from "./RingBuffer";
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

type Group = { startBin: number; endBin: number };
type Block = {
  startBin: number;
  endBin: number;
  topRowIdx: number;
  botRowIdx: number;
};

export class AnnotationManager {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private viewport!: Viewport;
  private annBuf: RingBuffer;
  private rowCount: number;
  private binCount: number;
  readonly rowActivity: Uint8Array;
  private visible = true;
  private unsubscribe: () => void;
  private cachedBlocks: Block[] = [];
  private cachedWriteRow = -1;

  constructor(
    annBuf: RingBuffer,
    rowCount: number,
    binCount: number,
  ) {
    this.annBuf = annBuf;
    this.rowCount = rowCount;
    this.binCount = binCount;
    this.rowActivity = new Uint8Array(rowCount);

    for (let r = 0; r < rowCount; r++) {
      const offset = r * binCount;
      for (let b = 0; b < binCount; b++) {
        if (annBuf.data[offset + b] !== POWER_NO_READING) {
          this.rowActivity[r] = 1;
          break;
        }
      }
    }

    this.unsubscribe = annBuf.subscribe((uploadRow) => {
      const offset = uploadRow * binCount;
      let active = false;
      for (let b = 0; b < binCount; b++) {
        if (annBuf.data[offset + b] !== POWER_NO_READING) { active = true; break; }
      }
      this.rowActivity[uploadRow] = active ? 1 : 0;
    });
  }

  destroy() {
    this.unsubscribe();
  }

  mount(canvas: HTMLCanvasElement, viewport: Viewport) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context not available");
    this.ctx = ctx;
    this.viewport = viewport;
  }

  private collectGroups(rowIdx: number): Group[] {
    const { binCount, annBuf } = this;
    const data = annBuf.data;
    const offset = rowIdx * binCount;
    const groups: Group[] = [];
    let gs = -1;
    for (let b = 0; b <= binCount; b++) {
      const active = b < binCount && data[offset + b] !== POWER_NO_READING;
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

  render = () => {
    const { canvas, ctx, viewport, rowCount, binCount } = this;
    if (!canvas) return;
    if (!this.visible) {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      return;
    }

    resizeCanvasToDisplaySize(canvas, window.devicePixelRatio || 1);
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const writeRow = this.annBuf.writeRow;

    // Same pixel-snapped Y calculation as WaterfallManager
    const pixelSize = 2.0 / height;
    const rawTranslation = 2.0 - writeRow * (2.0 / rowCount);
    const uT = Math.round(rawTranslation / pixelSize) * pixelSize;
    const rowH = 2.0 / rowCount;

    const clipToScreenY = (clipY: number) => ((1 - clipY) / 2) * height;
    const rowTopY = (i: number) => clipToScreenY(-1 + (i + 1) * rowH + uT);
    const rowBotY = (i: number) => clipToScreenY(-1 + i * rowH + uT);

    const { start, end } = viewport;
    const binToX = (bin: number) => ((bin / binCount - start) / (end - start)) * width;

    // Recompute block topology only when a new row has been written.
    // Between writes (e.g. zoom/pan renders) the ring-buffer contents are
    // unchanged so the cached result is still valid.
    if (writeRow !== this.cachedWriteRow) {
      type OpenBlock = Block & { curRowIdx: number };
      const completedBlocks: Block[] = [];
      let open: OpenBlock[] = [];

      for (let di = 0; di < rowCount; di++) {
        const rowIdx = (writeRow - 1 - di + rowCount * 2) % rowCount;
        const groups = this.rowActivity[rowIdx] ? this.collectGroups(rowIdx) : [];

        const nextOpen: OpenBlock[] = [];
        for (const ob of open) {
          if (groups.some((g) => g.startBin === ob.startBin && g.endBin === ob.endBin)) {
            nextOpen.push({ ...ob, curRowIdx: rowIdx });
          } else {
            completedBlocks.push({
              startBin: ob.startBin,
              endBin: ob.endBin,
              topRowIdx: ob.topRowIdx,
              botRowIdx: ob.curRowIdx,
            });
          }
        }
        for (const g of groups) {
          if (!nextOpen.some((ob) => ob.startBin === g.startBin && ob.endBin === g.endBin)) {
            nextOpen.push({
              startBin: g.startBin,
              endBin: g.endBin,
              topRowIdx: rowIdx,
              botRowIdx: rowIdx,
              curRowIdx: rowIdx,
            });
          }
        }
        open = nextOpen;
      }

      for (const ob of open) {
        completedBlocks.push({
          startBin: ob.startBin,
          endBin: ob.endBin,
          topRowIdx: ob.topRowIdx,
          botRowIdx: ob.curRowIdx,
        });
      }

      this.cachedBlocks = completedBlocks;
      this.cachedWriteRow = writeRow;
    }

    const completedBlocks = this.cachedBlocks;

    if (completedBlocks.length === 0) return;

    // Resolve block geometry into screen coordinates, handling the two-copy ring-buffer
    // layout and cross-wrap case. Calls fn(xL, xR, yTop, yBot) for each visible rect.
    const forEachBlockRect = (
      block: Block,
      fn: (xL: number, xR: number, yTop: number, yBot: number) => void,
    ) => {
      const yTopF = rowTopY(block.topRowIdx);
      const yBotF = rowBotY(block.botRowIdx);
      const xL = binToX(block.startBin);
      const xR = binToX(block.endBin);

      if (yBotF >= yTopF) {
        for (const yOffset of [0, height]) {
          if (yOffset === height && yTopF >= 0) continue;
          if (yOffset === 0 && yBotF <= 0) continue;
          const yTop = yTopF + yOffset;
          const yBot = yBotF + yOffset;
          if (yTop > height + 2 || yBot < -2) continue;
          fn(xL, xR, yTop, yBot);
        }
      } else {
        const yTop = yTopF;
        const yBot = yBotF + height;
        if (yTop <= height + 2 && yBot >= -2) fn(xL, xR, yTop, yBot);
      }
    };

    // Dashed border: dark outline pass then magenta on top.
    ctx.setLineDash(BORDER_DASH);
    ctx.strokeStyle = BORDER_OUTLINE_COLOR;
    ctx.lineWidth = BORDER_OUTLINE_WIDTH;
    for (const block of completedBlocks) {
      forEachBlockRect(block, (xL, xR, yTop, yBot) => {
        ctx.beginPath();
        ctx.rect(xL, yTop, xR - xL, yBot - yTop);
        ctx.stroke();
      });
    }
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = BORDER_WIDTH;
    for (const block of completedBlocks) {
      forEachBlockRect(block, (xL, xR, yTop, yBot) => {
        ctx.beginPath();
        ctx.rect(xL, yTop, xR - xL, yBot - yTop);
        ctx.stroke();
      });
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
    for (const block of completedBlocks) {
      forEachBlockRect(block, (xL, xR, yTop, yBot) => {
        cornerPaths(xL, xR, yTop, yBot);
        ctx.stroke();
      });
    }
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = CORNER_WIDTH;
    for (const block of completedBlocks) {
      forEachBlockRect(block, (xL, xR, yTop, yBot) => {
        cornerPaths(xL, xR, yTop, yBot);
        ctx.stroke();
      });
    }
  };
}
