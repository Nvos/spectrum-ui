# Frequency watches — execution brief

**Status:** proposal. Nothing here is built.

**Superseded in part.** The lane half of this brief is now specced standalone and more
accurately in [frequency-lanes.md](frequency-lanes.md), which found that lanes need **no
new renderer** — `WaterfallRenderer` already crops via `binStart`/`binSpan`. Items 2 and 3
below are stale; build lanes from the lanes brief. What remains live here is the watch
concept (item 1) and the alerting half (items 4-5).

Written from a cold context — no prior conversation required. Read it fully before editing
anything.

Supersedes the standalone subview form in [history-scroll.md](history-scroll.md) item 9.
Builds on the history stack from [history-scroll.md](history-scroll.md) and
[history-paging-api.md](history-paging-api.md), both of which are implemented.

## Objective

Let a user say **"something might appear at 145.5 MHz and I must not miss it"** and be
served by the app whether or not they are looking at the screen.

That sentence contains two needs, and the app currently meets neither:

| Need | Today |
|---|---|
| Keep the range visible and legible | Subviews — but see [Why today's subviews fail](#why-todays-subviews-fail) |
| Know it happened while nobody watched | Nothing |

**One object serves both.** A **watch** is a named frequency range. It renders as a lane
beside the main waterfall, and it raises events when a signal appears inside it. The
declaration already exists in the codebase as `ProfileRange` — this brief gives it a
renderer and an evaluator.

**Non-goals** (do not build these, do not refactor toward them):

- Server-side detection. Discussed in [Risks](#risks) as the eventual home for
  evaluation; this phase is client-side only and deliberately so.
- A new signal detector. The backend already emits per-row detections; this brief
  consumes them and does not add DSP.
- Notifications outside the tab (OS notifications, email, webhook).
- Preserving the existing standalone subview UI. It is replaced — see item 6.

## Working agreement

| | |
|---|---|
| Typecheck gate | `npx tsc -b` — **currently passes clean; keep it that way** |
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Tests | None in the client. Verify visually in `npm run dev`. |

No client test suite, so **each work item lists explicit acceptance criteria**.

## Why today's subviews fail

Not a matter of polish. The form is wrong for the deployment, which is a laptop in the
field — 16:9, roughly 658px of viewport after browser chrome, and no height to spare.

**Each subview is a complete miniature of the application.**
[SpectrumSubview.tsx](src/Spectrum/react/SpectrumSubview.tsx) mounts a live trace, an
occupancy strip, a frequency axis, a power axis and a waterfall;
[SpectrumSubviewCore](src/Spectrum/core/SpectrumSubviewCore.ts) backs that with seven
controllers, two `InputHandler`s, its own `Viewport`, its own `ResizeObserver` and its
own WebGL context.

Vertical budget at 1366×768:

| | |
|---|---|
| Page padding + live row | 200px |
| `subviewsRow` — fixed `16rem`, `flexShrink: 0` | **256px** |
| Remaining for the main waterfall | **~202px** |

One row of subviews outweighs the primary instrument. Inside each 240px panel the split
is ~142px of chrome against ~98px of waterfall — **the furniture exceeds the content.**

Three further structural problems:

1. **`flexShrink: 0` on a fixed height** means the row never yields to the main view. The
   `subviewFlexMap` resize only redistributes width *among* subviews.
2. **`minWidth: 18rem` with `overflowX: auto`** means the fourth subview scrolls off
   screen. A watch that is not visible is not a watch.
3. **Each panel carries its own vertical time axis.** Reading two panels at the same
   instant means comparing two independent y-scales by eye.

## The shape — lanes

Watched ranges become **narrow full-height columns to the right of the main waterfall,
sharing the existing time gutter**:

```
[time gutter][          main waterfall          ][145.5][446.0][1090]
```

Every lane reads the same `TimeCursor` anchor as the main view, so **a given row sits at
the same y in every column**. That is the whole argument: a waterfall's expensive axis is
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

## Decisions — already made, do not re-litigate

| Decision | Value | Rationale |
|---|---|---|
| Watch identity | **`ProfileRange`, extended** | The declaration already exists and is already draggable on the canvas. A second "range I care about" concept would be one too many. |
| Lane placement | right of the main waterfall, full height | shares the time gutter and the anchor; costs no vertical space |
| Lane width | `6rem` default, user-resizable | enough for a band plus a label at 10px mono |
| Detection source | **backend annotations** | already streaming, already sparse, already consumed by `AnnotationRenderer` |
| `powerDbm` role | **filter on top of annotations**, not an independent test | two notions of "signal present" that can disagree is a bug factory |
| Evaluation site | client, over the live ring | first version; see [Risks](#risks) |
| Event coordinate | `seq` (absolute row index) | same space as history scroll, so seek is free |
| Standalone subviews | **removed** | replaced by lanes; keeping both doubles the surface |

## What already exists

Read these before starting — most of this brief is wiring, not invention.

**The declaration.** `ProfileRange` is
`{ id, numericId, name, freqStartMHz, freqEndMHz, powerDbm }`
([ProfileTypes.ts](src/Spectrum/core/ProfileTypes.ts)), edited by dragging on the canvas
via [ProfileRangeHandler](src/Spectrum/core/ProfileRangeHandler.ts), and managed in
[App.tsx](src/App.tsx). **`powerDbm` is stored, editable, and read by nothing.** Both
[AnnotationRenderer](src/Spectrum/core/AnnotationRenderer.ts) and
[LiveRenderer](src/Spectrum/core/LiveRenderer.ts) draw the blue band and its edges and
stop there. You have a declared threshold with no evaluator.

**The detection.** The backend emits per-row annotation intervals as `[startBin, endBin]`
pairs ([backend/main.go](backend/main.go)) — signal-present detections, not raw power.
The client already keeps `rowActivity: Uint8Array` per ring slot
([AnnotationRenderer.ts](src/Spectrum/core/AnnotationRenderer.ts)). The trigger predicate
is therefore *"does any annotation interval on this row overlap this watch's bins"* — no
DSP, no detector, no threshold to tune from scratch.

**The time axis.** `TimeCursor` is the shared anchor, handed to every renderer and read
fresh each frame. `TimeGutterInput` already owns scroll input for the whole column stack.

**The seek path.** `GET /api/captures/{sessionID}/seek?t=` exists in
[backend/main.go](backend/main.go) and **is not called by any client code**. Jumping to
an event's timestamp is a matter of calling it.

## Work items

### 1. Extend `ProfileRange` into a watch

**Files:** `ProfileTypes.ts`, `App.tsx`

Add `watched: boolean` (renders a lane) and `alerting: boolean` (raises events). Both
default off, so existing profile ranges keep behaving exactly as they do now.

Keep them separate flags. "Show me this band" and "tell me about this band" are genuinely
different intents — a busy band is worth watching and useless to alert on.

**Done when:** existing ranges are unchanged at runtime; the two flags round-trip through
the profile panel; `npx tsc -b` clean.

### 2. The lane — **see [frequency-lanes.md](frequency-lanes.md)**

> **Stale.** This item assumed a new renderer was needed. It is not:
> `WaterfallRenderer` already accepts `binStart` / `binSpan` and an externally-owned
> `TimeCursor`, so a lane is that renderer with a cropped texture and a frozen
> `Viewport`. Build items 1-4 of [frequency-lanes.md](frequency-lanes.md) instead of this
> item and item 3. The description below is kept only for the reasoning about cropping.

**Was: new file** `src/Spectrum/core/WatchLaneRenderer.ts`

A cropped waterfall over the watch's bin range, reading the shared `TimeCursor`. This is
`WaterfallRenderer` with a narrower texture — item 9 of
[history-scroll.md](history-scroll.md) already established that cropping to the frequency
range is correct and loses nothing, since the lane never zooms.

- Texture `HISTORY_ROWS × laneBins`, uploaded in `push()` from the same `subarray` the
  subview path uses today.
- No `Viewport`. A lane shows its whole range, always. **This is the main simplification
  over a subview** — no zoom, no pan, no `InputHandler`, no per-lane `ResizeObserver`
  beyond width.
- Same fragment shader row math as `WaterfallRenderer`, so blanking past the end of
  history is inherited rather than reimplemented.

**Done when:** a lane renders its range at full ring depth; scrolling the time gutter
moves the lane and the main waterfall in exact lockstep (**marker-row test:** push a row
of constant value and confirm it lands on the same y in both); no lane allocates a
`Viewport` or an `InputHandler`.

### 3. Lane layout

**Files:** `SpectrumRows.tsx`, `SpectrumRows.css.ts`, `Spectrum.tsx`

Lanes sit in the waterfall row, right of the waterfall canvas container, before the
colormap legend. Each is a flex column: a `1.25rem` label header, then the canvas.

- Default width `6rem`, `flexShrink: 0`, user-resizable by a drag handle between lanes —
  reuse the pattern already in [App.tsx](src/App.tsx) for `subviewFlexMap`.
- The main waterfall container stays `flex: 1`, so lanes take width from it and nothing
  else moves.
- **Cap the total lane width** at ~40% of the row. Past that the main view stops being
  the main view; the failure mode of today's panels was exactly an uncapped secondary
  surface.

**Done when:** adding lanes narrows the main waterfall and changes no vertical dimension;
the time gutter and its labels serve every lane; four lanes fit at 1366px without
horizontal scroll; removing all lanes restores the original layout exactly.

### 4. `WatchEvaluator` — the trigger

**New file:** `src/Spectrum/core/WatchEvaluator.ts`

Per pushed row, per alerting watch: does any annotation interval overlap the watch's bin
range? Annotations are sparse (a few intervals per row), so this is a handful of integer
comparisons per watch per row — it belongs in `processNewRows()` alongside the existing
per-row fan-out.

```ts
type WatchEvent = {
  watchId: string;
  startSeq: number; endSeq: number;
  startMs: number; endMs: number;
  peakDbm: number;
};
```

- **Rising edge after `MIN_ROWS` consecutive active rows** opens an event. `MIN_ROWS`
  guards against single-row detector noise; start it at 3 and expose it.
- **Falling edge after `RELEASE_ROWS` consecutive inactive rows** closes it. Hysteresis,
  not a bare inverse — a signal that flickers on the detector's edge would otherwise
  produce a burst of events instead of one.
- `powerDbm`, when set, filters: rows whose peak inside the range is below it do not
  count as active. This is where the field finally gets read.
- Keep a bounded ring of recent events (256) — this is a UI feed, not an archive.

**Done when:** a signal appearing in a watched range produces exactly one event with
correct start/end timestamps; a signal flickering across the detector threshold produces
one event, not many; a signal outside the range produces none; raising `powerDbm` above
the signal's peak suppresses the event; a profiling session shows no measurable per-row
cost with eight watches active.

### 5. Event surfacing

**Files:** `store.ts`, `HistoryControls.tsx`, `App.tsx`

Three surfaces, in ascending cost:

1. **Lane flash.** A lane with an open event gets a border treatment. Free, and it is the
   signal the original request literally asked for.
2. **Marks on the position rail.**
   [HistoryControls.tsx](src/Spectrum/react/HistoryControls.tsx) already renders a passive
   rail spanning the retained session; event positions map onto it with the same
   `scrollTop` arithmetic. This turns the rail from a position readout into a target map —
   *"something happened there"* — which is what makes deep history navigable at all.
3. **Event list.** Newest first, `HH:MM:SS · name · duration`. Clicking one calls
   `core.scrollHistoryTo(event.startSeq)`.

**Done when:** an event marks the rail at a position matching where scrolling to it lands;
clicking a list entry parks the waterfall on that event; marks survive scrolling and
resize; the list does not grow without bound.

### 6. Remove standalone subviews

**Files:** `SpectrumSubview.tsx`, `SpectrumSubviewRows.css.ts`, `SpectrumSubviewCore.ts`,
`SubviewHighlightController.ts`, `App.tsx`, `index.ts`

Delete the subview form and its panel UI. Migrate any subview definition in local state
to a watch with `watched: true`.

**Do this last and as its own commit.** Items 1–5 stand alone; if lanes turn out to be
wrong in the field, this is the commit to revert and nothing else needs unpicking.

**Done when:** `SpectrumSubview` no longer appears in `src/`; the public surface in
`src/Spectrum/index.ts` exports watches instead of subviews; `npm run build` clean.

## Risks

1. **Client-side evaluation only sees rows that pass through the ring while the tab is
   open.** Close the page and events are missed. This is the honest limitation of the
   phase and it is accepted deliberately: the point of building it client-side first is to
   learn whether the alerts are *useful* before paying for a server-side evaluator,
   persisted event storage, and a delivery channel. **Do not present this as "you will not
   miss it"** in the UI — the readout should say what it actually covers.
2. **Alert fatigue.** A watch on a busy band produces continuous events and trains the
   user to ignore the feed. `MIN_ROWS` and `RELEASE_ROWS` are the mitigation; a per-watch
   mute is the fallback. Watch for this in field use before adding more surfaces.
3. **Detector semantics are the backend's, not ours.** Every event inherits whatever
   "signal present" means to the backend's signal model. If that detector is tuned for
   display rather than for alerting, the events will be wrong in ways no amount of client
   work fixes. Confirm this before item 4.
4. **Lane count is bounded by WebGL contexts**, exactly as subviews were. Same mitigation
   as [history-scroll.md](history-scroll.md) item 9's end state — and lanes make it
   *cheap*, because adjacent columns in one row region are the natural case for a single
   canvas with `gl.viewport`/`gl.scissor`. Not required for a first version; the right fix
   when lane count grows past ~4.

## Deferred follow-ups

Out of scope, listed so they are not re-derived.

- **Server-side evaluation.** The real answer to risk 1. Needs an evaluator next to the
  page writer, an events table keyed by `seq`, and a query endpoint. The client work in
  item 5 is unchanged by it — only the source of the event list moves.
- **Watches that outlive a session.** `seq` is session-scoped, so a watch's *events* die
  with the session while its *definition* need not. Persisting definitions is independent
  of everything above.
- **Overview marks at decimated resolution.** Event marks on the rail are the cheap
  approximation of the decimated overview tier in
  [history-paging-api.md](history-paging-api.md) §9. If that tier is ever built, marks and
  the overview strip should share one component.

## Order and estimate

| # | Item | Est. |
|---|---|---|
| 1-3, 6 | Lanes — **see [frequency-lanes.md](frequency-lanes.md)** | 8h |
| | **Checkpoint A — watched ranges are visible, no alerting yet** | |
| 4 | `WatchEvaluator` | 3h |
| 5 | Event surfacing | 4h |
| | **Checkpoint B — feature complete** | |

The alerting items (4-5) depend only on the `watched` / `alerting` flags from item 1 of
the lanes brief, so they can proceed in parallel with the lane work once that lands.
