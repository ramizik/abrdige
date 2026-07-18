# CLAUDE.md

## Implementation Status (2026-07-18) — read before planning work
The core build is **done and demo-ready**. Both integrations are real and verified end-to-end:

- **Backend** (`backend/app/`): all endpoints live (`/health`, `/cases`, `/cases/{id}`, `/visits/{id}/transcript-chunk|analyze|complete|ask|export.pdf`). `store.py` in-memory state + delta engine; `analysis.py` + `extraction.py` = Claude Agent SDK pipelines (schema-validated, Pydantic-checked, graceful fallback); `medplum.py` = OAuth2 FHIR client (case-def read at load, visit-summary write-back, 3s timeout → local JSON fallback); `pdf.py` = ReportLab export, two audiences (`?audience=doctor|patient`): clinical summary vs family action plan, with drawn charts (PedMIDAS trend + severity gauge, 30-day diary heatmap, colored red-flag table). `VisitState` also carries `insights` (`InsightPack`: guideline-linked differential-dx + treatment considerations per case) and `history_source` (`"medplum"`/`"local"`).
- **Frontend** (`frontend/src/App.tsx`, single file by design): full dashboard ported from the Lovable prototype and wired to the backend — Live Visit tab (agent rail with real chunk playback + Analyze button, transcript, evidence-linked profile grid, PedMIDAS capture, timeline, action console with insights / plan / Ask Bridge / complete + PDF) and Headache Summary tab (14-item red-flag catalog, PedMIDAS trend chart, diary heatmap, pain-location diagram). Evidence drawer opens from any fact/chip. Deep links `?case=&tab=`. **Rule: the frontend renders only what the backend returned — never fabricate clinical values client-side.** Theme in `src/index.css` (Tailwind v4), tones in `src/lib/tone.ts`, API client `src/lib/api.ts`, types `src/types/bridge.ts` (mirror of `models.py` — keep in sync).
- **Cases** (4 patients, one Medplum `Patient` each): Case A — Elena Cruz, 9F, first visit, 10 chunks, no red flags, PedMIDAS completes at 19. Case B — Maya G. Torres, 11F, visit 5 post-specialist, improving on gabapentin + chiro/CBT/PT (timeline events), PedMIDAS 44→40→38→34→18, specialist f/u 3 mo + PCP f/u 1 mo, interpreter turns. Case C — Jordan Park, 13M, visit 4 preventive plateau (propranolol 10→20 mg failed, venlafaxine titrating), PedMIDAS 42→36→35→33, absenteeism, neurology referral sent today. Case D — Noah Reyes, 8M, SNOOP-positive escalation (AM vomiting, occipital shift, night waking, possible ataxia), PedMIDAS 46→24→41, routine path paused. All seeded in Medplum. After editing `backend/app/demo_data/*.json`, re-run `scripts/seed_medplum.py` or the backend will serve the stale Medplum copy.
- Remaining work is polish, demo rehearsal, and deployment (see `vercel.json`) — not new scope.

***

## Mission
You are the coding agent for **Bridge**, a pediatric headache visit-intelligence agent for a healthcare hackathon.

Build a narrow, impressive, demo-stable workflow in <=24 hours. Optimize for:
- visible AI utility
- clinician trust
- strong UX
- fast implementation
- deterministic demo behavior
- one clear workflow that judges understand immediately

Do **not** optimize for:
- production-grade completeness
- enterprise integrations
- broad platform scope
- unnecessary abstraction
- features that are not visible in the demo

Core filter for every idea:
1. Can this be built tonight?
2. Can this fail during the demo?
3. Will a judge understand it in 10 seconds?
4. Is the AI doing real work, or is it decorative?

If the answer is weak, cut it.

***

## Hackathon Context
Theme: **The Future of Agentic AI in Healthcare by Abridge**.

Use **Anthropic's Agent SDK** meaningfully.

Core integrations (both must be visibly real in the demo):
1. **Anthropic Agent SDK** — the Visit Intelligence Agent.
2. **Medplum FHIR server** — the synthetic-data EHR. All seeded patient data (patients, prior visits, vitals, observations, PedMIDAS questionnaire responses) lives in Medplum as FHIR resources and is fetched by the backend at case load.

