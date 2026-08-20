# Signal detection — execution brief

**Status:** proposal, nothing built. Written from a cold context — no prior conversation
required. Read it fully before editing anything.

**Relationship to the other briefs.** This supplies the detector that
[frequency-watches.md](frequency-watches.md) assumed already existed.

- [frequency-lanes.md](frequency-lanes.md) is **implemented**. Lanes are read here, never
  changed. `ProfileRange.watched` and `MAX_LANES` already exist.
- [frequency-watches.md](frequency-watches.md) items 4–5 (`WatchEvaluator`, event
  surfacing) stay live and are **not re-specced here**. But its non-goal *"the backend
  already emits per-row detections; this brief consumes them and does not add DSP"* is
  **withdrawn**, and with it its risk 3. The annotation channel is reserved for a separate,
  standalone purpose and is **not** a detection source. Everything downstream of this
  brief consumes `DetectionLayer` instead.

## Objective

Tell the operator that **something appeared that is not noise and was not there before**,
without requiring them to have been looking.

The driving request is the same one behind lanes: *"I know something might appear at
145.5 MHz and I want to see it all the time."* Lanes made the range **visible**. This makes
an arrival **noticed**.

**Non-goals** (do not build these, do not refactor toward them):

- **Using the annotation channel.** Reserved for a separate standalone purpose. Do not
  read `frameBuffer.annotations` here, do not write to it, do not extend its interval
  format.
- **Classification.** What a signal *is* — modulation, emitter, identity. Out of scope
  and nothing here presumes it later.
- **Server-side detection.** Client-side over the existing ring, deliberately, for the
  reason in [frequency-watches.md](frequency-watches.md) risk 1: learn whether the
  detections are *useful* before paying for an evaluator, storage and a delivery channel.
