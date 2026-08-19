import { POWER_NO_READING } from "./Spectrum/core/constants";
import type { SpectrumInitialData } from "./Spectrum";

const API_BASE = (import.meta.env.VITE_SPECTRUM_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const INITIAL_PAGE_COUNT = 2;
const OCCUPANCY_THRESHOLD_DBM = -85;

export type CaptureParams = {
  freqStart: number;
  resolution: number;
  binCount: number;
  historyRows: number;
};

export type CaptureMetadata = {
  sessionId: string;
  freqStart: number;
  resolution: number;
  binCount: number;
  pageRows: number;
  seqStart: number;
  seqEnd: number;
  startedAt: number;
  retention: { rows: number; policy: "ring" };
  liveFormat: "spectrum-live-binary-v1";
};

type PageHeader = {
  seqStart: number;
  rows: number;
  binCount: number;
  annotations: { encoding: "intervals-v1"; byteLength: number };
};

export type HistoryPage = {
  header: PageHeader;
  timestamps: number[];
  spectrum: Int8Array;
  annotations: Int8Array;
};

export type LiveFrame = {
  seq: number;
  timestampMs: number;
  spectrum: Int8Array;
  annotations: Int8Array;
};

export const getCurrentCapture = (): Promise<CaptureMetadata> =>
  requestJSON("/api/captures/current");

export const createCapture = (params: CaptureParams): Promise<CaptureMetadata> =>
  requestJSON("/api/captures", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

export const fetchHistoryPages = async (
  capture: CaptureMetadata,
  fromPage: number,
  count: number,
  signal?: AbortSignal,
): Promise<HistoryPage[]> => {
  const response = await fetch(
    apiURL(`/api/captures/${encodeURIComponent(capture.sessionId)}/pages?from=${fromPage}&count=${count}`),
    { signal },
  );
  if (!response.ok) throw await responseError(response);
  return decodePages(await response.arrayBuffer());
};

export const seekCapture = (
  capture: CaptureMetadata,
  timestampMs: number,
  signal?: AbortSignal,
): Promise<{ seq: number }> =>
  requestJSON(
    `/api/captures/${encodeURIComponent(capture.sessionId)}/seek?t=${Math.round(timestampMs)}`,
    { signal },
  );

export const loadInitialHistory = async (
  capture: CaptureMetadata,
): Promise<SpectrumInitialData> => {
  const completePageEnd = Math.floor(capture.seqEnd / capture.pageRows);
  const oldestPage = Math.ceil(capture.seqStart / capture.pageRows);
  const fromPage = Math.max(oldestPage, completePageEnd - INITIAL_PAGE_COUNT);
  const count = completePageEnd - fromPage;
  if (count <= 0) return emptyInitialData(capture.binCount, capture.seqEnd);

  const pages = await fetchHistoryPages(capture, fromPage, count);
  return pagesToInitialData(pages, capture.binCount);
};

export const streamLiveFrames = async (
  capture: CaptureMetadata,
  afterSeq: number,
  onFrame: (frame: LiveFrame) => void,
  signal: AbortSignal,
): Promise<void> => {
  const response = await fetch(
    apiURL(`/api/captures/${encodeURIComponent(capture.sessionId)}/live?after=${afterSeq}`),
    { signal },
  );
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new Error("Live response did not include a readable stream");

  const reader = response.body.getReader();
  let pending = new Uint8Array(0);
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    pending = concatBytes(pending, value);
    let offset = 0;
    while (pending.byteLength - offset >= 4) {
      const frameLength = new DataView(pending.buffer, pending.byteOffset + offset, 4).getUint32(0, true);
      if (pending.byteLength - offset < frameLength + 4) break;
      onFrame(decodeLiveFrame(pending.subarray(offset + 4, offset + 4 + frameLength)));
      offset += frameLength + 4;
    }
    if (offset > 0) pending = pending.slice(offset);
  }
};

const decodePages = (buffer: ArrayBuffer): HistoryPage[] => {
  const pages: HistoryPage[] = [];
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 4) throw new Error("Truncated page header length");
    const headerLength = view.getUint32(offset, true);
    offset += 4;
    const headerEnd = offset + headerLength;
    if (headerEnd > bytes.byteLength) throw new Error("Truncated page header");
    const header = JSON.parse(decoder.decode(bytes.subarray(offset, headerEnd))) as PageHeader;
    offset = headerEnd;

    const timestamps: number[] = [];
    for (let row = 0; row < header.rows; row++) {
      timestamps.push(view.getFloat64(offset, true));
      offset += 8;
    }
    const spectrumLength = header.rows * header.binCount;
    const spectrum = new Int8Array(bytes.slice(offset, offset + spectrumLength).buffer);
    offset += spectrumLength;
    const annotationEnd = offset + header.annotations.byteLength;
    const annotations = decodeAnnotationRows(view, offset, annotationEnd, header.rows, header.binCount);
    offset = annotationEnd;
    pages.push({ header, timestamps, spectrum, annotations });
  }
  return pages;
};

