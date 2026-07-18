# Bridge — Pediatric Headache Visit Intelligence Agent

**Hackathon: The Future of Agentic AI in Healthcare (Abridge)**

## What Bridge is

Bridge turns a pediatric headache visit — live conversation plus fragmented chart history — into a structured, evidence-linked clinical picture and a clinician-reviewed next-step plan, while the visit is still happening.

### The problem

A primary-care pediatrician in a safety-net clinic gets ~20 minutes with a child who has headaches. The relevant history is scattered across well-child notes, triage calls, and parent reports; the visit conversation itself never becomes structured data; validated tools like PedMIDAS (pediatric migraine disability score) rarely get captured; and red-flag screening depends on memory under time pressure. The result: incomplete workups, missed escalations, and no longitudinal picture at the follow-up visit.

### What Bridge does about it

During the visit, a **Visit Intelligence Agent** (built on the Claude Agent SDK) continuously converts the encounter into structured clinical state:

- pulls and summarizes the chart from a **Medplum FHIR server** at case open: PMH, allergies, family history, prior PCP/ED/urgent-care/specialty notes, imaging, labs, referrals, no-shows, specialist wait status, and headache-relevant meds (overuse / contraindication flags) — so the visit never re-asks what the EMR already knows
- captures at intake exactly what the EMR does **not** structure: headache pattern (onset, frequency, duration, progression), phenotype (location, quality, severity, activity worsening, nausea/vomiting, photo/phonophobia, aura), functional burden (missed school, sports limitation, repeat PCP/ED visits), and recent treatment response (what was taken, how often, did it help) — into a strict typed schema
- screens a fixed 14-item red-flag catalog for secondary headache / imaging escalation (thunderclap, sleep awakening, morning vomiting, cough/Valsalva/exertion trigger, focal deficits, vision changes, speech difficulty, gait change, seizures, altered mental status, fever/stiff neck, cancer/immunosuppression/shunt, head trauma, progressive worsening) — every flag explicitly `present` / `absent` / `unknown`, never guessed
- flags **medication-overuse risk** with visible arithmetic (acute meds ≥10 days/month, e.g. "ibuprofen 3×/week ≈ 12 days/month")
- captures the **exam snapshot** (appearance, neuro exam, funduscopic) and the **PCP's stated impression & plan** (concern level, tentative classification, selected plan items) — clinician-stated only, never inferred
- captures PedMIDAS items as concrete day-counts surface in conversation, and scores only when complete
- drafts a patient-reported headache diary
- tells the clinician **what hasn't been asked yet** (missing high-value questions)
- links every extracted claim to an exact quote (evidence drawer)
- on completion: generates a clinician-review plan, exports a PDF action plan, and **writes the visit summary back to Medplum** so visit 2 reads real longitudinal state

Bridge is a support tool for clinician review — it never diagnoses or prescribes. All outputs are drafts with evidence attached.

***

## Real agentic functionality (not staged)

The core demo path exercises a real agent doing real work:

1. **Mid-visit "Analyze" (`POST /visits/{id}/analyze`)** — the flagship agentic action. The Claude Agent SDK (`claude-agent-sdk`, model `claude-sonnet-5`) receives the full visit-so-far (agent-built EMR summary + Medplum-sourced history + accumulated transcript + red-flag catalog + PedMIDAS items) and returns a **schema-validated structured re-assessment**: profile facts, red-flag states, PedMIDAS responses, diary sketch, missing questions, and self-generated evidence quotes. Output is enforced via JSON-schema structured output and validated with Pydantic (`AnalysisDelta`) before it touches the dashboard. No free text, no chat.
2. **Per-chunk live extraction (`BRIDGE_DEMO_MODE=0`)** — the same agent extracts a structured delta from each transcript chunk as it arrives.
3. **Grounding is enforced, not decorative** — the agent's system prompt forbids invented values; every fact carries `evidence_ids` pointing to exact quotes with speaker + timestamp; unsupported fields are omitted and surface as `unknown` in the UI. The prompt contract lives in `backend/app/prompts/analysis.md`.
4. **Real EHR round-trip via Medplum FHIR** — case data is fetched from Medplum at load, and the completed visit summary is written back as a FHIR `DocumentReference`. The agent operates on EHR-sourced state, not hardcoded fixtures.

### Honest prototype boundaries

Synthetic data only. The transcript stream is a simulated STT feed (pre-scripted chunks delivered sequentially — building production speech-to-text was out of scope, the agentic processing of it is not). Ask Bridge Q&A is deterministic grounded retrieval over the seeded case (citations point at real evidence IDs). `BRIDGE_DEMO_MODE=1` replays precomputed extraction deltas for deterministic stage demos; the Analyze button runs the real agent in either mode.