- **CFAR across frequency.** Named in [Risks](#risks) as the fix for the one case a
  temporal detector structurally cannot see. Deferred, and this brief does not block it.
- **Event surfacing.** Rail marks, the event list and lane flash are
  [frequency-watches.md](frequency-watches.md) item 5. This brief renders *detections*,
  not *events* — see [What this brief does not render](#what-this-brief-does-not-render).
- **Per-lane threshold tuning UI.** One global margin, exposed once.

## Working agreement

| | |
|---|---|
| Typecheck gate | `npx tsc -b` — **currently passes clean; keep it that way** |
| Dev server | `npm run dev` (backend: `npm run dev:backend`, port 8787) |
| Production build | `npm run build` (`tsc -b && vp build`) |
| Lint | `npx vp lint` fails to load its config (pre-existing env issue). Do not chase it. |
| Tests | None in the client. The Go backend has tests and is untouched by this work. |

No client test suite, so **each work item lists explicit acceptance criteria.** Items 1–2
are pure and headless — verify them by logging to the console before any pixel is drawn.

## Codebase orientation

Read these first: [MaxHoldLayer.ts](src/Spectrum/core/MaxHoldLayer.ts) (22 lines — the
minimal example of the layer pattern), [AverageLayer.ts](src/Spectrum/core/AverageLayer.ts),
[OccupancyRenderer.ts](src/Spectrum/core/OccupancyRenderer.ts),
`SpectrumCore.processNewRows()`, [LaneCore.ts](src/Spectrum/core/LaneCore.ts).

**The layer pattern.** A layer is a plain object that owns a typed array, is constructed in
`SpectrumCore.mount()`, is fed one row at a time from `processNewRows()`, and is read by
whatever draws it. It has no DOM, no canvas and no lifecycle beyond `reset()`.
`MaxHoldLayer` is the whole pattern in 22 lines. **`DetectionLayer` is one more of these.**

```
FrameBuffer.push(spec, ann, ts)
  └→ SpectrumCore.processNewRows()          ← the only place rows fan out
        ├→ maxHold.push(specRow)
        ├→ avgLayer.push(specRow, ts)
        ├→ occupancyRenderer.push(specRow)
        ├→ detectionLayer.push(abs, specRow)          ← new
        │     ├─ floor      per-bin quantile tracker
        │     ├─ threshold  floor + margin, dual-level
        │     ├─ persist    M-of-K in, hang-time out
        │     ├─ group      contiguous bins → intervals
        │     └─ familiar   onset counts → novelty verdict
        ├→ waterfallRenderer.push(abs, specRow)
        └→ lanes, annotations …
```

**Facts that matter here.**

- **Samples are `Int8` dBm directly**, not normalized. `POWER_NO_READING = -128` is the
  no-data sentinel; `POWER_FLOOR = -110`, `POWER_CEILING = 30`
  ([constants.ts](src/Spectrum/core/constants.ts)). Skip `POWER_NO_READING` bins in every
  loop below or they will drag the floor estimator to the bottom of the range.
- `binCount` is capture-supplied (4000 in the default config). `HISTORY_ROWS = 4096` is
  retained depth `N`; `D` is the waterfall height in CSS pixels.
- **`resetAll()` already resets max hold, average and occupancy** and calls `onReset`. It is
  the existing "start over" control and this brief hangs the baseline lifetime on it.
- **`LiveRenderer`, `OccupancyRenderer` and `AnnotationRenderer` are all canvas-2D**
  (`getContext("2d")`). Only `WaterfallRenderer` is WebGL. A 2D overlay therefore costs
  **no** GL context and does not push against `MAX_LANES = 6`.
- `LaneCore.mount(host)` creates and owns its own canvas inside a React-supplied host div.
  A second overlay canvas follows the same pattern.
- `ProfileRange` today is `{ id, numericId, name, freqStartMHz, freqEndMHz, powerDbm,
  watched }`. **`powerDbm` is stored, editable and read by nothing** — item 5 is where it
  is finally read. There is no `alerting` flag yet;
  [frequency-watches.md](frequency-watches.md) item 1 adds it.

> Line numbers drift. Each reference names the symbol — trust the symbol.

## Why a fixed threshold fails

The app already contains two things that look like they could answer this, and neither can.

| | What it is | Why it cannot be the detector |
|---|---|---|
| `OccupancyRenderer.threshold` | **One global dBm number**, default `-82` | A real noise floor tilts across frequency and drifts with gain and temperature. One number is simultaneously too hot in noisy regions and deaf in quiet ones. |
| `AverageLayer` (EWMA, τ = 2000ms) | Per-bin running mean | **Contaminated by the signal it would exclude.** A carrier up 40% of the time drags its own bin's mean upward until it stops being detectable against it. |

The fix for the first is a **per-bin** floor. The fix for the second is that the floor must
be a **low quantile, not a mean** — a statistic a partially-occupied bin cannot pull.

**A warning about tuning.** The mock backend's noise is
`-90.0 + (rand()+rand()-1)*4` ([backend/main.go](backend/main.go), `generateRow`) — a
*triangular* distribution bounded to `[-94, -86]`, σ ≈ 1.63 dB. Above 4 dB it produces
**literally zero** outliers. Real noise is unbounded and heavier-tailed. Thresholds tuned
until the mock looks clean will be far too tight in the field.

## The central point: novelty is an onset count, not a time window

Detection thresholds are tuning. **Novelty is a modelling choice, and it is the one that
decides whether this feature is usable.** Two obvious rules both fail:

| Rule | Failure |
|---|---|
| *New = never seen before*, remembered forever | New exactly once, ever. A source that appears daily is flagged on day one and never again. |
| *New = not seen in the last N rows* | **A beacon transmitting every N+1 rows is new forever.** Time-windowed absence cannot separate "never seen this" from "haven't seen this lately", and periodic sources live exactly in that gap. |

An occupancy *fraction* (`counts[b] / total`) has a quieter version of the second bug:
`total` grows without bound, so a source that was busy an hour ago and stopped **decays
back into being new**.

**Count onsets — absent→present transitions — not occupied rows:**

```ts
onsetCount[b]++                      // once per absent→present transition
familiar = onsetCount[b] >= FAMILIAR_ONSETS   // 3
```

That single change makes every case converge:

- A carrier on continuously for an hour is **one** onset, not 36,000 rows.
- A beacon every 30s is familiar after ~90s, then permanently quiet.
- **Familiarity persists through silence**, which is exactly the property a rolling
  window lacks.

Everything else in this brief is threshold plumbing. This is the part to get right.

## Decisions — already made, do not re-litigate

| Decision | Value | Rationale |
|---|---|---|
| Noise floor | per-bin **stochastic quantile** tracker, q ≈ 0.3, step ≈ 0.05 dB | one compare + one add per bin per row; a mean is contaminated by the signal |
| Threshold units | **dB above floor**, not absolute dBm | transfers across bands, gain settings and hardware; absolute dBm does not |
| Enter / exit | dual level (enter `+10`, exit `+6`) | a signal hovering on one threshold flickers |
| Persistence | **M-of-K in** (3 of 5), **hang time out** (~1.5s) | bursty signals — voice gaps, FSK transitions, scan periods — fragment into confetti without hang time |
| Novelty | **onset count ≥ 3 = familiar** | see [The central point](#the-central-point-novelty-is-an-onset-count-not-a-time-window) |
| Baseline lifetime | **the session**; cleared by the existing `resetAll()` | operator-explainable ("new since I started watching"), no hidden decay timer, no new control |
| Warm-up | learn onsets but **suppress the flag** for the first `WARMUP_ROWS` | otherwise a session opens with a wall of NEW |
| NEW clears | when the **triggering row has been on screen** | a timer defeats the premise that the operator was looking away |
| Detection source | this layer, from `frameBuffer.spectrum` | the annotation channel is reserved; see the non-goals |
| Lane overlay | **second canvas-2D layer** owned by `LaneCore` | 2D costs no GL context, so `MAX_LANES` is unaffected |
| Marker form | **solid bar in a right-edge margin strip**, never a box over the data | must not read as an annotation; and a margin escapes the colormap's colour space entirely |
| Main view | on the **occupancy strip**, not boxes on the waterfall | dozens of concurrent detections across 4000 bins become hatching |

## Work items

### 1. `DetectionLayer` — floor, threshold, intervals

**New file:** `src/Spectrum/core/DetectionLayer.ts`

Headless and pure, in the shape of [MaxHoldLayer.ts](src/Spectrum/core/MaxHoldLayer.ts).
Owns `Float32Array(binCount)` for the floor and small `Uint8Array`s for state.

```ts
type Detection = {
  startBin: number; endBin: number;
  peakDbm: number;
  startAbs: number;          // absolute row of onset
  endAbs: number;            // absolute row of release, or -1 while open
  isNew: boolean;            // set by item 2
};

class DetectionLayer {
  push(absRow: number, specRow: Int8Array): void;
  readonly open: Detection[];        // currently present
  readonly recent: Detection[];      // bounded ring, 256 — a UI feed, not an archive
  floorAt(bin: number): number;
  reset(): void;
}
```

Per row: update the floor, apply the dual threshold, run M-of-K and hang-time state per
bin, then group contiguous detected bins into runs, merging across gaps of ≤ 2 bins and
dropping runs narrower than `MIN_RUN_BINS` (start at 3 — **run width is itself evidence**,
since a 1-bin hit is far likelier to be noise than a 5-bin one).

Skip `POWER_NO_READING` bins everywhere.

**Done when:** with the mock backend running, logged intervals line up with the visible
blobs in the waterfall; a signal flickering on the threshold produces **one** interval, not
many; no interval is emitted before `WARMUP_ROWS`; `reset()` returns the layer to its
constructed state; a 4000-bin row costs well under a millisecond.

### 2. Familiarity and the novelty verdict

**Same file.**

`Uint16Array(binCount)` of onset counts. On each absent→present transition, increment the
run's bins and **credit immediate neighbours with a fraction of one** — a slowly *drifting*
signal keeps landing on fresh bins and would otherwise fire NEW forever (risk 3).

`isNew = onsetEdge && !familiar(run)`, suppressed entirely during warm-up.

Seed from loaded history the way `AverageLayer` warms its EWMA in its constructor, so a
rehydrated session does not relearn from nothing.

**Done when:** a continuously-on mock signal fires NEW at most once; a periodically-bursting
one stops firing after ~3 bursts and **stays** stopped across a long silence; `resetAll()`
makes everything novel again; nothing is NEW during warm-up.

### 3. Fan-out in `SpectrumCore`

**File:** `SpectrumCore.ts`

Construct in `mount()` beside `maxHold` / `avgLayer` / `occupancyRenderer`; push in
`processNewRows()`; reset in `resetAll()`; null out in `destroy()`. Expose a read API for
the renderers and a `detectionsForRange(startMHz, endMHz)` alongside the existing
`binsForRange`.

**Done when:** detections survive a scroll into history and back; `resetAll()` clears them;
`destroy()` leaves nothing behind; no measurable frame-rate change with six lanes active.

### 4. Lane rendering

**Files:** `LaneCore.ts`, `Spectrum.tsx`, `SpectrumRows.css.ts`

A **second canvas** created by `LaneCore.mount()` over its WebGL canvas — same ownership
rule as the waterfall canvas (created here, removed in `destroy()`), and canvas-2D, so no
GL context. Row→y is the arithmetic the fragment shader already does and
`AnnotationRenderer` already implements in 2D: `y = (anchorRow - absRow) / D * height`.

Draw each detection as a **solid bar in a ~4px strip on the lane's right edge**, spanning
the rows it was present. Bar length reads duration for free.

- **Never a box over the waterfall.** `AnnotationRenderer` draws magenta dashed boxes with
  corner brackets; a solid unbroken bar in the margin differs in *position and form*, so
  the two are unmistakable before colour is even considered.
- Palette is nearly fully allocated — green `74,222,128` activity/live, amber
  `250,190,40` average/paused, red max hold, purple snapshot, magenta annotation. Use
  **green for routine detection**, **white for NEW**. In a margin strip neither competes
  with the black→blue→cyan→green→yellow→red heat map.
- One extra label line: `2 new · 3m ago`. Text, no surface, and **it stays true after the
  bar has scrolled out of the `D`-row window** — which at ~450 rows is only a couple of
  minutes.

**Done when:** a bar sits at the same y as the rows that produced it, in follow mode and
scrolled back; it scrolls in exact lockstep with the lane's waterfall; the bar never
overlaps waterfall pixels; removing a lane releases both canvases.

### 5. NEW flag lifecycle and `powerDbm`

**Files:** `DetectionLayer.ts`, `SpectrumCore.ts`, `ProfilePanel.tsx`

A NEW flag clears **when its triggering row has actually been on screen** — computable
every frame from `anchorRow` and `displayRows`. Watching live, it clears as the event
scrolls past; away or scrolled back in history, it is still waiting on return.

This is also where **`powerDbm` is finally read**: when set, it acts as a per-range floor
override — a run whose peak inside the range is below it does not count. Surface it in the
profile panel next to the existing `lane` toggle.

**Done when:** a NEW flag raised while scrolled back into history survives until the
operator returns to it; a flag raised in follow mode clears on its own; raising `powerDbm`
above a mock signal's peak suppresses its flag.

### 6. Main-view rendering and a visible baseline

**Files:** `OccupancyRenderer.ts`, `SpectrumRows.css.ts`

Overlay currently-open detections on the **occupancy strip** — already the per-bin
frequency summary, already on screen at `0.75rem`, no new vertical space. Draw familiar
bins distinctly from unfamiliar ones.

That second half is not decoration. Automatic learning's real cost is an **invisible
baseline**: when a detection does not fire, the operator has no way to see why. Making
familiarity visible is what keeps a miss explainable — do it with item 6, not after.

**Done when:** open detections are visible on the strip and clear when released; familiar
and unfamiliar bins are distinguishable; no vertical dimension anywhere on the page changes.

### 7. "Mark normal"

**Files:** `SpectrumCore.ts`, `Spectrum.tsx`

Lane-scoped: bump that lane's bins past `FAMILIAR_ONSETS`. It reads as *"stop telling me
about this one"* rather than a global mode change.

With the existing **Reset**, the operator gets two verbs, and — the point — **both are
reactive**. Neither requires acting *before* the interesting thing happens, which is the
fatal flaw of any baseline you must capture in advance.

**Done when:** marking a lane normal stops its detections firing NEW without suppressing
the bars; `resetAll()` undoes it.

## What this brief does not render

[frequency-watches.md](frequency-watches.md) item 5 already specs **event** surfacing —
lane flash, marks on the position rail in
[HistoryControls.tsx](src/Spectrum/react/HistoryControls.tsx), and a clickable event list.
That work is unchanged by this brief; only its *source* moves from the annotation channel
to `DetectionLayer`. Build it from that brief, not this one.

One overlap to resolve when you get there: `WatchEvaluator`'s `MIN_ROWS` / `RELEASE_ROWS`
duplicate the debouncing in item 1. **Bin-level hysteresis belongs here** ("is this bin
occupied"); **event-level edge detection belongs there** ("did something happen in this
watch"). Once item 1 debounces properly, `MIN_ROWS` can drop to 1.

## Risks

1. **Tuning against the mock will mislead.** Bounded triangular noise means zero outliers
   past 4 dB, so any margin above that looks perfect locally and will be far too tight on
   real hardware. Size the margin from the arithmetic instead: ~1 false alarm/minute across
   4000 bins at 10 rows/s needs about 5σ, which at σ ≈ 1.6 dB is **8–10 dB**. Expose it and
   expect the field to move it.
2. **A signal present before the session started is invisible to this, by construction.**
   A temporal detector defines it as the floor. **This is the highest-value caveat in the
   brief** — it is precisely the "it was already transmitting when I arrived" case, and no
   baseline mechanism, automatic or explicit, catches it. The fix is CFAR across frequency
   (estimate noise from neighbouring bins excluding a guard band): detects on the first
   frame, never adapts away. Out of scope; do not pretend coverage the detector lacks.
3. **A drifting signal re-triggers NEW forever** unless familiarity spreads to neighbouring
   bins. Item 2 handles it; do not drop the neighbour credit as an optimisation.
4. **Warm-up absorbs whatever is transmitting during it.** Unavoidable for a temporal
   method, and the reason warm-up should be short and seeded from loaded history rather
   than long and cautious.
5. **Alert fatigue** — [frequency-watches.md](frequency-watches.md) risk 2 applies
   unchanged. Onset counting is a much stronger mitigation than `MIN_ROWS` was, because a
   busy band goes familiar and quiet on its own.
6. **Per-row cost is a full-span loop**, on top of the three that `processNewRows()`
   already runs. Bounded and small, but profile it at `binCount = 8192` before assuming.

## Deferred follow-ups

Listed so they are not re-derived. None is required here and none constrains this brief.

- **CFAR across frequency** — risk 2. The natural second detector; the two compose by OR.
- **Server-side detection** — the real answer to
  [frequency-watches.md](frequency-watches.md) risk 1. Only the *source* of detections
  moves; every consumer above is unchanged.
- **Persisting the familiarity model across sessions** — makes "normal" mean a site rather
  than a session. Needs storage and an explicit identity for "where am I".
- **Classification.** Deliberately far out of scope.

## Order and estimate

| # | Item | Est. |
|---|---|---|
| 1 | `DetectionLayer` — floor, threshold, intervals | 4h |
| 2 | Familiarity and the novelty verdict | 2h |
| 3 | Fan-out in `SpectrumCore` | 1h |
| | **Checkpoint A — headless. Log detections against the mock and tune before drawing anything.** | |
| 4 | Lane rendering | 3h |
| 5 | NEW lifecycle and `powerDbm` | 2h |
| 6 | Main-view rendering and visible baseline | 2h |
| 7 | "Mark normal" | 1h |

Items 1–3 are strictly ordered and are the whole risk. **Do not start item 4 until
checkpoint A convinces you the detections are right** — every pixel drawn before then is
pixels spent debugging a detector through a renderer.
