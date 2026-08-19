# History scrolling — Phase 1 execution brief

**Status:** phase 1 complete (items 1-9); backend paging is now implemented as described
in [history-paging-api.md](history-paging-api.md). The fixed live ring remains the GPU
working set while settled historical windows are fetched into a bounded page cache.
`npm run build` and the Go backend tests are clean. This document was written as the
phase-1 execution brief from a cold context —
no prior conversation required. Read it fully before editing anything.

## Objective

Let the user scroll the waterfall back through retained in-memory history, with a
wall-clock timeline in the left gutter, and return to live. Everything is served from
an in-memory ring buffer; no backend involvement.

**Non-goals** (do not build these, do not refactor toward them):

- Backend paging. Proposed separately in [history-paging-api.md](history-paging-api.md);
  phase 1 only needs to avoid painting itself into a corner (see [Phase 2 readiness](#phase-2-readiness)).
- Hydration / restoring history on page load. Phase 1 starts with an empty ring and
  fills from the live stream.
- Decimated overview tiers, time-range pickers, export.
- Merging the per-pane canvases into one WebGL context (noted in item 9 as a possible
  future, explicitly out of scope here).

## Working agreement

| | |
|---|---|
| Typecheck gate | `npx tsc -b` — **currently passes clean; keep it that way** |
| Dev server | `npm run dev` (vite-plus) |
| Production build | `npm run build` (`tsc -b && vp build`) |
| Lint | `npx vp lint` currently fails to load its config (pre-existing env issue, unrelated to this work). Do not chase it. |
| Tests | None in the repo. Verify visually in `npm run dev`. |

There is no test suite, so **each work item lists explicit acceptance criteria**. Verify
them in the browser before moving on. The app has a params panel (`App.tsx`) for
changing `binCount` / `resolution` at runtime, which is the fastest way to exercise
resize and reallocation paths.

## Codebase orientation

Read these before starting: [SpectrumCore.ts](src/Spectrum/core/SpectrumCore.ts),
[WaterfallRenderer.ts](src/Spectrum/core/WaterfallRenderer.ts),
[RingBuffer.ts](src/Spectrum/core/RingBuffer.ts),
[Viewport.ts](src/Spectrum/core/Viewport.ts).

**Shape.** Plain-TypeScript engine in [src/Spectrum/core/](src/Spectrum/core/), thin React
wrapper in [src/Spectrum/react/](src/Spectrum/react/). React owns DOM refs and jotai
atoms; it does not participate in rendering. Public surface is
[src/Spectrum/index.ts](src/Spectrum/index.ts) — keep exports stable.

**Data flow.**

```
FrameBuffer.push(spec, ann, ts)      ← app feeds rows in
  └→ onPush  →  scheduleRender()     ← rAF-coalesced, set in SpectrumCore.mount
        └→ renderAll()
             ├→ processNewRows()     ← drains new rows into every layer
             └→ <each renderer>.render()
```

- [FrameBuffer](src/Spectrum/core/FrameBuffer.ts) holds two parallel
  [RingBuffer](src/Spectrum/core/RingBuffer.ts)s — `spectrum` and `annotations` — with
  identical geometry and shared timestamps.
- Samples are **`Int8` dBm values directly** (not normalized). `POWER_NO_READING = -128`
  is the "no data" sentinel, see [constants.ts](src/Spectrum/core/constants.ts).
- `SpectrumCore.processNewRows()` is the only place rows fan out to layers.

**The `Viewport` pattern — copy it.** [Viewport](src/Spectrum/core/Viewport.ts) is a
shared mutable object holding the frequency axis (`start`/`end`, normalized 0..1). It is
constructed once in `SpectrumCore.mount()` and handed to every renderer, which reads it
fresh on each `render()`. Nothing subscribes; nothing diffs. **`TimeCursor` (item 2) must
follow this pattern exactly** — same lifetime, same hand-off, same read-on-render.

**Renderers.** `WaterfallRenderer` is WebGL2 (via `twgl.js`). `LiveRenderer`,
`AnnotationRenderer`, `OccupancyRenderer` are canvas 2D. The rest
(`FrequencyAxisController`, `TimeLabelsController`, `PowerAxisController`,
`ColormapLegendController`, `BandController`, `GridLineController`, `TooltipController`,
`SubviewHighlightController`) are DOM controllers that mount into a container element.

**Subviews.** [SpectrumSubviewCore](src/Spectrum/core/SpectrumSubviewCore.ts) renders a
frequency sub-range into its own canvases. It **shares the same `RingBuffer`s** as the
main view but has its own `Viewport` clamped to the sub-range via `resetStart`/`resetEnd`.
Critically it has its **own WebGL context**, so it cannot share GPU textures with the
main view — this drives item 9.

**Styling** is vanilla-extract (`*.css.ts`). **State** is jotai atoms in
[store.ts](src/Spectrum/react/store.ts).

> Line numbers below were accurate at time of writing but drift. Each reference also
> names the symbol — trust the symbol, not the number.

## Decisions — already made, do not re-litigate

| Decision | Value | Rationale |
|---|---|---|
| History depth `N` | **4096 rows, fixed** | Not derived from `binCount`. Power-of-two multiple of the future page size. |
| Worst-case memory | 67 MB RAM / 33 MB GPU | at 8k bins; ~9 screens of scrollback |
| Display rows `D` | canvas CSS height (1 row/px) | from `ResizeObserver`, no longer tied to `N`. **Visible change** — see note below. |
| Anchor | **absolute row index** | not offset-from-newest; this is what keeps a paused view frozen as new rows arrive |
| Timeline labels | absolute `HH:MM:SS` | the "referenced time" requirement |
| Overlays while scrolled | **dimmed + badged as live** | window-scoped aggregates deferred, see [Deferred follow-ups](#deferred-follow-ups) |
| Subviews | texture cropped to own freq range | full ring depth, scrolls in sync; see item 9 |
| Allocation | eager, up front | deliberate: predictable footprint, no realloc stalls |
| 8k bins | hardware requirement | client needs `MAX_TEXTURE_SIZE ≥ 8192`; see risk 1 |

**Note on `D`:** today the main view renders a fixed 300 rows regardless of pane height,
so rows are stretched vertically. Moving to 1 row per CSS pixel makes rows thinner and
puts *more* rows — and therefore less wall-clock time at a given ingest rate — on screen.
This is a deliberate crispness win but it is a visible change to the live view, not just
to history. If it reads badly, `D = height / 2` (what subviews already use) is the
fallback; keep `D` a single derived value so it is one line to change.

**The enabling change:** today `rowCount` is one number serving as both history depth and
displayed rows — `SpectrumCore.processNewRows()` indexes the ring with `% this.rowCount`,
and `App.tsx` passes `DEFAULT_ROWS = 300` for both. History is therefore exactly one
screen deep and there is nothing to scroll to. Item 1 splits them.

## Work items

### 1. Decouple `N` from `D`, add absolute-index accessors

**Files:** `RingBuffer.ts`, `FrameBuffer.ts`, `SpectrumCore.ts`, `App.tsx`

- Add `HISTORY_ROWS = 4096` (suggest `constants.ts`). `FrameBuffer` takes it
  independently of display rows.
- Add to `RingBuffer`: `rowViewAbs(absRow)`, `timestampAtAbs(absRow)`, `oldestAbs()`,
  `hasAbs(absRow)`, where `absRow` is in `totalWritten` space (monotonic, never wraps).
- **Move every consumer onto these accessors.** This is the phase 2 insurance: the
  storage behind them gets replaced without touching a renderer.
- `processNewRows()` keeps `% N` for ring slots internally but passes absolute indices
  down to layers.

**Done when:** no call site reads `.data` / `.timestamps` / `writeRow` directly any more
(grep for them — the `*Abs` accessors should be the only readers); `HISTORY_ROWS` and the
display-row count are visibly different numbers at runtime; the waterfall still streams
correctly with `D` unchanged from today's 300; `npx tsc -b` clean.

### 2. `TimeCursor` — new file `src/Spectrum/core/TimeCursor.ts`

Mirrors `Viewport`: constructed in `SpectrumCore.mount()`, handed to every renderer, read
fresh each `render()`.

```ts
class TimeCursor {
  follow = true;          // stick to newest
  anchorRow = 0;          // ABSOLUTE index of newest visible row
  displayRows = 0;        // D
  scrollByRows(n: number): void;
  scrollToLive(): void;
  setDisplayRows(d: number): void;
  clamp(totalWritten: number, oldestAbs: number): void;
}
```

Anchor in absolute space is what makes a paused view stay put as new rows arrive. When
`follow`, `anchorRow = totalWritten - 1` each frame. `clamp()` bounds it to
`[oldestAbs + D - 1, totalWritten - 1]`, allowing blank fill when fewer than `D` rows
exist yet.

#### What happens at the oldest end — the treadmill

> Phase-1 behavior only. Backend paging now supplies a stable session start, so
> the treadmill does not occur while the active backend session is retained.

`oldestAbs = max(0, T - N)` tracks `T`, so the **lower clamp bound rises by one for every
row that arrives**. A parked `anchorRow` is a fixed number, so once the floor reaches it,
`clamp()` pushes it up one row per arrival and the view **drifts forward at exactly the
ingest rate** — the same visual speed as live mode, but showing the oldest retained data
sliding away rather than new data arriving. The user cannot hold still there; the write
head is overwriting rows as fast as they would need to scroll to stay put.

Generalised: every parked position has a finite **freeze budget** —
`anchorRow - (oldestAbs + D - 1)` rows of slack before drift begins.

| Parked at | Slack | @16 Hz | @1 Hz |
|---|---|---|---|
| Just left follow | `N - D` ≈ 3646 rows | 3.8 min | 61 min |
| Mid-ring | ≈ 1600 rows | 1.7 min | 27 min |
| Oldest end | 0 | drifts immediately | drifts immediately |

The ceiling is `N / rate` — **~4.3 min at 16 Hz**, matching the scale table in
[history-paging-api.md](history-paging-api.md) §2. Inherent to a ring buffer, not a
defect, and the strongest argument for phase 2 at high ingest rates.

Rejected alternative: letting the anchor go stale and rendering expired rows as blanks.
Blanks would creep up from the bottom until the whole view is empty, which is strictly
worse than drifting. Clamping is correct — it just needs to be *visible* (item 8).

Note there is **no drift at all until the ring first fills** (`T < N`, the first ~4 min at
16 Hz), because `oldestAbs` is pinned at 0. Don't be misled by testing on a fresh page
load — exercise this after the ring has wrapped.

**Done when** the class is constructed and handed around but not yet consumed by any
renderer, and these hold by inspection:

- `follow = true` → `anchorRow` tracks `totalWritten - 1` every `clamp()`.
- `scrollByRows` while `follow` clears `follow`; `scrollToLive()` restores it.
- With `totalWritten < D` (cold start), `clamp()` leaves the anchor at `totalWritten - 1`
  rather than forcing it negative — the view fills from the top with blanks below.
- Scrolling to the oldest end stops at `oldestAbs + D - 1` and does not drift further on
  repeated input.

### 3. `WaterfallRenderer` rewrite — net deletion

**This is the largest item and it removes more code than it adds.**

Today the texture is `D` rows tall, written as a conveyor belt (`pushedCount % rowCount`)
across `2N` pre-built quads with a translation uniform. It structurally cannot show more
than the last `D` rows.

Make the texture the ring buffer 1:1 (`N` rows). `mount()` already uploads
`ringBuffer.data` directly when the sizes match — that becomes the only path.

**Delete:** `buildRowGeometry`, the two-copy quad belt, `uTimeTranslation`, the
`pushedCount` field, and the sub-pixel snapping hack in `render()`.

**Replace with** one full-screen quad and row math in the fragment shader:

```glsl
float tx = mix(uViewStart, uViewEnd, vQuadX);
int binX = clamp(int(tx * float(uBinCount)), 0, uBinCount - 1);

int rowFromTop = int(floor(float(uDisplayRows) * (1.0 - vY)));
int absRow = uAnchorRow - rowFromTop;

if (absRow < uOldestValid || absRow < 0) {
    outPixelColor = vec4(uBlankColor, 1.0);   // past end of history
} else {
    float s = texelFetch(uWaterfallTex, ivec2(binX, absRow % uHistoryRows), 0).r;
    /* ...existing normalize + LUT + highlight... */
}
```

- `push()` uploads at the absolute-mod-`N` ring row. `SpectrumCore` **already passes this
  as `_writtenRow` and the current code discards it** — start using it.
- Scrolling costs one uniform and zero uploads, so it stays 60fps at any depth.
- `texelFetch` reproduces the current `NEAREST` sampling exactly — no visual change
  expected at rest.
- `setRowCount(n)` becomes `setDisplayRows(n)`: a uniform, not a texture reallocation.
  Subview resize stops rebuilding textures as a side benefit.
- Query `gl.MAX_TEXTURE_SIZE` at mount. Height is ours (`N` = 4096, always safe); **width
  is the binding dimension** — 8k bins needs a limit of ≥8192. See risk 1.

**Done when** (all checkable without a before/after screenshot):

- `buildRowGeometry`, `uTimeTranslation` and `pushedCount` no longer appear in the file.
- The texture is allocated once at `N × binCount` and never reallocated on window resize
  (temporarily log in `createTexture` to confirm).
- **Marker-row test:** push a row with every bin at a distinctive constant value. In
  follow mode it renders as a 1-row line flush against the top edge. With
  `anchorRow = T - 1 - k` it renders exactly `k` rows down. This pins the row→pixel
  mapping precisely and is the single most valuable check here.
- Row height stays constant while streaming — no shimmer or alternating 1px/2px rows.
  (The deleted snapping hack existed to paper over this; the new mapping is exact by
  construction, so any shimmer means the row math is wrong.)
- Frequency mapping still agrees with the axis: a known signal sits at the same x as its
  label in `FrequencyAxisController`, at rest and while zoomed.

### 4. Render loop + scroll input

**Files:** `SpectrumCore.ts`, `InputHandler.ts`

- Call `TimeCursor.clamp()` at the top of `renderAll()`; pass the anchor to each renderer.
- **Plain wheel keeps frequency zoom, unchanged, on both panes.** Frequency zoom is the
  primary interaction; history scrolling is secondary and goes behind a modifier.
- **`shift` + wheel on the waterfall = time scroll.** Prefer `shift` over `ctrl` and
  `alt`: `ctrl`+wheel collides with browser page zoom and macOS trackpad pinch (which
  synthesises `ctrl`+wheel), and `alt`+wheel is claimed by some Linux window managers.
  The existing listener is already `{ passive: false }` with `preventDefault()`, so
  `shift`+wheel's default horizontal-scroll behaviour is suppressed for free.
- `PageUp` / `PageDown`, `Home` = jump to live.
- Any scroll input must call `scheduleRender`.

**Deliberately not bound: vertical drag on the waterfall.** It is technically free —
`InputHandler.onMouseMove` reads only `clientX`, so the Y axis of a drag is unused — and
it would be the most discoverable gesture. It is rejected because an imprecise horizontal
pan would drift vertically and silently drop the view out of follow mode, which reads as
"the display froze". That is the wrong failure mode given that frequency panning is the
more common action. Revisit only with a dead zone (~4px) if the modifier proves awkward.

**Done when:** `shift`+wheel on the waterfall scrolls through history and stops cleanly
at both ends; the view stays visually frozen while paused as new data streams in; `Home`
returns to live; **plain wheel zooms frequency exactly as it does today**, on both panes,
with no regression in feel.

> **Checkpoint A — items 1–4 give a working scrolling waterfall.** Everything after this
> is correctness and polish on top. Worth committing here.

### 5. `TimeLabelsController` rewrite

The current design is push-driven: it creates a label every `rowInterval` pushes and
moves it by age. It structurally cannot render a frozen or scrolled window, so this is a
rewrite rather than an edit.

Replace with a declarative `render(anchor, displayRows)`:

- Walk timestamps across the visible window; emit a label at each wall-clock boundary
  crossing, with the interval chosen from the window's span (1s / 5s / 10s / 30s / 1m / 5m).
- Position `y = (anchor - absRow) / D`.
- Pool the DOM nodes — do not recreate per frame.
- Widen the gutter in [SpectrumRows.css.ts](src/Spectrum/react/SpectrumRows.css.ts)
  (`timeLabels`) to fit `HH:MM:SS`.

**Done when:** labels show absolute clock time, stay pinned to their rows while scrolling,
re-space sensibly on window resize, and don't leak DOM nodes over a long session.

### 6. `AnnotationRenderer` — convert blocks to absolute indices

This is a genuine rewrite of the incremental path, not a one-line edit. Read
`computeBlocksFull`, `computeBlocksIncremental` and `computeBlocks` in full first.

**Why the existing gate cannot simply be deleted.** `computeBlocks` currently falls back
to a full rescan unless `displayRowCount === rowCount`
([AnnotationRenderer.ts:246](src/Spectrum/core/AnnotationRenderer.ts#L246)). That gate is
load-bearing: `computeBlocksIncremental` relies on the identity documented at
[line 177](src/Spectrum/core/AnnotationRenderer.ts#L177) — *"newRowIdx = W % rowCount ←
the row just written AND the slot that just expired as oldest"* — and detects an
expiring bottom edge with `block.botRowIdx === newRowIdx`. That identity holds only when
`D === N`. Once `D < N`, the row expiring from the **view** is
`(writeRow - 1 - D + N) % N`, not `newRowIdx`, so the trim logic fires on the wrong
blocks. **Deleting the condition alone produces incorrect annotation boxes**, and leaving
it produces a full `N × binCount` rescan on every pushed row (33M byte reads per frame at
8k bins, presenting as "the app got slow").

**The fix dissolves the coupling rather than working around it.** Two changes together:

1. **The block list spans the whole ring, not the display window.** `computeBlocksFull`
   currently iterates `di < displayRowCount`; it must iterate `di < rowCount`. Scrolling
   means any part of the ring can become visible, so blocks must exist for all of it.
2. **Blocks store absolute row indices** (`topAbs` / `botAbs`) and the incremental logic
   is restated in absolute terms, which removes the modular arithmetic entirely:

   | Current (ring indices) | Replacement (absolute) |
   |---|---|
   | `block.topRowIdx === prevRowIdx` (is open) | `block.topAbs === T - 2` |
   | `block.botRowIdx === newRowIdx` (expiring) | `block.botAbs < T - N` |
   | trim to `(newRowIdx + 1) % rowCount` | trim `botAbs` to `T - N` |
   | drop 1-row block at expiring slot | drop when `topAbs < T - N` |

Consequences, all of them simplifications:

- The gate in `computeBlocks` becomes `delta === 1` alone. `displayRowCount` leaves block
  computation completely — it survives only in `render()`, where display size belongs.
- `setDisplayRowCount` no longer recomputes anything, so **window resizing stops
  triggering rescans** (today every `ResizeObserver` fire during a drag causes one).
- The full scan runs at construction only.
- Render Y becomes `ageTop = max(0, anchor - topAbs)`, `ageBot = anchor - botAbs`. The
  `max(0, ...)` matters: a block extending above the visible window would otherwise
  produce an inverted rect. The ring-index version cannot express this cleanly, which is
  the second reason for going absolute.
- With `N ≫ D` most blocks are off-screen, and `render()` iterates the block list four
  times (border outline, border, corner outline, corners). **Cull once into a visible
  list, then run the four passes over that.**

**Done when:** annotation boxes stay locked to their rows while scrolling, including
blocks that extend past the top and bottom edges of the view; resizing the window does
not recompute blocks; a streaming session shows no per-row full rescan in a profile.

### 7. `TooltipController`, `LiveRenderer`, overlay dimming

- Tooltip row mapping ([TooltipController.ts:99-104](src/Spectrum/core/TooltipController.ts#L99-L104))
  → absolute math from the anchor. The `time` field then shows real historical
  timestamps for free.
- `LiveRenderer` draws `anchorRow` instead of newest
  ([LiveRenderer.ts:157](src/Spectrum/core/LiveRenderer.ts#L157)) so the trace matches the
  top of the visible waterfall. Same for the annotation-border scan at
  [LiveRenderer.ts:249-258](src/Spectrum/core/LiveRenderer.ts#L249-L258).

**Overlays dim while scrolled.** avg / max / maxSnapshot / occupancy are all-time
accumulators ([AverageLayer.ts:16-38](src/Spectrum/core/AverageLayer.ts#L16-L38)) and
cannot describe a historical window. When `follow === false`, draw them at reduced alpha
(a `ctx.globalAlpha` multiplier around the overlay pass is enough — do not touch the
per-layer `rgba()` colours) so they read as context rather than as measurements of what
is on screen.

Precedent: bench spectrum analysers (Keysight X-series, R&S) drive the trace display from
the *selected frame* in spectrogram views, and blank or re-scope max-hold and average
rather than leaving them live over frozen history. Dimming is the cheap version of the
same honesty — what must not happen is overlays rendering at full strength over a frozen
waterfall, because the eye reads trace and waterfall as one moment.

The accumulators keep accumulating underneath, untouched, so returning to live is exact.
No snapshotting, no recomputation, no perf risk in this item.

Item 8's `⏸ HH:MM:SS` indicator carries the explicit signal; dimming alone would read as
a style choice, so **item 8 is the other half of this** and they should be verified
together.

**Done when:** tooltip shows the correct historical timestamp and dBm for the hovered
row; the live trace matches the top visible waterfall row; overlays visibly recede when
scrolled and return to full strength on `Home`; returning to live shows overlay values
unchanged from before the scroll.

### 8. Follow/pause UI

**Files:** `store.ts`, `Spectrum.tsx`, `SpectrumRows.tsx`

**Not just polish.** With time scroll behind `shift`+wheel (item 4), the scrollbar is the
only discoverable entry point to the feature — a user who never guesses the modifier
reaches history through this and nothing else. Treat it as part of the feature, not a
finishing touch.

- `followingAtom`, `historyPositionAtom` (for the readout).
- Scrollbar on the waterfall's right edge showing position within retained history.
- `● LIVE` / `⏸ HH:MM:SS` indicator; clicking it jumps to live.
- **Distinct state when pinned at the oldest end.** Once the treadmill (item 2) engages,
  the anchor advances on its own and the paused timestamp *keeps changing* — which reads
  as a bug unless labelled. Show something like `⏸ OLDEST · HH:MM:SS` and consider a
  bottom-edge treatment on the waterfall while data is expiring under the view.
- Consider surfacing remaining **freeze budget** — the scrollbar already encodes it as
  the gap between the thumb and the bottom of the track, so it may need no extra UI.

**Done when:** the indicator reflects state accurately, the scrollbar is draggable and
agrees with wheel scrolling, the control is reachable without a mouse wheel, and parking
at the oldest end of a wrapped ring shows the pinned state rather than a silently
advancing paused timestamp.

### 9. Subviews — crop the texture to the subview's frequency range

Each subview owns its own canvas and therefore its own WebGL context, and **textures
cannot be shared across contexts**. A naive full-ring texture per subview costs 33 MB
apiece (130 MB with three).

The bound is to stop storing bins the subview cannot display. A subview only ever renders
`normalizedStart..normalizedEnd`, and its `Viewport` already clamps zoom to exactly that
span via `resetStart`/`resetEnd` — so out-of-range bins are unreachable and cropping
loses nothing at any zoom level.

Texture becomes `N × subBins`:

| Subview span | subBins @ 8k | Texture |
|---|---|---|
| 5% | 400 | 1.6 MB |
| 10% | 800 | 3.3 MB |
| 25% | 2000 | 8.2 MB |

At that size subviews hold the **full ring depth** and scroll in sync with the main view
using the same shader, with **zero re-upload on scroll**.

- `push()` extracts the subview's bin sub-range (`subarray` + `texSubImage2D` of
  `subBins` bytes) — trivial per-frame cost.
- Shader maps global-normalised `tx` to local texel:
  `binX = clamp(int(tx * uBinCount) - uSubBinStart, 0, uSubBins - 1)`.
- Only a subview spanning most of the band approaches the naive cost, and at that point
  it is not really a subview.

**Done when:** subviews scroll in lockstep with the main view; GPU memory scales with
subview span, not with `binCount`; adding/removing subviews at runtime is stable.

**Architectural end state, if pane count ever grows** (explicitly not now): render every
pane into a *single* WebGL canvas via `gl.viewport`/`gl.scissor`, positioned under the
layout with CSS. One shared full-ring texture then serves all panes — 33 MB total
regardless of subview count. Real refactor of the React canvas layout; not worth it at
today's pane counts.

## Deferred follow-ups

Out of scope for phase 1, listed so they are not re-derived.

### Window-scoped overlay aggregates

Replace item 7's dimming with overlays that actually describe the visible window: a
`WindowAggregates` helper that, given `(anchor, D)`, produces avg / max / occupancy over
the visible rows. **Replay the EWMA across the window** rather than taking a flat mean,
so `avgTau` keeps its exact meaning.

Deferred because it is genuinely standalone — it changes what the overlay arrays contain
and nothing else. No renderer, no coordinate, and no data-structure decision in phase 1
depends on it, so picking it up later costs nothing beyond re-reading this section.

Notes for whoever does it:

- Cost is `D × binCount` byte reads per layer ≈ 3.6M at 8k bins — a few ms. Debounce to
  scroll-stop; during a continuous gesture keep showing the last computed set.
- `follow === true` must render the live accumulators directly and skip the helper
  entirely, so the live path stays free.
- Occupancy depends on a client-side threshold, so it stays client-computed regardless.
- Phase 2 consequence: the backend either ships per-page aggregates (max/min/sum/count,
  all of which combine across pages) or the client computes from loaded pages. EWMA is
  order-dependent and never combines. See
  [history-paging-api.md](history-paging-api.md) §7.

## Risks

1. **`MAX_TEXTURE_SIZE` is a hardware requirement.** The backend supports up to 8k bins
   and the texture is `binCount` wide, so **the client needs a limit of ≥8192** — 8192
   bins sits exactly at the limit on devices reporting 8192. This is **not introduced by
   this work**; the current renderer already builds a `binCount`-wide texture, so any
   device that can't do 8k bins is already broken. The change is to query at mount and,
   if `MAX_TEXTURE_SIZE < binCount`, fail with a clear message instead of rendering black.
   Desktop is universally 16384; older Android mid-range is where 4096 still appears.
   `N` = 4096 is always safe.
2. **Overlays can't rewind.** avg / max / occupancy are all-time accumulators and phase 1
   does not make them window-scoped — they are dimmed instead (item 7). Accepted
   limitation, not a bug; the real fix is deferred above.
3. **67 MB is allocated eagerly** — accepted deliberately. `RingBuffer` already does
   `new Int8Array(N * binCount).fill(...)` in its constructor, so this is existing
   behaviour rather than a change: predictable footprint, no realloc stalls, no GC churn.
   Cost is a one-off startup allocation at 8k bins.
4. ~~Subview GPU cost~~ — **resolved**: texture cropped to frequency range, item 9.

## Phase 2 readiness

Backend proposal: [history-paging-api.md](history-paging-api.md). What phase 1 must do so
paging drops in cleanly:

- **Absolute row indices everywhere** — anchor, block indices, tooltip. Central to the
  design above. Phase 2 makes these *be* the backend's `seq`, so the live socket must
  carry `seq` from day one — otherwise history and live are in different coordinate
  spaces and cannot be stitched.
- **`N` is a power-of-two multiple of the page size** so ring slots map cleanly onto
  pages. Page size is byte-budgeted server-side (128 rows at 8k bins, not 512).
- **One place answers "is row R available?"** Phase 1: `R >= T - N`. Phase 2: a page map.
  Keep it a single predicate (`hasAbs`), not an inline comparison at each call site.
- **`RingBuffer` is push-only** ([RingBuffer.ts:33-38](src/Spectrum/core/RingBuffer.ts#L33-L38))
  — single `writeRow`, no way to write into the old end. This is *the* structural blocker
  for paging; phase 2 replaces it with a page-indexed store behind the `*Abs` read API
  from item 1.

## Order and estimate

| # | Item | Est. |
|---|---|---|
| 1 | Decouple `N`/`D`, absolute accessors | 2h |
| 2 | `TimeCursor` | 1h |
| 3 | `WaterfallRenderer` rewrite | 3h |
| 4 | Render loop + scroll input | 3h |
| | **Checkpoint A — scrolling waterfall works** | |
| 5 | `TimeLabelsController` rewrite | 3h |
| 6 | `AnnotationRenderer` → absolute indices | 5h |
| 7 | Tooltip + `LiveRenderer` + overlay dimming | 2h |
| 8 | Follow/pause UI | 3h |
| | **Checkpoint B — feature complete for the main view** | |
| 9 | Subviews (cropped texture) | 3h |

Items 1–4 are strictly ordered. 5–8 are independent of each other and can be done in any
order after checkpoint A. Item 9 is last and is the only safely deferrable one — if cut,
subviews stay live-only while the main view scrolls, which is visibly inconsistent but
not broken.