const decodeLiveFrame = (payload: Uint8Array): LiveFrame => {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const seq = view.getFloat64(0, true);
  const timestampMs = view.getFloat64(8, true);
  const binCount = view.getUint16(16, true);
  const intervalCount = view.getUint16(18, true);
  const spectrum = new Int8Array(payload.slice(20, 20 + binCount).buffer);
  const annotations = new Int8Array(binCount).fill(POWER_NO_READING);
  let offset = 20 + binCount;
  for (let i = 0; i < intervalCount; i++) {
    const start = view.getUint16(offset, true);
    const end = view.getUint16(offset + 2, true);
    const value = view.getInt8(offset + 4);
    annotations.fill(value, start, end + 1);
    offset += 5;
  }
  return { seq, timestampMs, spectrum, annotations };
};

const decodeAnnotationRows = (
  view: DataView,
  startOffset: number,
  endOffset: number,
  rowCount: number,
  binCount: number,
): Int8Array => {
  const result = new Int8Array(rowCount * binCount).fill(POWER_NO_READING);
  let offset = startOffset;
  for (let row = 0; row < rowCount; row++) {
    const intervalCount = view.getUint16(offset, true);
    offset += 2;
    for (let i = 0; i < intervalCount; i++) {
      const intervalStart = view.getUint16(offset, true);
      const intervalEnd = view.getUint16(offset + 2, true);
      const value = view.getInt8(offset + 4);
      result.fill(value, row * binCount + intervalStart, row * binCount + intervalEnd + 1);
      offset += 5;
    }
  }
  if (offset !== endOffset) throw new Error("Annotation section length does not match its header");
  return result;
};

const pagesToInitialData = (pages: HistoryPage[], binCount: number): SpectrumInitialData => {
  const count = pages.reduce((sum, page) => sum + page.header.rows, 0);
  const seqStart = pages[0]?.header.seqStart ?? 0;
  const timestamps = pages.flatMap((page) => page.timestamps);
  const spectrumRows = new Int8Array(count * binCount);
  const annotationRows = new Int8Array(count * binCount).fill(POWER_NO_READING);
  const maxHold = new Int8Array(binCount).fill(POWER_NO_READING);
  const occupancyCounts = new Uint32Array(binCount);
  let rowOffset = 0;
  for (const page of pages) {
    spectrumRows.set(page.spectrum, rowOffset * binCount);
    annotationRows.set(page.annotations, rowOffset * binCount);
    rowOffset += page.header.rows;
  }
  for (let row = 0; row < count; row++) {
    const base = row * binCount;
    for (let bin = 0; bin < binCount; bin++) {
      const value = spectrumRows[base + bin];
      if (value > maxHold[bin]) maxHold[bin] = value;
      if (value > OCCUPANCY_THRESHOLD_DBM) occupancyCounts[bin]++;
    }
  }
  return {
    spectrum: { rows: spectrumRows, count, timestamps, seqStart },
    annotations: { rows: annotationRows, count, timestamps, seqStart },
    maxHold,
    maxSnapshot: maxHold.slice(),
    occupancy: { counts: occupancyCounts, total: count, threshold: OCCUPANCY_THRESHOLD_DBM },
  };
};

const emptyInitialData = (binCount: number, seqStart: number): SpectrumInitialData => ({
  spectrum: { rows: new Int8Array(), count: 0, timestamps: [], seqStart },
  annotations: { rows: new Int8Array(), count: 0, timestamps: [], seqStart },
  maxHold: new Int8Array(binCount).fill(POWER_NO_READING),
  occupancy: { counts: new Uint32Array(binCount), total: 0, threshold: OCCUPANCY_THRESHOLD_DBM },
});

const concatBytes = (
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> => {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
};

const requestJSON = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(apiURL(path), init);
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<T>;
};

const responseError = async (response: Response): Promise<Error> => {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `Spectrum API request failed (${response.status})`);
};

const apiURL = (path: string): string => `${API_BASE}${path}`;
