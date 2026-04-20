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
import { RingBuffer } from "./RingBuffer";
import { Viewport } from "./Viewport";

export type WaterfallSettings = {
  displayMin: number;
  displayMax: number;
  colormap: number;
};

// Each row is a quad positioned in clip space.
// The vertex shader only translates Y — no ring-buffer math.
const vs = `#version 300 es
in vec2 aPosition;
in vec2 aTexCoord;

uniform float uTimeTranslation;
uniform float uViewStart;
uniform float uViewEnd;

out vec2 vTexCoord;

void main() {
    float tx = uViewStart + aTexCoord.x * (uViewEnd - uViewStart);
    vTexCoord = vec2(tx, aTexCoord.y);
    gl_Position = vec4(aPosition.x, aPosition.y + uTimeTranslation, 0.0, 1.0);
}
`;

// Fragment shader is trivial: sample + normalize + colormap.
// No ring-buffer indexing, no canvas-size math.
const fs = `#version 300 es
precision highp float;

in vec2 vTexCoord;

uniform sampler2D uWaterfallTexture;
uniform sampler2D uColormapLUT;
uniform float uPowerMin;
uniform float uDisplayMax;

out vec4 outPixelColor;

void main() {
    float s = texture(uWaterfallTexture, vTexCoord).r;
    float dBm = s * 127.0;
    float normalizedPower = clamp(
        (dBm - uPowerMin) / (uDisplayMax - uPowerMin),
        0.0, 1.0
    );
    vec3 rgb = texture(uColormapLUT, vec2(normalizedPower, 0.5)).rgb;
    outPixelColor = vec4(rgb, 1.0);
}
`;

// Build geometry for rowCount * 2 row-quads.
//
// First copy  (i = 0..N-1):   quad i covers y = [-1+i*rowH, -1+(i+1)*rowH]
//   → row 0 is at the bottom, row N-1 is at the top.
// Second copy (i = N..2N-1):  same quads shifted 2 units DOWN (y - 2).
//   → covers y = [-3+i*rowH, -3+(i+1)*rowH]
//
// uTimeTranslation = 2 - writeRow*(2/N) scrolls the belt downward.
// As writeRow goes 0→N the translation goes 2→0; when writeRow wraps,
// it snaps back to 2 and the second copy seamlessly takes over.
const buildRowGeometry = (rowCount: number) => {
  const totalRows = rowCount * 2;
  const rowH = 2.0 / rowCount;

  const positions = new Float32Array(totalRows * 4 * 2);
  const texCoords = new Float32Array(totalRows * 4 * 2);
  const indices = new Uint32Array(totalRows * 6);

  for (let i = 0; i < totalRows; i++) {
    const texRow = i % rowCount;
    const base = i < rowCount ? -1.0 : -3.0; // second copy 2 units below
    const localI = i % rowCount;
    const yBot = base + localI * rowH;
    const yTop = base + (localI + 1) * rowH;
    const ty = (texRow + 0.5) / rowCount;

    const v = i * 4;

    // BL, BR, TL, TR
    positions[v * 2 + 0] = -1;
    positions[v * 2 + 1] = yBot;
    positions[v * 2 + 2] = 1;
    positions[v * 2 + 3] = yBot;
    positions[v * 2 + 4] = -1;
    positions[v * 2 + 5] = yTop;
    positions[v * 2 + 6] = 1;
    positions[v * 2 + 7] = yTop;

    // X runs 0→1 (viewport transform applied in vertex shader); Y is fixed per row.
    texCoords[v * 2 + 0] = 0;
    texCoords[v * 2 + 1] = ty;
    texCoords[v * 2 + 2] = 1;
    texCoords[v * 2 + 3] = ty;
    texCoords[v * 2 + 4] = 0;
    texCoords[v * 2 + 5] = ty;
    texCoords[v * 2 + 6] = 1;
    texCoords[v * 2 + 7] = ty;

    const idx = i * 6;
    indices[idx + 0] = v + 0;
    indices[idx + 1] = v + 1;
    indices[idx + 2] = v + 2;
    indices[idx + 3] = v + 1;
    indices[idx + 4] = v + 3;
    indices[idx + 5] = v + 2;
  }

  return { positions, texCoords, indices };
}

export class WaterfallRenderer {
  canvas!: HTMLCanvasElement;
  ctx!: WebGL2RenderingContext;
  bufferInfo!: BufferInfo;
  programInfo!: ProgramInfo;
  texture!: WebGLTexture;
  lutTexture!: WebGLTexture;
  rowCount: number;
  binCount: number;
  ringBuffer: RingBuffer;
  viewport!: Viewport;

  private powerMin: number;
  private displayMax: number;
  private currentLUT: Uint8Array;

  constructor(
    rowCount: number,
    binCount: number,
    buffer: RingBuffer,
    settings: WaterfallSettings,
  ) {
    this.rowCount = rowCount;
    this.binCount = binCount;
    this.ringBuffer = buffer;
    this.powerMin = settings.displayMin;
    this.displayMax = settings.displayMax;
    this.currentLUT = buildLUT(COLORMAPS[settings.colormap]);
  }

  destroy() {}

  mount(canvas: HTMLCanvasElement, viewport: Viewport) {
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

    this.programInfo = createProgramInfo(gl, [vs, fs]);

    const geo = buildRowGeometry(this.rowCount);
    this.bufferInfo = createBufferInfoFromArrays(gl, {
      aPosition: { numComponents: 2, data: geo.positions },
      aTexCoord: { numComponents: 2, data: geo.texCoords },
      indices: geo.indices,
    });

    this.texture = createTexture(gl, {
      width: this.binCount,
      height: this.rowCount,
      format: gl.RED,
      internalFormat: gl.R8_SNORM,
      type: gl.BYTE,
      minMag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
      src: this.ringBuffer.data,
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
  }

  render = () => {
    const canvas = this.canvas;
    if (!canvas) {
      console.warn("Canvas not mounted");
      return;
    }

    resizeCanvasToDisplaySize(canvas, window.devicePixelRatio || 1);
    this.ctx.viewport(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

    // Shift the geometry so the most-recently-written row sits at the top.
    // Goes from 2→0 as writeRow advances 0→N; when writeRow wraps the second
    // geometry copy takes over so there is no visual jump.
    // Snap to pixel grid to prevent sub-pixel drift from causing rows to
    // alternate between 1px and 2px tall as the geometry moves each tick.
    const writeRow = this.ringBuffer.writeRow;
    const rawTranslation = 2.0 - writeRow * (2.0 / this.rowCount);
    const pixelSize = 2.0 / this.ctx.canvas.height;
    const uTimeTranslation = Math.round(rawTranslation / pixelSize) * pixelSize;

    this.ctx.useProgram(this.programInfo.program);
    setBuffersAndAttributes(this.ctx, this.programInfo, this.bufferInfo);
    setUniforms(this.programInfo, {
      uWaterfallTexture: this.texture,
      uColormapLUT: this.lutTexture,
      uTimeTranslation,
      uViewStart: this.viewport.start,
      uViewEnd: this.viewport.end,
      uPowerMin: this.powerMin,
      uDisplayMax: this.displayMax,
    });

    drawBufferInfo(this.ctx, this.bufferInfo, this.ctx.TRIANGLES);
  };

  push(writtenRow: number, row: Int8Array) {
    const gl = this.ctx;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, writtenRow, this.binCount, 1, gl.RED, gl.BYTE, row);
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