***

## Integrations

### 1. Anthropic Claude Agent SDK
- `claude_agent_sdk.query()` with `ClaudeAgentOptions`: custom system prompt, `output_format={"type": "json_schema", ...}` generated from the Pydantic model, `allowed_tools=[]`, `max_turns=1` — a constrained single-purpose agent, not an open chatbot.
- Two pipelines: full-visit re-assessment (`app/services/analysis.py`) and per-chunk extraction (`app/services/extraction.py`).
- Any SDK/parse failure degrades gracefully to deterministic state — the demo cannot blank-screen.

### 2. Medplum FHIR server (synthetic-data EHR)
- OAuth2 client-credentials against `https://api.medplum.com`; token cached in-process, 3s timeout on every call (`app/services/medplum.py`, stdlib-only client).
- **Seeded FHIR graph** (`scripts/seed_medplum.py`, idempotent conditional PUTs): one shared `Patient`, an `Encounter` per prior visit, LOINC-coded vital-sign `Observation`s parsed from the notes, PedMIDAS trend scores as `Observation`s, a PedMIDAS `Questionnaire`, one `DocumentReference` per history note (linked to its encounter), and the full case definition as a `DocumentReference` — a browsable longitudinal record, not a blob dump.
- **Read**: backend fetches case definitions from Medplum at case load; `VisitState.history_source` reports `"medplum"` vs `"local"` fallback.
- **Write-back**: visit completion pushes the summary to Medplum, closing the loop for the follow-up visit.

***

## Architecture

```
React + Vite + TS  ──HTTP──►  FastAPI (single service)
  dashboard                     │
  (VisitState ⇄                 ├── store.py        in-memory visit state + delta engine
   bridge.ts types)             ├── analysis.py     ── Claude Agent SDK ──► claude-sonnet-5
                                ├── extraction.py   ── Claude Agent SDK (live mode)
                                ├── medplum.py      ── OAuth2/FHIR ──► Medplum (EHR)
                                │                        ▲ seed / read / write-back
                                └── pdf.py          ReportLab visit-plan export
```

**Stack**: FastAPI + Pydantic v2 (backend, strict typed `VisitState` contract), React 19 + Vite + TypeScript (frontend, mirrored types in `src/types/bridge.ts`), ReportLab (PDF), `claude-agent-sdk`, Medplum FHIR R4. No database — Medplum is persistence, local JSON is the deterministic fallback.

**Demo reliability engineering**: every external dependency (Medplum, Anthropic API) fails soft to bundled deterministic state with visible source flags. Timeouts everywhere. Two seeded cases: Case A (first visit, migraine-compatible, no red flags) and Case B (8-week follow-up with PedMIDAS trend).

***

## Run

### Backend (port 8000)
```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once
cp .env.example .env   # add ANTHROPIC_API_KEY + Medplum creds
.venv/bin/uvicorn app.main:app --reload
```

### Frontend (port 5173)
```bash
cd frontend
npm install && npm run dev
```

### Seed Medplum (once, or after editing `backend/app/demo_data/*.json`)
```bash
cd backend && .venv/bin/python -m scripts.seed_medplum
```

### Env
| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Agent SDK pipelines (Analyze always uses it) |
| `BRIDGE_DEMO_MODE` | `1` = deterministic per-chunk deltas (default), `0` = live per-chunk extraction |
| `MEDPLUM_BASE_URL` / `MEDPLUM_CLIENT_ID` / `MEDPLUM_CLIENT_SECRET` | FHIR EHR; unset → pure local fallback |

## API

| Endpoint | Purpose |
|---|---|
| `GET /health` | liveness |
| `GET /cases` | list demo cases |
| `GET /cases/{case_id}` | open case → fetches from Medplum, creates visit, returns `VisitState` |
| `POST /visits/{id}/transcript-chunk` | next transcript chunk → updated `VisitState`; `?extract=false` appends raw turns only |
| `POST /visits/{id}/analyze` | **real Agent SDK re-assessment** of the full visit so far |
| `POST /visits/{id}/complete` | finalize: care plan draft + summary write-back to Medplum |
| `POST /visits/{id}/ask` | grounded Q&A with evidence citations |
| `GET /visits/{id}/export.pdf` | end-of-visit PDF action plan |

Shared contract: `backend/app/models.py` ⇄ `frontend/src/types/bridge.ts` (keep in sync).

***

## Clinical safety position

Bridge is decision **support**, not a decision maker. Every output is labeled draft / clinician-review-required; unsupported fields are marked unknown rather than filled; pathway suggestions are visually separated from patient facts and sourced from a constrained demo reference. Synthetic PHI only.
