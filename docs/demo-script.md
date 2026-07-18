# Bridge Demo Script (~3 min)

Setup before demo: backend on :8000 (`.venv/bin/uvicorn app.main:app`), frontend `npm run dev` (:5173). App auto-opens Case A on the **Live Visit** tab and playback starts immediately. Deep links: `?case=case-b&tab=headache`.

- **0:00–0:20 — Problem.** Short visit, fragmented history, transcript never becomes a usable picture. Point at the left column: EMR summary already agent-pulled from Medplum FHIR (PMH, allergy with "confirm before any prescription" flag, mother's migraine, ibuprofen overuse-watch).
- **0:20–1:25 — Live first visit (Case A).** Transcript chunks stream in (each tick is a real backend call); watch the Headache Profile grid fill (onset, frequency, phenotype, aura) with `ev·n` chips — click one → **evidence drawer** with the verbatim quote. PedMIDAS captures item-by-item, scores only at 6/6. Red-flag KPI stays 0 with "14/14 screened". "Still to Ask" shrinks to zero.
- **1:25–1:50 — Real agent moment.** Press **Analyze (Agent SDK)** — Claude re-reads history + transcript and returns a schema-validated re-assessment (status line shows live vs deterministic fallback). Then **Intelligent Insights** on the right: ICHD-3 criteria met/partial/unmet, confidence bars, guideline links — labeled decision support, clinician review required.
- **1:50–2:15 — Grounded Q&A.** Ask Bridge: click a suggested question ("Any red flags on intake screen?") → answer with source citations; click a citation chip → evidence drawer.
- **2:15–2:35 — Complete visit.** Click **Complete visit** → clinician-review plan replaces the draft (summary, suggested pathway, family instructions, disclaimer); **Export PDF** opens the action plan. Summary is written back to Medplum as a FHIR DocumentReference.
- **2:35–3:00 — Longitudinal proof (Case B).** Switch case in the top-right selector (or `?case=case-b&tab=headache`): PedMIDAS trend 32→11 with intervention marker, "Changes Since Last Visit" with evidence chips, overuse concern resolved, red-flag catalog still clear.

Fallbacks: `BRIDGE_DEMO_MODE=1` keeps per-chunk extraction deterministic (Analyze still runs the real agent). Medplum unreachable → local JSON snapshot, no blank screen. Never demo with live per-chunk extraction (`BRIDGE_DEMO_MODE=0`) unless rehearsed.
