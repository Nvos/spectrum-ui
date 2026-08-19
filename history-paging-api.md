# History paging — backend proposal (draft)

Phase 2 of [history-scroll.md](history-scroll.md).

**Prototype status (August 2026):** the standard-library Go service in `backend/`
implements session metadata, immutable aligned page batches, timestamp seek, sparse
annotations, and a live stream in the same backend-assigned `seq` space. The client now
uses the backend extent for its scrollbar, fetches settled historical windows in
cancelable batches, prefetches one neighboring page, and keeps a bounded page cache next
to the live ring. The mock backend retains the whole active session in memory. Per-page
aggregates, compression, a bounded production retention policy, overview decimation,
and the WebSocket transport remain follow-up work.

The client keeps a 4096-row in-memory ring and scrolls it (phase 1). Phase 2 makes that
ring a **cache window over backend history** rather than the archive itself.

## 1. Coordinates — the decision everything else rests on

**Every row carries a monotonic `seq`, assigned by the backend, and the live stream
carries it too.**

This is the single most important item. Phase 1's client-side "absolute row index" is
derived from `totalWritten` of the live socket — a number the backend knows nothing
about. If live rows don't carry `seq`, history and live live in different coordinate
spaces and stitching them is guesswork. With `seq` on both, the client sets its absolute
index *to* `seq` and the two are the same space by construction.

Rejected alternatives:

- **Time ranges as the primary key.** Ingest rate varies with bandwidth, so a time range
  yields a variable row count — no fixed pages, messy client row math. Time is still
  supported, but as a *lookup into* `seq` (§4), not as the addressing scheme.
- **Opaque cursors.** Fine for stepping, bad for jumping. The timeline gutter invites
  "take me to 14:32", which needs random access.

### Sessions

`seq` is scoped to a **capture session** with fixed `freqStart` / `resolution` /
`binCount`. A config change starts a new session. Rows from different sessions have
different bin counts and cannot share a texture, let alone a scroll axis — so this is a
hard boundary, not a nicety. Client discards history on session change.

### Gaps

If the client reconnects and sees `seq != lastSeq + 1`, it must render a **gap** (blank
rows) rather than splicing the rows adjacent. Otherwise a 30-second dropout silently
becomes a seamless-looking waterfall and the timeline lies.

## 2. Scale — what retention depth costs, and where this breaks