Important context:
- Judges will likely see many generic AI copilot/chatbot entries.
- This project must feel like a real clinical workflow tool, not AI theater.
- It should resemble contextual clinical support inside the visit workflow rather than a disconnected assistant. Abridge publicly emphasizes context-aware support grounded in the encounter and linked to evidence. [1][2]
- This is a hackathon prototype using **synthetic data only**.

Do not build a broad healthcare platform.
Build one excellent workflow.

***

## Product Definition

### Name
**Bridge**

### One-line pitch
**Bridge turns a pediatric headache visit—live conversation plus fragmented history—into a structured, evidence-linked clinical picture and a clinician-reviewed next-step plan.**

### Primary user
A primary care pediatrician in an underserved / safety-net setting seeing a child with headaches.

### Real product wedge
Bridge is a **live pediatric headache visit copilot**.

It combines:
- preloaded prior history / prior visits / vitals from **Medplum FHIR** (synthetic data seeded ahead of demo; local JSON snapshot as deterministic fallback)
- live transcript chunks from the encounter (synthetic STT stream for MVP)
- structured extraction of headache-relevant facts
- PedMIDAS capture and scoring when sufficient data exists
- headache diary drafting from conversation
- red-flag screening
- grounded patient-profile Q&A
- end-of-visit summary and action-plan PDF
- follow-up mode for visit 2+

### What Bridge is NOT
- a generic doctor chatbot
- an autonomous diagnosis engine
- an autonomous prescribing system
- a full EHR replacement
- a multi-specialty platform
- a patient portal

***

## Clinical Safety Position
Bridge is a **clinical support tool for clinician review**, not an autonomous clinician.

All outputs and UI language must use framing like:
- draft
- suggested
- clinician review required
- evidence-linked
- consider escalation
- confirm with clinical judgment
- based on demo pathway reference

Never use wording like:
- “Bridge diagnosed…”
- “AI prescribed…”
- “safe to proceed” without qualification
- “the correct treatment is…”

### Medication guidance boundary
The system may surface a **reviewable pathway suggestion** based on a constrained local demo reference informed by ICHD-3-style feature capture and demo care logic. It may not independently prescribe or emit medication orders. ICHD-3 migraine criteria can inform feature matching, but Bridge must not claim autonomous diagnosis. [3]

### PedMIDAS boundary
PedMIDAS is a strong clinical anchor because it is a validated tool for assessing migraine-related disability in children and adolescents and monitoring change over time. [4][5] Use it as a structured disability capture and visualization tool, not as a gimmick.

***

## Core Product Scope

### In scope
- pediatric headache / migraine only
- first visit workflow
- follow-up visit state (visit 2+)
- Medplum-hosted synthetic FHIR data (patients, encounters, observations, questionnaire responses) as the pre-visit history source
- seeded pre-visit history JSON as deterministic fallback
- synthetic transcript chunks simulating STT
- structured extraction + grounded evidence
- live dashboard updates during the visit
- end-of-visit summary + PDF export
- grounded Ask Bridge feature

### Out of scope
- EHR integrations beyond Medplum (no Epic/Cerner, no hospital connections)
- real patient data of any kind — Medplum holds synthetic data only
- real telephony or production STT
- broad multi-condition platform
- real medication ordering
- real referrals being sent
- auth / users / organizations
- patient messaging
- real fax ingestion at scale
- long-term production persistence

***

## Product Workflows

## 1) Primary Workflow: First Visit

### Scenario
A pediatric patient visits a PCP for headaches for the first time.
The doctor is asking structured and unstructured questions about:
- headache features
- associated symptoms
- habits and triggers
- school impact
- vitals/context
- medication usage
- red flags

Bridge should process this encounter live.

### What happens during the visit
1. PCP opens the patient case.
2. Bridge fetches pre-visit history / prior context from Medplum FHIR (falls back to bundled JSON snapshot if Medplum is unreachable).
3. Synthetic transcript chunks arrive sequentially.
4. The Anthropic-based Visit Intelligence Agent extracts structured facts from each chunk.
5. The frontend updates a live headache dashboard.
6. The agent identifies missing high-value questions.
7. At the end, Bridge generates a structured summary and PDF action plan.

