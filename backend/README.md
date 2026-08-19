# Spectrum mock backend

This is a dependency-free Go prototype of the capture API. It owns signal
generation, timestamps, retention, history page alignment, session changes, and
the live sequence. The browser no longer synthesizes frames.

Starting the backend immediately starts a durable recording and simulated signal
generation. Every completed page remains available after that process exits.
Recent rows live in a fixed-size in-memory ring, while completed pages are written
to append-only files. Spectrum memory use therefore stays bounded even while the
recording on disk grows.

## Run

```sh
go -C backend run .
```

The default address is `127.0.0.1:8787`; pass `-addr` to change it. History is
stored under `backend/data` when using the command above. Use `-data-dir` to pick
another directory and `-segment-mb` to change the default 1 GiB segment size:

```sh
go -C backend run . -data-dir ../spectrum-history -segment-mb 2048 -recording-name "Lab run 42"
```

## Storage

Each backend run and each parameter change creates a separate recording directory:

```text
data/
  cap_.../
    manifest.json
    segment-000000.dat
    segment-000001.dat
```

`manifest.json` identifies the recording and preserves its name, state, start/end
times, frequency configuration, page geometry, sequence extent, and segment list.
The state is `recording` while active, `complete` after a clean shutdown or
parameter change, and `interrupted` when an unfinished recording is discovered at
the next startup.

A completed history page is encoded once in the API's binary format and appended
as one length-prefixed record:

```text
uint32 little-endian page payload length
page payload (the exact container returned by the pages endpoint)
```

Records are grouped into `segment-000000.dat`, `segment-000001.dat`, and so on.
The current segment is synced before a page is published to readers. On open, the
record index is rebuilt by scanning the segments; an incomplete final record is
truncated, which makes interruption during an append recoverable.

Only the newest `max(4096, historyRows)` rows and the incomplete page tail keep
full spectrum arrays in memory. A compact timestamp lookup and the page-location
index remain in memory. A clean shutdown seals the final partial page into the
recording. While running, that incomplete tail is intentionally not in the page
API, so an abrupt process or machine failure can lose at most one partial page.

Recording directories are not deleted automatically. On restart, manifests and
segment indexes are reloaded before a new active recording starts. Older
recordings remain available through the recording API.

## Recordings

```text
GET /api/recordings
GET /api/recordings/{recordingId}
GET /api/recordings/{recordingId}/pages?from=<page-index>&count=<1..8>
GET /api/recordings/{recordingId}/seek?t=<epoch-ms>
```

The list is newest-first and includes the active recording. Page and seek results
use the same binary format and `seq` coordinate system as live capture history, so
a later replay UI can use the existing history pager. `POST /api/captures` accepts
an optional `name`, and `-recording-name` names the automatic startup recording;
otherwise the backend assigns a UTC timestamp-based name.

## History pages

`GET /api/captures/{id}/pages?from=<page-index>&count=<1..8>` follows the binary
container proposed in `history-paging-api.md`:

```text
uint32 little-endian JSON header length
JSON header
float64 timestamps[rows]
int8 spectrum[rows][binCount]
sparse annotation rows
```

Each sparse annotation row is `uint16 intervalCount`, followed by intervals of
`uint16 startBin`, `uint16 endBin`, and `int8 value`. Batch responses concatenate
complete page containers. Completed pages are immutable and cacheable. Requests
for pages in the incomplete live tail return 404 and stale session IDs return 409.
After clean shutdown, a recording can contain one shorter immutable final page.
The 410 response remains part of the contract for a future bounded production
retention policy, but disk-backed mock pages do not expire during their session.

## Live stream

The prototype uses a fetch-readable HTTP stream so the backend can stay within
the Go standard library. Each frame is:

```text
uint32 payload length
float64 seq
float64 epoch milliseconds
uint16 spectrum length
uint16 annotation interval count
int8 spectrum[bins]
annotation intervals (same five-byte encoding as history)
```

`?after=<seq>` first emits rows still present in the hot memory ring after that
sequence and then remains live. Older rows remain available through the page API;
an older live catch-up request returns 410. This gives history hydration and
streaming an exact sequence seam. A production WebSocket can carry the same frame
payload without changing the client's row coordinate model.
