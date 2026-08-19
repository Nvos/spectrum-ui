import {
  type BufferInfo,
  createBufferInfoFromArrays,
  createProgramInfo,
  createTexture,
  drawBufferInfo,
  type ProgramInfo,
  resizeCanvasToDisplaySize,
  setBuffersAndAttributes,
  setUniforms,
} from "twgl.js";
import { buildLUT, COLORMAPS, LUT_SIZE } from "./colormaps";
import { POWER_NO_READING } from "./constants";
import { RingBuffer } from "./RingBuffer";
import { TimeCursor } from "./TimeCursor";
import { Viewport } from "./Viewport";

export type WaterfallSettings = {
  displayMin: number;
  displayMax: number;
  colormap: number;
  /** First bin stored in the texture. Subviews crop; the main view uses 0. */
  binStart?: number;
  /** Bins stored in the texture. Subviews crop; the main view uses `binCount`. */
  binSpan?: number;
};

// Colour painted where no row exists — above the write head, or past the
// oldest retained row.
const BLANK_COLOR = [0.039, 0.039, 0.039];

// One full-screen quad. Row addressing happens per-fragment, so there is no
// geometry to rebuild when the pane resizes or the view scrolls.
const vs = `#version 300 es
in vec2 aPosition;
out vec2 vUV;

void main() {
    vUV = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// The texture IS the ring buffer, uHistoryRows tall. A fragment maps its
// distance from the top edge to an absolute row, then to a ring slot.
// Scrolling costs one uniform and zero uploads.
const fs = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 vUV;

uniform sampler2D uWaterfallTexture;
uniform sampler2D uColormapLUT;
uniform float uPowerMin;
uniform float uDisplayMax;
uniform float uHighlightStart;
uniform float uHighlightEnd;
uniform float uViewStart;
uniform float uViewEnd;
uniform vec3 uBlankColor;
uniform int uBinCount;
uniform int uSubBinStart;
uniform int uSubBins;
uniform int uAnchorRow;
uniform int uOldestValid;
uniform int uDisplayRows;
uniform int uHistoryRows;

out vec4 outPixelColor;

void main() {
    float tx = mix(uViewStart, uViewEnd, vUV.x);
    int binX = clamp(int(tx * float(uBinCount)) - uSubBinStart, 0, uSubBins - 1);

    int rowFromTop = int(floor(float(uDisplayRows) * (1.0 - vUV.y)));
    int absRow = uAnchorRow - rowFromTop;

    if (absRow < uOldestValid || absRow < 0) {
        outPixelColor = vec4(uBlankColor, 1.0);
        return;
    }

    // texelFetch reproduces NEAREST sampling exactly - no filtering, no
    // half-texel offsets - so the row/pixel mapping is exact by construction.
    float s = texelFetch(uWaterfallTexture, ivec2(binX, absRow % uHistoryRows), 0).r;
    float dBm = s * 127.0;
    float normalizedPower = clamp(
        (dBm - uPowerMin) / (uDisplayMax - uPowerMin),
        0.0, 1.0
    );
    vec3 rgb = texture(uColormapLUT, vec2(normalizedPower, 0.5)).rgb;
    if (uHighlightStart < uHighlightEnd && tx >= uHighlightStart && tx <= uHighlightEnd) {
        rgb = mix(rgb, vec3(1.0), 0.22);
    }
    outPixelColor = vec4(rgb, 1.0);
}
`;

export class WaterfallRenderer {
  canvas!: HTMLCanvasElement;
  ctx!: WebGL2RenderingContext;
  bufferInfo!: BufferInfo;
  programInfo!: ProgramInfo;
  texture!: WebGLTexture;
  lutTexture!: WebGLTexture;
  historyRows: number;
  binCount: number;
  ringBuffer: RingBuffer;
  viewport!: Viewport;
  timeCursor!: TimeCursor;

  /** Displayed rows D. A uniform, not a texture size, so resize never reallocates. */
  private displayRows = 1;

  /** Texture bin window. Subviews store only the bins they can ever display. */
  private readonly texBinStart: number;
  private readonly texBins: number;

  private powerMin: number;
  private displayMax: number;
  private currentLUT: Uint8Array;
  private highlightStart = 0;
  private highlightEnd = 0;

  constructor(
    historyRows: number,
    binCount: number,
    buffer: RingBuffer,
    settings: WaterfallSettings,
  ) {
    this.historyRows = historyRows;
    this.binCount = binCount;
    this.ringBuffer = buffer;
    this.texBinStart = Math.max(0, Math.min(binCount - 1, settings.binStart ?? 0));
    this.texBins = Math.max(1, Math.min(binCount - this.texBinStart, settings.binSpan ?? binCount));
    this.powerMin = settings.displayMin;
    this.displayMax = settings.displayMax;
    this.currentLUT = buildLUT(COLORMAPS[settings.colormap]);
  }

  destroy() {}