### Required first-visit outputs
- structured headache profile
- PedMIDAS capture state and score when complete
- patient-reported headache diary draft
- red-flag screen with present/absent/unknown states
- contextualized prior history panel
- grounded Q&A
- clinician-review plan
- exportable PDF

## 2) Secondary Workflow: Follow-Up Visit (2+)
This is a secondary demo mode showing longitudinal value.

Prioritize:
- what changed since last visit
- PedMIDAS trend
- headache frequency/severity trend
- intervention or medication overlay
- prior plan status
- referral/escalation consideration

The follow-up screen should answer:
**Is this child improving, stable, worsening, or now appropriate for clinician-reviewed escalation?**

***

## Agent Responsibilities
The agent is a **Visit Intelligence Agent**, not a freeform assistant.

It must:
- ingest seeded history
- process transcript chunks
- extract headache facts into a strict schema
- maintain evidence links for important claims
- update visit state live
- calculate PedMIDAS only when enough information exists
- surface unknowns rather than hallucinating
- build a draft headache diary from patient-reported conversation
- run a structured red-flag screen
- generate a clinician-review plan
- answer grounded patient-profile questions using available evidence only
- create summary data for PDF export

### Visible agent activity states
Expose concise operational statuses in UI such as:
- Reading prior history
- Extracting headache characteristics
- Updating PedMIDAS capture
- Checking red flags
- Drafting visit summary
- Preparing clinician-review plan

Do NOT expose chain-of-thought.
Only show compact, user-safe action states.

***

## Data / Extraction Requirements

### Intake capture (what the EMR does NOT reliably structure)
Bridge extracts these from the live encounter when supported by evidence:
- **Current headache pattern**: onset, frequency (days/month), severe attacks/month, episode duration, progression (stable / gradually worsening / suddenly worsened / new type)
- **Headache phenotype**: location, quality, severity, activity worsening, nausea/vomiting, photophobia/phonophobia, aura + aura duration
- **Red flags for secondary headache / imaging escalation (14-item catalog)**: thunderclap, wakes from sleep / worst on awakening, early-morning vomiting, cough/Valsalva/exertion trigger, focal weakness/numbness, vision changes, speech difficulty, gait/imbalance, seizures, altered mental status, fever/stiff neck/systemic, cancer/immunosuppression/shunt, recent head trauma, progressive worsening
- **Functional burden**: missed school (PedMIDAS), sports/activity limitation, repeat PCP/ED/urgent-care visits, overall daily-life interference
- **Treatment**: acute meds (name/frequency/response), preventive meds, non-medical interventions, medication-overuse risk (acute meds ≥10 days/month — computed with visible arithmetic)
- **Exam snapshot** (clinician-stated only): general appearance, neuro exam findings, funduscopic result
- **PCP impression & plan** (explicitly stated only, never inferred): impression, concern level (low/mod/high), tentative classification (likely migraine / tension-type / possible secondary / unsure), selected plan items
- context: triggers, relievers (what helps), sleep/hydration/meals/screen time/stress habits, diary kept?
- family history if mentioned; relevant vitals/context if provided
- unresolved / unknown fields

### Agent-pulled EMR summary (auto-extracted, never re-asked at intake)
The agent assembles from Medplum/chart at case load:
- med history, allergies, PMH, family history
- prior PCP, ED, urgent care, neurology, ophthalmology notes
- previous imaging, labs, referrals, no-shows, specialist wait status
- existing meds relevant to headache risk, contraindications, or overuse

If a field is not supported by transcript/history, mark it as:
- unknown
- needs confirmation
- not yet asked

Never invent values.

***

## Suggested Structured Schema
Use typed schemas / strict JSON. Example shape:

