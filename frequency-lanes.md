# Frequency lanes — execution brief

**Status:** proposal, nothing built. Written from a cold context — no prior conversation
required, and this document does not depend on any other brief. Read it fully before
editing anything.

Replaces the standalone subview form. Sits on top of the history stack described in
[history-scroll.md](history-scroll.md) and [history-paging-api.md](history-paging-api.md),
both of which are implemented and are only *read* here, never changed.

## Objective

Keep one or more narrow frequency ranges permanently visible beside the main waterfall,
on a laptop that has no vertical space to spare.

The driving request: *"I know something might appear at 145.5 MHz and I want to see it
all the time."* Today the answer is a subview, and subviews are not shipped to production
because they are unusable at field screen sizes ([Why panels fail](#why-panels-fail)).

A **lane** is a narrow, full-height column to the right of the main waterfall showing one
frequency range, sharing the main view's time axis, scroll position and time gutter.

**Non-goals** (do not build these, do not refactor toward them):

- Alerting, triggers, or event detection of any kind. A lane shows a range; it does not
  watch it. That is a separate proposal and nothing here presumes it.
- Per-lane zoom, pan, or tooltips. A lane shows its whole range, always. This is the main
  simplification over a subview and it is what makes lanes cheap.
- Per-lane live trace, occupancy strip, frequency axis, or power axis.
- Merging panes into one WebGL context. Noted in [Risks](#risks) as the eventual fix for
  lane count; explicitly out of scope here.

## Working agreement

| | |
|---|---|
| Typecheck gate | `npx tsc -b` — **currently passes clean; keep it that way** |
| Dev server | `npm run dev` |
| Production build | `npm run build` (`tsc -b && vp build`) |
| Lint | `npx vp lint` fails to load its config (pre-existing env issue). Do not chase it. |
| Tests | None in the client. The Go backend has tests and is untouched by this work. |

No client test suite, so **each work item lists explicit acceptance criteria.** Verify
them in the browser before moving on.

## Codebase orientation

Read these before starting: [WaterfallRenderer.ts](src/Spectrum/core/WaterfallRenderer.ts),
[SpectrumCore.ts](src/Spectrum/core/SpectrumCore.ts),
[TimeCursor.ts](src/Spectrum/core/TimeCursor.ts),
[Viewport.ts](src/Spectrum/core/Viewport.ts).

**Shape.** Plain-TypeScript engine in [src/Spectrum/core/](src/Spectrum/core/), thin React
wrapper in [src/Spectrum/react/](src/Spectrum/react/). React owns DOM refs and jotai
atoms; it does not participate in rendering. Public surface is
[src/Spectrum/index.ts](src/Spectrum/index.ts).

**Data flow.**

```
FrameBuffer.push(spec, ann, ts)
  └→ onPush  →  scheduleRender()        ← rAF-coalesced
        └→ renderAll()
             ├→ processNewRows()        ← drains new rows into every layer
             ├→ timeCursor.clamp(...)   ← one time window for the whole frame
             └→ <each renderer>.render()
```

`SpectrumCore.processNewRows()` is the only place rows fan out to layers. Lanes join that
fan-out and change nothing else about it.

**Two shared mutable axis objects, both constructed once in `SpectrumCore.mount()` and
handed to every renderer, which reads them fresh each `render()`. Nothing subscribes,
nothing diffs.**

- [`Viewport`](src/Spectrum/core/Viewport.ts) — the frequency axis, `start`/`end`
  normalized 0..1. Constructor is
  `(binCount, canvas, minBinWidthPx = 12, resetStart = 0, resetEnd = 1)`; the last two
  clamp it to a sub-range.
- [`TimeCursor`](src/Spectrum/core/TimeCursor.ts) — the time axis. `anchorRow` is the
  **absolute** index of the newest visible row, `displayRows` is `D`. **Every lane shares
  the main view's instance.** That single fact is what makes lanes time-aligned.

**Samples** are `Int8` dBm values directly, not normalized. `POWER_NO_READING = -128` is
the no-data sentinel ([constants.ts](src/Spectrum/core/constants.ts)). `HISTORY_ROWS =
4096` is the retained depth `N`; `D` is the waterfall canvas height in CSS pixels, one row
per pixel.

**Styling** is vanilla-extract (`*.css.ts`). **State** is jotai atoms in
[store.ts](src/Spectrum/react/store.ts).

> Line numbers drift. Each reference below also names the symbol — trust the symbol.

## Why panels fail

Not a matter of polish; the form is wrong for the deployment, which is a laptop in the
field — 16:9, roughly 658px of viewport after browser chrome, and no height to spare.

**Each subview is a complete miniature of the application.**
[SpectrumSubview.tsx](src/Spectrum/react/SpectrumSubview.tsx) mounts a live trace, an
occupancy strip, a frequency axis, a power axis and a waterfall;
[SpectrumSubviewCore](src/Spectrum/core/SpectrumSubviewCore.ts) backs that with seven
controllers, two `InputHandler`s, its own `Viewport`, its own `ResizeObserver` and its own
WebGL context.

Vertical budget at 1366×768:

| | |
|---|---|
| Page padding + live row | 200px |
| `subviewsRow` — fixed `16rem`, `flexShrink: 0` | **256px** |
| Left for the main waterfall | **~202px** |

One row of subviews outweighs the primary instrument. Inside each 240px panel the split is
~142px of chrome (header, live, occupancy, frequency axis) against ~98px of waterfall —
**the furniture exceeds the content.**

Three further structural problems:

1. **`flexShrink: 0` on a fixed height** means the row never yields to the main view. The
   existing `subviewFlexMap` resize only redistributes width *among* subviews.
2. **`minWidth: 18rem` with `overflowX: auto`** means the fourth subview scrolls off
   screen. A range you added to keep visible becomes not-visible.
3. **Each panel carries its own vertical time axis.** Reading two panels at the same
   instant means comparing two independent y-scales by eye.

## The shape

```
[time gutter][          main waterfall          ][145.5][446.0][1090]
```

Every lane reads the same `TimeCursor` anchor as the main view, so **a given row sits at
the same y in every column.** That is the whole argument: a waterfall's expensive axis is
time, and lanes share one copy of it.

| | Panels (today) | Lanes |
|---|---|---|
| Cost of one more | 256px of height, or horizontal scroll | ~96px of width |
| Chrome per unit | header + live + occupancy + 2 axes | a label |
| Time axis | one per panel | one, shared, already built |
| Cross-reading | compare two y-scales by eye | same row, same y |
| Main waterfall at 1366×768 | ~202px tall | ~458px tall |

On 16:9 field hardware, width is the resource you have and height is the one you do not.
Lanes spend the former to stop spending the latter.

## The central point: there is no new renderer

**`WaterfallRenderer` already does everything a lane needs.** Do not write a
`LaneRenderer`. Check this yourself before starting — it is the assumption the estimates
rest on:

- `WaterfallSettings` already carries `binStart` and `binSpan`
  ([WaterfallRenderer.ts](src/Spectrum/core/WaterfallRenderer.ts)), and the constructor
  crops the texture to `texBins` wide. The fragment shader already maps a global
  normalized `tx` into the cropped window via `uSubBinStart` / `uSubBins`.
- `mount(canvas, viewport, timeCursor)` takes both axis objects from outside, so a lane
  hands it the **shared** `TimeCursor` and its **own frozen** `Viewport`.
- `push(absRow, row)` subarrays a full row down to the crop internally, so lanes take the
  same `specRow` the main renderer gets, with no extra copy at the call site.
- `syncVisibleRows()` keeps the GPU ring correct across scrolls per-instance, so a lane
  inherits correct history scrolling with no work.
- `setDisplayRows(n)` is a uniform, not a reallocation.

A lane is therefore roughly:

```ts
const viewport = new Viewport(binCount, canvas, 12, normStart, normEnd);
viewport.panTo(normStart, normEnd);          // frozen: no InputHandler is ever attached

const binStart = Math.max(0, Math.min(binCount - 1, Math.floor(normStart * binCount)));
const binEnd   = Math.max(binStart + 1, Math.min(binCount, Math.ceil(normEnd * binCount)));

const renderer = new WaterfallRenderer(HISTORY_ROWS, binCount, spectrumRing, {
  displayMin, displayMax, colormap, binStart, binSpan: binEnd - binStart,
});
renderer.mount(canvas, viewport, sharedTimeCursor);
```

The crop arithmetic above is lifted verbatim from `SpectrumSubviewCore.mount()`. The work
in this brief is lifecycle, fan-out and layout — not rendering.

## Decisions — already made, do not re-litigate

| Decision | Value | Rationale |
|---|---|---|
| Lane declaration | **`ProfileRange` + a `watched` flag** | The object already exists, is named, carries a frequency range, and is **draggable directly on the main canvas** via `ProfileRangeHandler`. A separate lane definition would need its own editing UI and could not be dragged. |
| Lane renderer | **existing `WaterfallRenderer`, cropped** | see above |
| Lane `Viewport` | own instance, frozen to the range, no input | a lane never zooms; this is the simplification |
| Lane `TimeCursor` | **the shared instance** | time alignment is the entire point |
| `D` for lanes | **derived once from the main waterfall canvas**, fanned out | see risk 1 — deriving per-lane is the one change that silently breaks alignment |
| Lane label | **absolutely-positioned overlay inside the canvas area** | a header in flow would shorten the lane canvas and break row alignment; see risk 2 |
| Lane width | `6rem` default, resizable, total capped at 40% of the row | an uncapped secondary surface is exactly how panels failed |
| Annotation overlay per lane | **not in v1** | the main view already draws annotation boxes; a lane can gain one later without touching anything here |

## Work items

### 1. Declare a lane

**Files:** `ProfileTypes.ts`, `App.tsx`

Add `watched: boolean` to `ProfileRange`, defaulting to `false` so every existing range
behaves exactly as it does now. Surface it as a toggle in the profiles panel.

`ProfileRange` today is
`{ id, numericId, name, freqStartMHz, freqEndMHz, powerDbm }`. Note that `powerDbm` is
stored, editable and **read by nothing** — leave it that way; it belongs to alerting, not
to lanes.

**Done when:** toggling `watched` round-trips through the panel; existing ranges render
identically to before; `npx tsc -b` clean.

### 2. `LaneCore`

**New file:** `src/Spectrum/core/LaneCore.ts`

A thin owner around one cropped `WaterfallRenderer`, mirroring how
`SpectrumSubviewCore` owns its renderers but with everything a lane does not need
removed. Constructed with the shared ring buffer, the shared `TimeCursor`, and the
normalized range.

Surface, kept deliberately small:

```ts
class LaneCore {
  mount(canvas: HTMLCanvasElement): void;
  push(absRow: number, specRow: Int8Array): void;
  setDisplayRows(d: number): void;
  updateColormap(lut: Uint8Array): void;
  updateDisplayMin(v: number): void;
  updateDisplayMax(v: number): void;
  render(): void;
  destroy(): void;
}
```

`destroy()` must release the WebGL context — see risk 3. There is no `InputHandler`, no
`ResizeObserver`, no `Viewport` mutation after construction.

**Done when:** a `LaneCore` mounted on a bare canvas renders its frequency range at full
ring depth; it allocates exactly one WebGL context and no input handlers; constructing one
with a range outside `0..1` clamps rather than throwing.

### 3. Lane registry and fan-out in `SpectrumCore`

**File:** `SpectrumCore.ts`

Lanes are a keyed collection managed the way `subviews` is today. Wire them into the four
existing fan-out points — **all four, or a lane silently drifts from the main view:**

| Site | Add |
|---|---|
| `processNewRows()` | `lane.push(abs, specRow)` alongside `waterfallRenderer.push` |
| `applyDisplayRows(d)` | `lane.setDisplayRows(d)` |
| `renderAll()` | `lane.render()` after the main renderers |
| colormap / display min / max setters | the matching `lane.update*` |
| `unmount()` | `lane.destroy()` |

Add `setLanes(defs)` taking the watched ranges, diffing by id: construct new lanes, destroy
removed ones, leave unchanged ones alone. Rebuilding all lanes on every change would drop
and recreate WebGL contexts on a name edit.

**Done when:** adding and removing lanes at runtime is stable over many cycles with no
context-loss warnings in the console; a lane created mid-session immediately shows the
history already in the ring, not just rows arriving after it.

### 4. Layout

**Files:** `SpectrumRows.tsx`, `SpectrumRows.css.ts`, `Spectrum.tsx`, `App.tsx`

Lanes sit inside the existing waterfall row, between the waterfall canvas container and
the colormap legend:

```
<div className={waterfallRow}>
  <div className={timeLabels} />              ← unchanged, serves every lane
  <div className={waterfallCanvasContainer}>  ← stays flex: 1
  <div className={lane}> × N                  ← new
  <div ref={colormapLegendRef} />             ← unchanged
</div>
```

- Lane is `position: relative`, `width: 6rem`, `flexShrink: 0`, with the canvas at
  `inset: 0` and the label absolutely positioned at the top.
- Resize handles between lanes — reuse the drag pattern already written for
  `subviewFlexMap` in [App.tsx](src/App.tsx).
- **Cap total lane width at ~40% of the row.** Enforce it in the resize handler, not only
  in CSS.

**Done when:** adding lanes narrows the main waterfall and changes **no vertical
dimension** anywhere on the page; the time gutter and its labels line up with every lane;
four lanes fit at 1366px with no horizontal scrolling; removing all lanes restores the
previous layout exactly.

**The alignment test, and it is the one that matters:** push a marker row with every bin
at a distinctive constant value. It must render as a 1-row line at **the same y in the
main waterfall and in every lane**, in follow mode and while scrolled back, at several
window heights. If it is off by even one row, `D` is being derived per-lane (risk 1) or
the label is consuming layout height (risk 2).

### 5. Remove standalone subviews

**Files:** `SpectrumSubview.tsx`, `SpectrumSubviewRows.css.ts`, `SpectrumSubviewCore.ts`,
`SubviewHighlightController.ts`, `App.tsx`, `index.ts`

Delete the subview form, its panel UI, and `addSubview`. Nothing depends on it once lanes
land, and it was never promoted to production.

**Do this last and as its own commit.** Items 1–4 stand alone; if lanes read badly in the
field this is the single commit to revert, and nothing else needs unpicking.

**Done when:** `SpectrumSubview` no longer appears anywhere in `src/`; the public surface
in `src/Spectrum/index.ts` exports lanes instead of subviews; `npm run build` clean.

## Risks

1. **Row misalignment from a per-lane `D`.** `SpectrumCore.measureDisplayRows()` reads a
   canvas height and `applyDisplayRows()` fans it out. If a lane ever measures its **own**
   canvas instead, a one-pixel layout difference makes its rows drift from the main view —
   subtly, and worst while scrolled. **One `D`, measured from the main waterfall, fanned
   out to everything.** This is the single highest-value invariant in the brief.
2. **A label in normal flow breaks alignment.** A `1.25rem` header above the lane canvas
   makes the lane shorter than the main waterfall, so identical `D` values map to
   different pixel heights. The label must be an absolute overlay. This looks like a
   cosmetic choice and is not; leave the comment in the CSS saying so.
3. **WebGL contexts are the ceiling on lane count.** Each lane is one context, as each
   subview was. Browsers cap live contexts (Chrome around 16) and silently drop the oldest
   when exceeded — which presents as an unrelated pane going black. Cap lanes at 6 in the
   UI. The real fix is the consolidation already sketched in
   [history-scroll.md](history-scroll.md) item 9 — render every pane into one canvas via
   `gl.viewport`/`gl.scissor` — and **lanes make it much more attractive**, because
   adjacent full-height columns in a single row are the natural case for scissor rects.
   Out of scope here; revisit past ~4 lanes.
4. **A very narrow lane is blocky, and that is honest.** A range spanning 5 bins drawn
   across 96px gives ~19px per bin under `NEAREST` sampling. It is not a bug and must not
   be "fixed" with interpolation, which would invent data. Put the bin count in the lane
   label so the resolution is legible.
5. **Scroll re-uploads scale with lane count.** `syncVisibleRows()` re-uploads the visible
   window per instance when the anchor jumps. A lane spanning 1% of an 8192-bin span is
   ~82 bins; at `D` = 450 that is ~37 KB per jump per lane — negligible, but it is per
   lane and it is worth knowing where the cost lives before adding many.

## Deferred follow-ups

Listed so they are not re-derived. None is required for this brief and none constrains it.

- **Annotation overlay per lane** — a second cropped canvas over the lane, same pattern as
  the main view's annotation canvas.
- **Tooltip on a lane** — `TooltipController` needs a viewport and a row mapping; both
  exist per lane, so this is wiring rather than design.
- **Alerting on a lane** — the natural next feature, and the original request behind the
  lane work. Independent of everything above: it consumes the same `ProfileRange` and the
  backend's existing per-row annotation intervals.
- **Single-canvas consolidation** — risk 3.

## Order and estimate

| # | Item | Est. |
|---|---|---|
| 1 | Declare a lane (`watched` on `ProfileRange`) | 1h |
| 2 | `LaneCore` | 2h |
| 3 | Registry and fan-out in `SpectrumCore` | 2h |
| 4 | Layout, label overlay, resize, cap | 3h |
| | **Checkpoint — lanes work; verify the marker-row alignment test here** | |
| 5 | Remove standalone subviews | 2h |

Items 1–4 are strictly ordered. Item 5 is separable, reversible on its own, and safe to
defer indefinitely.
