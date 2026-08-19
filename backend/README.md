# Spectrum mock backend

This is a dependency-free Go prototype of the capture API. It owns signal
generation, timestamps, retention, history page alignment, session changes, and
the live sequence. The browser no longer synthesizes frames.

## Run

```sh
go -C backend run .
```

The default address is `127.0.0.1:8787`; pass `-addr` to change it.

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
for expired pages return 410; pages in the live tail return 404; stale session IDs
return 409.

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

`?after=<seq>` first emits retained rows after that sequence and then remains
live. This gives history hydration and streaming an exact sequence seam. A
production WebSocket can carry the same frame payload without changing the
client's row coordinate model.
