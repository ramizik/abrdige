# Bridge — Pediatric Headache Visit Copilot

Hackathon prototype: turns a pediatric headache visit (live transcript + fragmented history) into a structured, evidence-linked clinical picture and a clinician-reviewed plan. Synthetic data only.

## Run

### Backend (port 8000)
```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once
cp .env.example .env                                                  # once; key optional
.venv/bin/uvicorn app.main:app --reload
```

### Frontend (port 5173)
```bash
cd frontend
npm install   # once
npm run dev
```

## Demo modes
- `BRIDGE_DEMO_MODE=1` (default): deterministic precomputed extraction — demo-safe.
- `BRIDGE_DEMO_MODE=0` + `ANTHROPIC_API_KEY`: live Agent SDK extraction per transcript chunk, falls back to precomputed deltas on any failure.

## API
| Endpoint | Purpose |
|---|---|
| `GET /health` | liveness |
| `GET /cases` | list demo cases (Case A first visit, Case B follow-up) |
| `GET /cases/{case_id}` | open case → creates visit, returns initial `VisitState` |
| `POST /visits/{id}/transcript-chunk` | process next chunk → full updated `VisitState`; `?extract=false` appends raw transcript only (STT simulation) |
| `POST /visits/{id}/analyze` | **real Agent SDK pipeline**: mid-visit "Analyze" button — agent re-reads history + transcript so far, returns validated structured update (profile, red flags, PedMIDAS, evidence, missing questions) |
| `POST /visits/{id}/complete` | finalize visit, attach care plan draft |
| `POST /visits/{id}/ask` | grounded Q&A with citations |
| `GET /visits/{id}/export.pdf` | end-of-visit PDF |

Shared contract: `backend/app/models.py` ⇄ `frontend/src/types/bridge.ts` (keep in sync).

Frontend `src/App.tsx` is a temporary wiring harness — the real dashboard comes from Claude Design and should consume `VisitState` via `src/lib/api.ts`.