```ts
type EvidenceRef = {
  id: string;
  sourceType: 'history' | 'transcript' | 'vitals' | 'document' | 'guideline';
  sourceLabel: string;
  quote: string;
  timestamp?: string;
};

type ExtractedFact<T = string> = {
  value: T | null;
  status: 'present' | 'negative' | 'unknown' | 'needs_confirmation';
  evidenceIds: string[];
};

type HeadacheProfile = {
  // pattern
  onset: ExtractedFact;
  frequencyDaysPerMonth: ExtractedFact<number>;
  episodeDuration: ExtractedFact;
  progression: ExtractedFact;
  // phenotype
  location: ExtractedFact;
  quality: ExtractedFact;
  severity: ExtractedFact;
  activityWorsening: ExtractedFact;
  associatedSymptoms: ExtractedFact<string[]>;
  aura: ExtractedFact;
  // context
  triggers: ExtractedFact<string[]>;
  habits: ExtractedFact<string[]>;
  // treatment response
  acuteMedicationUse: ExtractedFact<string[]>;
  treatmentResponse: ExtractedFact;
  // functional burden
  schoolImpact: ExtractedFact;
  activityImpact: ExtractedFact;
  repeatVisits: ExtractedFact;
};

type EmrItem = {
  id: string;
  category: 'pmh' | 'allergy' | 'family_history' | 'medication' | 'visit_note'
    | 'imaging' | 'lab' | 'referral' | 'no_show' | 'wait_status';
  label: string;
  detail: string;
  flag: string; // headache-relevance, e.g. "overuse watch", "contraindication"
  evidenceIds: string[];
};

type RedFlag = {
  key: string;
  label: string;
  status: 'present' | 'absent' | 'unknown';
  evidenceIds: string[];
};

type PedMIDASState = {
  responses: Array<{ questionId: string; value: number | null; evidenceIds: string[] }>;
  score: number | null;
  completion: 'complete' | 'partial' | 'not_started';
  missingQuestionIds: string[];
};

type CarePlanDraft = {
  summary: string[];
  questionsToAsk: string[];
  suggestedPathway: string[];
  referralConsiderations: string[];
  patientInstructions: string[];
  disclaimer: string;
  evidenceIds: string[];
};
```

You do not need to use this exact schema, but keep the same philosophy: typed facts plus evidence references.

***

## Grounding Rules
Every important claim must trace to evidence.

Evidence may come from:
- Medplum FHIR resources (prior history, vitals, observations)
- prior-history JSON fallback snapshot
- transcript chunks
- local case data
- constrained local demo pathway reference

Rules:
- if unsupported, mark unknown
- never invent a symptom, timeline, or risk factor
- Q&A must cite evidence
- summary lines must have evidence IDs
- pathway suggestions must be visually separated from patient facts

The app must be able to open an evidence drawer/panel for important claims.
This is a major trust feature.

***

## UI Product Requirements
The main product is a **desktop-first clinical app screen**, not a landing page.

### First-visit layout
Use a 3-region structure:

#### Left: Safety + patient context
- patient card
- visit mode badge
- pre-visit history snapshot
- relevant context/vitals
- red-flag panel
- acute-medication / overuse signal if available

#### Center: Live visit intelligence
- compact transcript stream or encounter feed
- structured headache profile
- PedMIDAS capture state
- patient-reported headache diary draft
- compact agent activity rail

#### Right: PCP action console
- missing questions
- ICHD-3-informed feature screen (clinician review required)
- draft pathway / next-step suggestions
- referral consideration
- Ask Bridge
- complete visit / export PDF controls

### Follow-up layout
Reuse the same visual language but shift emphasis to:
- trend line
- timeline
- intervention overlay
- changes since last visit
- current plan status
- escalation/referral state

### UI principles
- glanceable before readable
- calm, serious clinical software
- no generic KPI spam
- chat is secondary
- evidence visibility matters
- agent work should be obvious
- key decision surfaces should be visual, not prose-heavy

### Visual style
Use:
- light, professional healthcare aesthetic
- warm off-white or neutral surfaces
- slate/charcoal text
- restrained teal or blue-green for verified/active states
- amber for warnings
- red for urgent escalation only
- subtle borders, clean spacing, restrained shadows