  mount(canvas: HTMLCanvasElement, viewport: Viewport, timeCursor: TimeCursor) {
    if (!canvas) throw new Error("Canvas not mounted");
    this.canvas = canvas;

    const ctx = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      depth: false,
    });
    if (!ctx) throw new Error("WebGL2 not supported");
    this.ctx = ctx;
    const gl = this.ctx;

    // Height is ours (N = 4096, always safe); width is the binding dimension.
    // Fail loudly rather than rendering black on a device that cannot hold it.
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (this.texBins > maxTextureSize || this.historyRows > maxTextureSize) {
      throw new Error(
        `Waterfall needs a ${this.texBins}x${this.historyRows} texture but this device ` +
          `reports MAX_TEXTURE_SIZE=${maxTextureSize}. Reduce binCount or history depth.`,
      );
    }

    this.programInfo = createProgramInfo(gl, [vs, fs]);

    this.bufferInfo = createBufferInfoFromArrays(gl, {
      aPosition: { numComponents: 2, data: [-1, -1, 1, -1, -1, 1, 1, 1] },
      indices: [0, 1, 2, 2, 1, 3],
    });

    // Rows are not necessarily a multiple of 4 bytes wide once cropped.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    this.texture = createTexture(gl, {
      width: this.texBins,
      height: this.historyRows,
      format: gl.RED,
      internalFormat: gl.R8_SNORM,
      type: gl.BYTE,
      minMag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
      src: this.buildInitialTextureData(),
    });

    this.lutTexture = createTexture(gl, {
      width: LUT_SIZE,
      height: 1,
      format: gl.RGB,
      internalFormat: gl.RGB8,
      type: gl.UNSIGNED_BYTE,
      minMag: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
      src: this.currentLUT,
    });

    this.viewport = viewport;
    this.timeCursor = timeCursor;
  }

  // The texture is the ring buffer 1:1, so an uncropped view uploads it as-is.
  private buildInitialTextureData(): Int8Array {
    if (
      this.texBins === this.binCount &&
      this.ringBuffer.data.length === this.binCount * this.historyRows
    ) {
      return this.ringBuffer.data;
    }
    const data = new Int8Array(this.texBins * this.historyRows).fill(POWER_NO_READING);
    const { texBinStart, texBins } = this;
    const ringRows = Math.min(this.historyRows, this.ringBuffer.rowCount);
    for (let slot = 0; slot < ringRows; slot++) {
      const row = this.ringBuffer.rowViewAbs(slot);
      data.set(row.subarray(texBinStart, texBinStart + texBins), slot * texBins);
    }
    return data;
  }

  render = () => {
    const canvas = this.canvas;
    if (!canvas) {
      console.warn("Canvas not mounted");
      return;
    }

    resizeCanvasToDisplaySize(canvas, window.devicePixelRatio || 1);
    this.ctx.viewport(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

    this.ctx.useProgram(this.programInfo.program);
    setBuffersAndAttributes(this.ctx, this.programInfo, this.bufferInfo);
    setUniforms(this.programInfo, {
      uWaterfallTexture: this.texture,
      uColormapLUT: this.lutTexture,
      uViewStart: this.viewport.start,
      uViewEnd: this.viewport.end,
      uPowerMin: this.powerMin,
      uDisplayMax: this.displayMax,
      uHighlightStart: this.highlightStart,
      uHighlightEnd: this.highlightEnd,
      uBlankColor: BLANK_COLOR,
      uBinCount: this.binCount,
      uSubBinStart: this.texBinStart,
      uSubBins: this.texBins,
      uAnchorRow: this.timeCursor.anchorRow,
      uOldestValid: this.ringBuffer.oldestAbs(),
      uDisplayRows: this.displayRows,
      uHistoryRows: this.historyRows,
    });

    drawBufferInfo(this.ctx, this.bufferInfo, this.ctx.TRIANGLES);
  };

  setHighlight(normStart: number, normEnd: number) {
    this.highlightStart = normStart;
    this.highlightEnd = normEnd;
  }

  clearHighlight() {
    this.highlightStart = 0;
    this.highlightEnd = 0;
  }

  /** D changed (pane resize). A uniform: no texture work, no geometry rebuild. */
  setDisplayRows(n: number) {
    this.displayRows = Math.max(1, Math.round(n));
  }

  /** Upload one row at its ring slot. `absRow` is in `totalWritten` space. */
  push(absRow: number, row: Int8Array) {
    const gl = this.ctx;
    if (!gl) return;
    const slot = absRow % this.historyRows;
    const src =
      this.texBins === this.binCount
        ? row
        : row.subarray(this.texBinStart, this.texBinStart + this.texBins);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, slot, this.texBins, 1, gl.RED, gl.BYTE, src);
  }

  updateColormap(lut: Uint8Array) {
    this.currentLUT = lut;
    if (!this.ctx) return; // not yet mounted — colormap stored, applied on mount
    const gl = this.ctx;
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      LUT_SIZE,
      1,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      lut,
    );
    this.render();
  }

  updateDisplayMin(displayMin: number) {
    this.powerMin = displayMin;
    if (this.ctx) this.render();
  }

  updateDisplayMax(displayMax: number) {
    this.displayMax = displayMax;
    if (this.ctx) this.render();
  }
}
