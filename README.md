# ByeByeHeadache — Pediatric Headache Copilot

**Hackathon: The Future of Agentic AI in Healthcare (Abridge)**

> ByeByeHeadache turns a pediatric headache visit — the live conversation plus a fragmented chart history — into a structured, evidence-linked clinical picture and a clinician-reviewed plan, **while the visit is still happening**.

***

## The problem

A pediatrician in a busy safety-net clinic gets about **20 minutes** with a child who keeps getting headaches. In that time they must:

- piece together history scattered across well-child notes, urgent-care visits, triage calls, and parent memory;
- ask the right questions about the headaches themselves — pattern, symptoms, school impact, medications;
- remember to screen for the rare-but-serious warning signs that mean a headache is not "just a migraine";
- capture a validated disability score (PedMIDAS) that in practice almost never gets recorded;
- and leave behind notes good enough that the *next* visit can tell whether the child is getting better or worse.

In reality, the conversation disappears into free-text notes, the disability score never gets captured, red-flag screening depends on memory under time pressure, and the follow-up visit starts from scratch. Children who need escalation get missed; children who don't get over-referred.

## The solution

ByeByeHeadache is a **live visit copilot**. While the doctor and family talk, an AI agent (built on Anthropic's Claude Agent SDK) listens to the visit and continuously turns the conversation — plus the patient's chart — into a structured picture the doctor can glance at:

1. **Before the visit starts**, ByeByeHeadache has already read the chart (stored in a real FHIR electronic health record — Medplum) and assembled what matters: past conditions, allergies, family history, prior visits, medication warnings. The doctor never re-asks what the record already knows.
2. **As the conversation happens**, the agent fills in a live headache profile — when the headaches started, how often, where, what they feel like, what makes them worse, how much school is being missed — with every fact linked to the exact sentence it came from.
3. **Safety runs in the background**: a fixed 14-item red-flag checklist (the signs that suggest something more serious) is tracked as *present / absent / not asked yet* — never guessed. If a red flag appears, the routine pathway visibly pauses and escalation drafts appear.
4. **At the end**, ByeByeHeadache drafts the visit summary, a next-step plan, and a family-friendly PDF action plan — all marked "draft, for clinician review" — and writes the summary back to the health record so the next visit starts informed.

**The clinician stays the decision-maker.** ByeByeHeadache never diagnoses, never prescribes, never sends anything on its own. Every output is a draft with evidence attached.

## What you'll see in the demo

### Live Visit view
- **Visit Intelligence Agent rail** — the transcript streams in; a progress bar and status line show the agent working ("Extracting headache characteristics", "Updating PedMIDAS capture"). An **Analyze** button triggers a real Claude re-assessment of everything heard so far.
- **Headache profile grid** — fills in live as facts surface. Unknown stays *unknown*; nothing is invented.
- **Evidence drawer** — click any fact and see the exact quote it came from, with source and timestamp. This is the trust feature: every claim is traceable.
- **PedMIDAS capture** — the six disability questions check off as answers appear in conversation; the score is only computed when all six are captured.
- **Still to Ask** — the agent tracks which high-value questions haven't been covered yet, so the short visit gets used well.
- **Intelligent Insights** — guideline-linked differential diagnoses (with the diagnostic criteria shown as met / partial / unmet) and treatment considerations, each citing its source (ICHD-3, AAN/AHS 2019, CHAMP trial). Clearly labeled decision support, not a verdict.
- **Complete visit** — generates the clinician-review plan and a printable PDF for the family; the summary is written back to the health record.

### Headache Summary view
- The full **14-item red-flag checklist** with per-item status and evidence.
- **PedMIDAS trend chart** — at the 8-week follow-up (demo Case B) the score falls 32 → 11, with the intervention marked on the chart. This is the longitudinal payoff: the second visit *knows* what happened in the first.
- **30-day headache diary heatmap** drafted from what the family reported.
- **Pain-location diagram** derived from the child's own words.
- **Changes since last visit** — improving / stable / worsening, at a glance, each line evidence-linked.

### Two demo cases
- **Case A — first visit**: 12-year-old with four months of worsening headaches. Migraine-compatible pattern, real school impact, no red flags. Watch the picture assemble live.
- **Case B — 8-week follow-up**: same child after the plan started. Frequency halved, disability score way down, medication-overuse concern resolved — proof the system is longitudinal, not a one-visit transcription toy.

## What makes it genuinely agentic (not AI theater)

- **The Analyze action is a real agent call**: Claude receives the chart summary, the prior history, and the accumulated transcript, and returns a schema-validated structured re-assessment — profile facts, red-flag states, PedMIDAS answers, missing questions — each with self-generated evidence quotes. No free text, no chat. Output is validated before it touches the screen.
- **Grounding is enforced**: the agent's instructions forbid invented values; anything unsupported surfaces as *unknown* in the UI.
- **A real EHR round-trip**: case data lives in Medplum (a FHIR-standard health record server) as a proper longitudinal record — patient, encounters, coded vital signs, questionnaires, documents. ByeByeHeadache reads it at case open and writes the visit summary back at completion.
- **The frontend never fabricates**: every value on screen originates from the backend state. If the backend didn't extract it, the UI shows *unknown*.

### Honest prototype boundaries
Synthetic data only. The transcript is a simulated speech-to-text feed (pre-scripted chunks — production STT was out of scope; the agentic processing of it is not). Ask-ByeByeHeadache Q&A is deterministic grounded retrieval over the case with real citations. A demo mode replays precomputed extraction deltas for stage-safe determinism; the Analyze button runs the real agent in either mode. Every external dependency (Medplum, Anthropic API) fails soft to bundled deterministic state — the demo cannot blank-screen.

***

## Under the hood (for the technically curious)

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

- **Backend**: FastAPI + Pydantic v2; strict typed `VisitState` contract shared with the frontend (`backend/app/models.py` ⇄ `frontend/src/types/bridge.ts`). No database — Medplum is persistence, bundled JSON is the deterministic fallback.
- **Agent**: `claude_agent_sdk.query()` with a custom system prompt, JSON-schema-constrained output generated from the Pydantic model, no tools, single turn — a constrained single-purpose agent, not an open chatbot. Prompt contracts in `backend/app/prompts/`.
- **Medplum**: OAuth2 client-credentials; idempotent seed script builds a browsable FHIR graph (Patient, Encounters, LOINC-coded Observations, PedMIDAS Questionnaire, DocumentReferences). Every read has a 3-second timeout and a silent local fallback; `history_source` in the API response reports which path served the data.
- **Frontend**: React 19 + Tailwind v4, single-file dashboard (`frontend/src/App.tsx`), evidence drawer, deep links (`?case=case-b&tab=headache`). Details in `frontend/README.md`.

### Run it

```bash
# backend (port 8000)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once
cp .env.example .env   # add ANTHROPIC_API_KEY + Medplum creds (both optional — fallbacks exist)
.venv/bin/uvicorn app.main:app --reload

# frontend (port 5173)
cd frontend
npm install && npm run dev

# seed Medplum (once, or after editing backend/app/demo_data/*.json)
cd backend && .venv/bin/python -m scripts.seed_medplum
```

| Env var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Agent SDK pipelines (Analyze always uses it) |
| `BRIDGE_DEMO_MODE` | `1` = deterministic per-chunk deltas (default), `0` = live per-chunk extraction |
| `BRIDGE_ANALYSIS_MODEL` | model for the Analyze pipeline (default `claude-sonnet-5`) |
| `MEDPLUM_BASE_URL` / `MEDPLUM_CLIENT_ID` / `MEDPLUM_CLIENT_SECRET` | FHIR EHR; unset → pure local fallback |

| Endpoint | Purpose |
|---|---|
| `GET /cases` · `GET /cases/{id}` | list / open a demo case (fetches from Medplum, returns `VisitState`) |
| `POST /visits/{id}/transcript-chunk` | next transcript chunk → updated state |
| `POST /visits/{id}/analyze` | **real Agent SDK re-assessment** of the visit so far |
| `POST /visits/{id}/complete` | finalize: care plan + summary write-back to Medplum |
| `POST /visits/{id}/ask` | grounded Q&A with evidence citations |
| `GET /visits/{id}/export.pdf?audience=doctor\|patient` | audience-specific PDF: clinical visit summary (doctor) or plain-language family action plan (patient), both with charts (PedMIDAS trend/gauge, diary heatmap, red-flag states) |

***

## Clinical safety position

ByeByeHeadache is decision **support**, not a decision maker. Every output is labeled draft / clinician-review-required; unsupported fields are marked unknown rather than filled; pathway suggestions are visually separated from patient facts and sourced from a constrained demo reference informed by ICHD-3-style feature capture. Synthetic PHI only — no real patient data anywhere in the system.