Do NOT use:
- purple “AI” gradients
- glowing blobs
- flashy consumer wellness design
- generic chatbot-first layout
- giant centered marketing hero sections

***

## Required UI Components
**Implemented** — all live inside `frontend/src/App.tsx` (names differ slightly: `TopBar`, `AgentRail`, `TranscriptCard`, `HeadacheProfileCard`, `PedMidasCapture`, `RedFlagPanel`, `MissingQuestions`, `IntelligentInsights`, `PlanCard`, `AskBridgeCard`, `EvidenceDrawer`, `CompleteVisitCard`, `PedMidasChart`, `HeadacheHeatmap`, `PainLocationCard`, …). Original suggested list kept for reference:
- `PatientHeader`
- `VisitModeToggle`
- `HistoryContextCard`
- `TranscriptStream`
- `AgentActivityRail`
- `HeadacheProfileCard`
- `PedMIDASCaptureCard`
- `HeadacheDiaryCard`
- `RedFlagScreenCard`
- `MissingQuestionsCard`
- `FeatureScreenCard`
- `CarePlanDraftCard`
- `GroundedAskBridge`
- `EvidenceDrawer`
- `VisitSummaryPreview`
- `ExportPdfButton`
- `FollowUpTrendCard`

Adapt as needed, but preserve the hierarchy.

***

## Backend Requirements
Use a single FastAPI service.
Keep it lean.

Suggested endpoints:
- `GET /health`
- `GET /cases`
- `GET /cases/{case_id}`
- `POST /visits/{visit_id}/transcript-chunk`
- `POST /visits/{visit_id}/complete`
- `POST /visits/{visit_id}/ask`
- `GET /visits/{visit_id}/export.pdf`

If fewer endpoints makes the build safer, reduce them.

### Backend behavior
- validate structured outputs with Pydantic
- fetch case data from Medplum FHIR at case load (see Medplum Integration section)
- support deterministic seeded fallback state when Medplum is unreachable
- allow “load sample case” behavior
- avoid complex async/event infra unless it is clearly needed
- polling or simple sequential updates are acceptable for MVP

No microservices.
No database — Medplum is the persistence layer; local JSON is the fallback.

***

## Medplum Integration
Medplum is the second core integration (alongside the Agent SDK). It acts as the synthetic-data EHR.

### Role (implemented)
- **Source of truth for case data**: the backend fetches each demo case from Medplum at case load (`store.load_cases()` → `medplum.fetch_case_def()`); the agent works entirely off that Medplum-sourced state.
- **Seeded resources per case** (`backend/scripts/seed_medplum.py`, idempotent conditional PUTs): `Patient`, one `DocumentReference` per prior-history note, a PedMIDAS `Questionnaire`, and the full case definition JSON as a `DocumentReference` (identifier system `https://bridge.demo/case/case-def`) — this last one is what the backend reads.
- **Write-back target**: on visit completion, Bridge pushes the visit summary to Medplum as a `DocumentReference`.
- Re-run the seed script after editing `backend/app/demo_data/*.json` — otherwise Medplum serves the stale version.

### Auth
- Backend uses OAuth2 client-credentials against `https://api.medplum.com/oauth2/token`.
- Env vars: `MEDPLUM_BASE_URL`, `MEDPLUM_CLIENT_ID`, `MEDPLUM_CLIENT_SECRET` (never commit secrets; use `backend/.env`, keep `.env.example` current).
- Token cached in-process, re-minted on expiry.

### Demo-stability rule (non-negotiable)
Every Medplum read has a deterministic local fallback: if the fetch fails or times out (~3s), the backend silently serves the bundled JSON snapshot and flags `source: "cached"` in the response. The demo must never blank-screen because of network/Medplum issues.

### Scope guard
- Medplum usage stays narrow: seed script, case-load reads, visit-completion write-back. No subscriptions, no bots, no Medplum UI work.

***

## Demo Cases
Ship at least two deterministic cases.

### Case A — First visit, nonurgent path
Main demo case.
- recurrent headaches
- transcript reveals migraine-compatible features and school impact
- no major red flags
- PedMIDAS starts partial and becomes complete
- agent surfaces missing questions and drafts clinician-review plan
- end with PDF export