**Nothing in this proposal assumes one hour.** `seq` is a plain integer (a year at 16 Hz
is ~500M rows, comfortably inside JS's 2^53), pages are fetched on demand, and the client
never holds more than its 4096-row ring. Retention is a server-side policy the client
reads from metadata. The example above implies ~18h, not 1h — that was unstated, and
should have been.

What retention actually costs, spectrum only (annotations are sparse, §5):

| binCount | rate | rows/h | storage/h | 24h |
|---|---|---|---|---|
| 8192 | 16 Hz | 57,600 | 470 MB | 11 GB |
| 8192 | 4 Hz | 14,400 | 118 MB | 2.8 GB |
| 8192 | 1 Hz | 3,600 | 29 MB | 0.7 GB |
| 2048 | 16 Hz | 57,600 | 118 MB | 2.8 GB |
| 2048 | 1 Hz | 3,600 | 7 MB | 0.2 GB |

An hour is 7 MB to 470 MB depending on configuration — a 65× spread. Storage is not the
constraint at any of these; a day of worst-case is 11 GB per session, which is ordinary
for a spectrum archive.

### The real ceiling is navigation, not the API

At `D` ≈ 450 visible rows, one screen holds `450 / rate` seconds:

| rate | one screen | 1h of history | client ring (4096 rows) covers |
|---|---|---|---|
| 16 Hz | 28 s | ~128 screens | 4.3 min |
| 4 Hz | 112 s | ~32 screens | 17 min |
| 1 Hz | 7.5 min | ~8 screens | 68 min |

Two things fall out of this:

1. **Below ~1 Hz, phase 2 may not be needed at all.** The 4096-row ring already covers an
   hour. If your deployments are slow-sweep, phase 1 alone is the feature.
2. **Wheel-scrolling dies around 100 screens.** A scrollbar thumb at 1/128 of the track is
   ~4 px — twitchy but usable; at 24h/16 Hz it's 1/3000 and meaningless. So **~1h at
   16 Hz is roughly where scroll-only navigation stops working**, which is probably what
   prompted the question.

Past that point, two things already in this proposal stop being optional and become
required: **`seek?t=` for jump-to-time** (§4) and the **decimated overview tier** (§9),
with a strip showing the full retention window and a viewport box on it. They are in the
design specifically so that raising retention later is a UI change, not a protocol change.

### Guard: never fetch during a drag

Dragging continuously from live to one hour back at 16 Hz would touch 470 MB if every
intermediate position fetched. Fetch on settle, not during the gesture — and use the
decimated tier for anything that scrubs across more than a few screens. This is a client
rule, but it's the one that decides whether deep retention feels fast or hostile.

## 3. Page size — byte-budgeted, not a fixed 512

512 rows is too big at the top end. At 8k bins a 512-row page is **4 MB of spectrum
alone**, plus annotations — multi-second on a slow link, and far past a smooth-scroll
budget. Budget the bytes, as with the ring:

```
pageRows = clamp(pow2Floor(TARGET_PAGE_BYTES / binCount), 64, 512)   // target 1 MB
```

| binCount | pageRows | Page payload |
|---|---|---|
| 8192 | 128 | 1.0 MB |
| 4096 | 256 | 1.0 MB |
| 2048 | 512 | 1.0 MB |
| ≤1024 | 512 | ≤0.5 MB |

`pageRows` is a power of two and divides the 4096-row ring evenly (32 pages at 8k bins).
Server decides it and reports it in session metadata; the client does not get to choose.

**Honest bandwidth note:** one screen of history at 8k bins is ~450 rows × 8192 B ≈
**3.7 MB**, irreducibly. Smaller pages make it *progressive* rather than a single stall,
but they don't make it smaller. That is what motivates sparse annotations (§5) and the
decimated tier (§9).

## 4. Endpoints

```
GET  /api/captures/{sessionId}                   → session metadata
GET  /api/captures/{sessionId}/pages?from=&count= → binary pages (count ≤ 8)
GET  /api/captures/{sessionId}/seek?t={epochMs}  → { seq }
WS   /api/captures/{sessionId}/live              → live rows, each carrying seq
```

**Session metadata**

```json
{
  "sessionId": "cap_01HZ...",
  "freqStart": 100000, "resolution": 1500, "binCount": 8192,
  "pageRows": 128,
  "seqStart": 8912896,
  "seqEnd":   9961472,
  "startedAt": 1755600000000,
  "retention": { "rows": 5000000, "policy": "ring" }
}
```

`seqStart` (oldest retained) and `seqEnd` (exclusive) give the client the **scrollbar
extent immediately**, before any page loads. The scrollbar must represent all available
history, not just what happens to be cached — otherwise it grows as you scroll, which
feels broken.

**Batch fetch matters.** A fast scroll needs several pages at once; one request per page
turns a flick into a latency pile-up. Cap `count` (8 is plenty) so a client can't ask
for the whole archive in one call.

**Page alignment is enforced.** `from` is a page index, not a row offset. Arbitrary row
ranges would destroy cacheability (§6) for no real gain.

## 5. Wire format — binary, no base64

The current hydration path is base64-inside-JSON ([App.tsx:494-527](src/App.tsx#L494-L527)):
+33% on the wire and a main-thread decode stall. Don't carry that into paging.

Body is `application/octet-stream`:

```
[uint32  headerLen]
[headerLen bytes   JSON header (UTF-8)]
[float64 × rows    timestamps]
[int8    × rows×binCount   spectrum, row-major]
[bytes             annotation intervals]
```

Self-describing, one round trip, `await res.arrayBuffer()` and slice — no parsing of the
bulk payload at all.

```json
{
  "seqStart": 8912896, "rows": 128, "binCount": 8192,
  "annotations": { "encoding": "intervals", "byteLength": 412 },
  "aggregates": { "max": "...", "min": "...", "sum": "...", "count": "..." }
}
```

### Annotations must be sparse

They are overwhelmingly `POWER_NO_READING`, and `AnnotationRenderer` collapses each row
to a handful of `Group`/`Block` intervals anyway — the dense array is decoded only to be
immediately discarded. Ship intervals per row (`rowIdx, startBin, endBin, value`) and
this section goes from 1 MB to a few hundred bytes. **This halves the page payload** and
is the cheapest single win in the whole design.

### Compression

Serve with `Content-Encoding: zstd` (gzip fallback). Spectrum data is noisy Int8 so
expect only ~1.3–2×. If bandwidth becomes the binding constraint, row-over-row delta
encoding before entropy coding exploits the strong temporal correlation between adjacent
rows and should do considerably better — worth measuring, not worth building blind.

## 6. Caching — completed pages are immutable

**The page API serves only complete pages.** The in-progress tail comes from the live
socket. That one invariant means every page response is immutable:

```
Cache-Control: public, max-age=31536000, immutable
ETag: "cap_01HZ.../p/69632"
```

Re-scrolling over ground you've already covered then costs nothing — browser cache
serves it. Without the invariant you'd need revalidation on every page and the whole
scheme gets slower and more complex for no benefit.

## 7. Aggregates — ship them, but know what combines

Per-page, per-bin aggregates cost ~4 × `binCount` bytes (~32 KB against a 1 MB page) and
let the client draw overlays for windows whose pages aren't fully resident.

Ship **max, min, sum, count** — all of which combine across pages, and `sum`/`count`
gives mean. Do **not** try to ship an EWMA average: it is order-dependent and does not
combine, so the client computes it locally by replaying across resident rows (as in
phase 1, item 7). Occupancy is a count over a threshold, so it combines — but the
threshold is a client-side setting, which means either the server ships a small
histogram per bin, or occupancy stays client-computed. **Recommend client-computed**
until someone actually needs otherwise.

A visible window generally spans partial pages, so the client combines server aggregates
for fully-covered pages with locally-computed values for the partial ends.

## 8. Failure modes

| Case | Server | Client |
|---|---|---|
| Page evicted by retention | `410 Gone` | render "history expired" band, clamp scroll |
| Page not yet written | `404` | clamp to `seqEnd`; it's a client bug |
| Session ended / config changed | `409` + new `sessionId` | discard history, re-init |
| Fast scroll, requests in flight | — | `AbortController`, dedupe, keep last-good |

Client should prefetch ±1 page beyond the visible window and cancel aggressively. A
scroll gesture that crosses ten pages should issue one batch request for where it landed,
not ten for where it passed through.

## 9. Designed-for, not built

**Decimated overview tier.** `?decimate=8` returning min/max-pooled rows, so scrolling
across hours doesn't mean fetching hours of full-resolution data. The pooling must be
min/max (not mean) or transient signals vanish — the whole point of a waterfall. Adding
this later requires no change to the coordinate scheme, which is the main reason §1 is
worth getting right now.

## 10. Open questions

1. **Retention policy** — rows, bytes, or wall-clock time? Wall-clock is what users
   reason about ("last 24h"), rows are what the storage layer bounds. Probably both, with
   whichever binds first.
2. **Multi-client sessions** — is a session per receiver (shared, many viewers) or per
   client connection? Shared is more useful and makes `seq` naturally global; it also
   means the client cannot assume it is the only reader.
3. **Authorisation granularity** — per session, or per frequency range? Affects whether
   subview ranges can be served independently.
4. **Does the backend store annotations separately from spectrum?** If they're produced
   by a different pipeline stage they may have their own latency, in which case a page
   could be complete for spectrum but not annotations.
