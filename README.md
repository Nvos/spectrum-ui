# Spectrum analyzer prototype

The browser now consumes simulated spectrum data from a small Go backend. The
backend uses only the Go standard library and assigns every row a stable `seq`
that is shared by history and the live stream.

Starting the backend immediately creates a durable recording and begins generating
mock readings. The backend keeps a fixed recent-row ring in memory and writes
completed immutable pages plus a recording manifest under `backend/data`; the UI
keeps its own bounded GPU/ring cache and fetches older pages on demand. Restarting
the backend or applying new capture parameters starts a new recording, while prior
recordings remain cataloged and replayable through the API.

Run it in two terminals:

```sh
npm run dev:backend
npm run dev
```

The UI is served by Vite and proxies `/api` to `http://127.0.0.1:8787`. To use a
backend on another origin, set `VITE_SPECTRUM_API_URL` before starting/building
the UI.

The backend exposes:

- `GET /api/captures/current` — active capture metadata
- `POST /api/captures` — start a new mocked capture with UI parameters
- `GET /api/captures/{id}/pages?from=&count=` — immutable binary history pages
- `GET /api/captures/{id}/seek?t=` — timestamp-to-sequence lookup
- `GET /api/captures/{id}/live?after=` — binary live stream with catch-up

Persistent recordings add `GET /api/recordings`, recording metadata, binary page,
and timestamp-seek endpoints. The current UI remains attached to the active
recording; a recording-selection/replay UI is future work.

To exercise paging, leave the backend running, then drag the waterfall history
scrollbar toward the bottom. The paused indicator shows `LOADING…` while the
settled historical window is fetched; `Home` or the indicator returns to live.

See [backend/README.md](backend/README.md) for the prototype wire formats and
[history-paging-api.md](history-paging-api.md) for the intended paging model.
