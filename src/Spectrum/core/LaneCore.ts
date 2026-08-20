import * as styles from "./styles.css";
import { Viewport } from "./Viewport";
import { WaterfallRenderer } from "./WaterfallRenderer";
import type { RingBuffer } from "./RingBuffer";
import type { TimeCursor } from "./TimeCursor";

export type LaneSettings = {
  displayMin: number;
  displayMax: number;
  colormap: number;
};

/**
 * One frequency lane — a narrow, full-height waterfall column pinned beside the
 * main view, showing a single frequency range at the main view's time position.
 *
 * A lane is deliberately *less* than a subview: no live trace, no occupancy, no
 * frequency or power axis, no `InputHandler`, no `ResizeObserver`, and no
 * `Viewport` mutation after construction. It is one cropped
 * {@link WaterfallRenderer} and nothing else, which is what makes an extra lane
 * cost ~96px of width instead of a miniature application.
 *
 * Two invariants carry the whole design:
 *
 * 1. The {@link TimeCursor} is the main view's **shared** instance, never a
 *    copy. Time alignment across columns is the entire point of the form.
 * 2. `D` is pushed in from `SpectrumCore`, measured once off the main waterfall
 *    canvas. A lane must never measure its own canvas: a one-pixel layout
 *    difference would drift its rows out of step with the main view, subtly,
 *    and worst while scrolled back.
 */
export class LaneCore {
  /** Bins actually stored and drawn. Surfaced so the label can state the resolution. */
  readonly binSpan: number;

  private readonly buffer: RingBuffer;
  private readonly historyRows: number;
  private readonly binCount: number;
  private readonly normalizedStart: number;
  private readonly normalizedEnd: number;
  private readonly settings: LaneSettings;
  private readonly timeCursor: TimeCursor;
  private readonly binStart: number;

  private renderer: WaterfallRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private displayRows = 1;
  /** A colormap change that arrived before mount, applied once the renderer exists. */
  private pendingLut: Uint8Array | null = null;

  constructor(
    buffer: RingBuffer,
    historyRows: number,
    binCount: number,
    normalizedStart: number,
    normalizedEnd: number,
    settings: LaneSettings,
    timeCursor: TimeCursor,
  ) {
    this.buffer = buffer;
    this.historyRows = historyRows;
    this.binCount = binCount;
    this.settings = { ...settings };
    this.timeCursor = timeCursor;

    // A range can arrive from a dragged profile marker or a hand-typed
    // frequency, so it may sit partly or wholly outside the capture. Clamp to a
    // non-empty sub-range rather than throwing: a lane that shows blank is
    // recoverable, a lane that throws takes the render loop down with it.
    const lo = Math.min(normalizedStart, normalizedEnd);
    const hi = Math.max(normalizedStart, normalizedEnd);
    this.normalizedStart = Math.min(Math.max(lo, 0), 1);
    this.normalizedEnd = Math.max(Math.min(hi, 1), this.normalizedStart);

    // Crop arithmetic, identical to a subview's: the lane can never display a
    // bin outside its range, so the texture stores only those bins and holds
    // the full ring depth in a few hundred KB.
    this.binStart = Math.max(0, Math.min(binCount - 1, Math.floor(this.normalizedStart * binCount)));
    const binEnd = Math.max(this.binStart + 1, Math.min(binCount, Math.ceil(this.normalizedEnd * binCount)));
    this.binSpan = binEnd - this.binStart;
  }

  /**
   * Create this lane's canvas inside `host` and start rendering into it.
   *
   * A lane owns its canvas rather than borrowing one from React. Re-tuning a
   * lane destroys it and builds a new one over the same host, and `destroy()`
   * deliberately loses the old GL context -- but `getContext` on an element
   * whose context was lost returns that same lost context, not a fresh one. A
   * canvas per lane instance makes "new lane, new context" true by
   * construction, and keeps context release in one place.
   *
   * `host` must be a positioned, full-height box: the canvas fills it exactly,
   * which is what keeps a lane row-aligned with the main waterfall.
   */
  mount(host: HTMLElement) {
    const canvas = document.createElement("canvas");
    canvas.className = styles.laneCanvas;
    host.appendChild(canvas);

    // Frozen for life: constructed clamped to the range and panned onto it, with
    // no InputHandler ever attached. A lane shows its whole range, always.
    const viewport = new Viewport(this.binCount, canvas, 12, this.normalizedStart, this.normalizedEnd);
    viewport.panTo(this.normalizedStart, this.normalizedEnd);

    const renderer = new WaterfallRenderer(this.historyRows, this.binCount, this.buffer, {
      displayMin: this.settings.displayMin,
      displayMax: this.settings.displayMax,
      colormap: this.settings.colormap,
      binStart: this.binStart,
      binSpan: this.binSpan,
    });
    renderer.mount(canvas, viewport, this.timeCursor);
    renderer.setDisplayRows(this.displayRows);

    this.canvas = canvas;
    this.renderer = renderer;
    if (this.pendingLut) {
      renderer.updateColormap(this.pendingLut);
      this.pendingLut = null;
    }
  }

  /** Takes the same full `specRow` the main renderer gets; the crop happens inside. */
  push(absRow: number, specRow: Int8Array) {
    this.renderer?.push(absRow, specRow);
  }

  /** `D` comes from the main waterfall. See the class comment — never measure here. */
  setDisplayRows(d: number) {
    this.displayRows = Math.max(1, Math.round(d));
    this.renderer?.setDisplayRows(this.displayRows);
  }

  updateColormap(lut: Uint8Array) {
    if (!this.renderer) {
      this.pendingLut = lut;
      return;
    }
    this.renderer.updateColormap(lut);
  }

  updateDisplayMin(v: number) {
    this.settings.displayMin = v;
    this.renderer?.updateDisplayMin(v);
  }

  updateDisplayMax(v: number) {
    this.settings.displayMax = v;
    this.renderer?.updateDisplayMax(v);
  }

  render() {
    this.renderer?.render();
  }

  /**
   * Lanes are added and removed while the app runs, so the GL context has to go
   * back with them. Browsers cap live WebGL contexts (Chrome around 16) and
   * silently drop the oldest past the cap, which presents as an unrelated pane
   * turning black — a leak here is invisible until it breaks something else.
   */
  destroy() {
    const gl = this.renderer?.ctx;
    this.renderer?.destroy();
    this.renderer = null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas?.remove();
    this.canvas = null;
  }
}
