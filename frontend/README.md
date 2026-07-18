# Bridge frontend

React 19 + Vite + TypeScript + Tailwind v4 clinical dashboard for the Bridge backend. UI design ported from the Lovable prototype; all data comes from the FastAPI backend — nothing is rendered that the backend didn't produce.

## Run

```bash
npm install
npm run dev        # :5173, expects backend on :8000
npm run build      # tsc -b + vite build
```

`VITE_API_BASE` overrides the backend URL (default `http://localhost:8000`).

## Layout

- `src/App.tsx` — the whole dashboard: top bar + case selector, Live Visit view (agent rail, transcript playback, headache profile, PedMIDAS capture, timeline, action console) and Headache Summary view (red-flag catalog, PedMIDAS trend, diary heatmap, pain-location diagram), plus the evidence drawer.
- `src/lib/api.ts` — typed client, one function per backend endpoint.
- `src/types/bridge.ts` — TS mirror of `backend/app/models.py`. Keep in sync.
- `src/lib/tone.ts` — neutral/teal/amber/red tone → CSS variable mapping.
- `src/index.css` — Tailwind v4 theme (Bridge palette, `card-surface` / `eyebrow` / `mono` utilities).

## Conventions

- Every displayed clinical value comes from `VisitState`; facts with `evidence_ids` are clickable and open the evidence drawer.
- Transcript playback = repeated `POST /visits/{id}/transcript-chunk`; the backend returns the full updated state each tick.
- Deep links: `?case=<case_id>&tab=headache`.
- Static reference content (e.g. migraine-location literature card) is explicitly labeled "reference · not patient data".
