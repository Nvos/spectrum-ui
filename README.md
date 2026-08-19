# Spectrum analyzer prototype

The browser now consumes simulated spectrum data from a small Go backend. The
backend uses only the Go standard library and assigns every row a stable `seq`
that is shared by history and the live stream.

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

See [backend/README.md](backend/README.md) for the prototype wire formats and
[history-paging-api.md](history-paging-api.md) for the intended paging model.