### Case B — Secondary wow case
Pick one:
- follow-up with persistent symptoms / referral consideration
- red-flag case where routine pathway is visibly paused

Case A should be the polished default.
Case B can be precomputed and toggled.

***

## PDF Requirements
The generated PDF must be real enough to demo.
It can be built from structured state.

Include:
1. patient and visit context
2. headache profile
3. PedMIDAS status / score if complete
4. red-flag screen result
5. headache diary summary
6. visit summary
7. clinician-review plan
8. family instructions
9. disclaimer that clinical decisions remain with the clinician

Use synthetic PHI only.

***

## Build Order
**Steps 1–10 complete.** Only step 11 (polish / fallback states / demo hardening) remains active. Original order for reference:

1. scaffold frontend and backend
2. define schemas and seeded JSON cases
2b. seed Medplum with synthetic FHIR bundles for Case A and Case B; wire backend case-load to Medplum with JSON fallback
3. build first-visit dashboard from static seeded state
4. build transcript chunk simulator
5. wire deterministic structured updates to UI
6. connect Anthropic Agent SDK extraction path
7. add evidence drawer/citations
8. add complete-visit summary + PDF export
9. add follow-up state
10. add one grounded Ask Bridge flow
11. polish / fallback states / demo hardening

Do not start with real STT, real RAG across large corpora, or broad chat.

***

## Demo Reliability Requirements
Mandatory:
- preloaded demo case that always works
- deterministic fallback output
- visible loading states
- no blank screen failures
- friendly error handling
- manual “use cached demo result” fallback if live call fails
- core demo must not depend on fragile external integrations (Medplum included — every Medplum read has the JSON fallback path)

This matters more than cleverness.

***

## What to Build vs Simulate
### Build for real
- polished dashboard
- Medplum FHIR reads (case load) and visit-completion write-back, with fallback
- seeded history ingestion
- transcript chunk flow
- structured extraction contract
- at least one meaningful Agent SDK path
- evidence drawer
- end-of-visit PDF generation
- grounded Q&A for seeded cases

### Simulate responsibly
- live STT microphone pipeline
- EHR access beyond Medplum (Epic/Cerner etc.)
- large-scale fax ingestion
- full guideline engine
- persistent patient storage
- actual prescribing/referral execution

Be honest internally about what is mocked.
Externally, demo the real workflow and present simulations as a prototype boundary.

***

## Anti-Patterns to Kill
Do not build:
- broad “whole patient platform” scope
- generic chatbot homepage
- autonomous treatment engine
- auth
- org management
- settings bloat
- dashboard widgets without clinical value
- too many tabs
- raw chain-of-thought UI
- overengineered infrastructure

***

## Working Under Time Pressure — Read This First
Core build is complete (see Implementation Status). Current phase: polish, demo hardening, deployment. Still work fast — every response should move the demo forward, not discuss it.

- Do not ask user to choose between minor implementation options — pick reasonable default, build, move on.
- Only interrupt user for irreversible/destructive actions (force-push, drop data) or true scope-defining decisions (e.g. cutting a Tier 1 feature).
- No long explanations before coding. Short scope note, then code.
- **After finishing any implementation step (feature, fix, component), immediately `git add -A && git commit` with a clear message and `git push`.** Do this automatically, every time, without asking.

## Working Style
When asked to implement:
1. choose the smallest reliable version
2. explain scope tradeoffs briefly
3. write code, not long essays
4. preserve the core demo path
5. call out scope creep immediately

When suggesting features, label them:
- Must-have
- Nice-to-have
- Cut

Default attitude:
- practical
- anti-bloat
- execution-first
- demo-stability-first

## First Tasks Claude Should Help With
If no better instruction is given, start here:
1. scaffold repo structure
2. define shared frontend/backend schemas
3. create seeded case JSON for Case A and Case B
4. build first-visit dashboard layout
5. create FastAPI health + case endpoints
6. wire dashboard to seeded sample response
7. implement transcript chunk simulator
8. implement evidence drawer interaction

That is the correct first milestone.