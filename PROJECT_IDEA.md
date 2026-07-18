# Bridge — Project Idea & Product Specification

> **Status note (2026-07-18):** this is the original pre-build specification, kept for historical context. The project is now built — see `README.md` for the current state. Two notable deviations from this spec: (1) a real EHR integration *was* added — Medplum FHIR is the source of truth for case data (seed / read / write-back), with the JSON snapshot demoted to deterministic fallback; (2) the backend also serves guideline-linked "Intelligent Insights" (differential-dx + treatment considerations) per case.

## Executive Summary

**Bridge** is a live visit-intelligence agent for primary care pediatricians managing children with headaches in underserved settings. During a first headache visit, Bridge combines available patient history with a live transcript of the PCP-patient conversation, converts fragmented information into a structured clinical picture, surfaces missing questions and safety signals, and produces a clinician-reviewed end-of-visit plan for the family.

The project’s narrow wedge is **pediatric headache care in primary care**. The goal is not to replace the pediatric headache specialist; it is to help PCPs use their short visit more effectively, identify situations that merit escalation, and maintain a clear longitudinal story when specialist access is limited.

## The Problem

A first headache visit is cognitively dense. A PCP must absorb prior medical history, ask about headache pattern and associated symptoms, assess lifestyle and functional impact, recognize concerning features, document the encounter, and decide what happens next—often within a short visit.

Important information is fragmented across prior notes, patient/parent recall, vitals, and the live conversation. The conversation itself can be transcribed but is typically not transformed into a structured, longitudinal headache record. The result is manual chart review, repeated questioning, missed context, administrative load, and a less usable picture of how the child is functioning.

Pediatric migraine disability is not captured by pain alone. PedMIDAS was developed as a reliable, valid, developmentally sensitive instrument for measuring migraine-related disability in children and adolescents and for monitoring change over time. [1] Its use can help distinguish headache frequency from functional disability and clarify the impact of headache on school and daily activities. [2]

## Why This Vertical

Pediatric headache is an unusually strong first vertical because it combines:
- a high-context first interview
- a longitudinal story rather than a single lab value
- a validated disability instrument (PedMIDAS)
- visualizable patterns, including frequency, functional impact, and treatment response
- a meaningful distinction between routine PCP follow-up and cases needing specialist input

The International Classification of Headache Disorders, 3rd edition (ICHD-3), defines characteristic migraine features such as recurrent attacks, pulsating quality, moderate/severe intensity, activity aggravation, nausea/vomiting, and light/sound sensitivity; in children and adolescents, attacks may last 2–72 hours. [3] Bridge uses a constrained, clinician-reviewed feature screen inspired by these concepts; it does not autonomously diagnose patients.

## Target User

**Primary user:** PCP / pediatrician in an underserved or safety-net practice.

**Primary moment:** a child presents for a first headache visit, and the PCP needs a coherent view while the conversation is happening.

**User outcome:** “I can see the headache story, what I still need to ask, whether anything concerning is present, and what needs to happen next without manually building the whole picture in my head.”

## One-Sentence Value Proposition

**Bridge turns a pediatric headache visit—live conversation plus fragmented history—into an evidence-linked headache profile, functional-impact view, safety screen, and clinician-reviewed next-step plan.**

## Product Scope

### In scope
- Pediatric headache / migraine workflow only
- First visit plus a follow-up (visit 2+) state
- Synthetic patient history and prior visits seeded into Medplum FHIR (JSON snapshot as deterministic fallback)
- Synthetic live transcript chunks simulating STT
- Structured extraction, visual dashboard, grounded Q&A, summary, plan, and PDF export
- Clinician review at every action point

### Explicitly out of scope
- General EHR replacement
- Multi-specialty platform
- Autonomous diagnosis or prescribing
- Real patient data
- EHR integrations beyond Medplum (Epic/Cerner); fax integration
- Real telehealth/STT infrastructure for the MVP
- Patient portal or messaging system

## Product Concept

Bridge has two visit modes.

| Mode | User situation | Product focus |
|---|---|---|
| First visit | A pediatric patient presents with headaches for the first time | Turn live interview and history into a structured headache baseline, PedMIDAS capture, diary, safety screen, and reviewable plan |
| Follow-up visit (2+) | Patient returns after an initial plan | Show what changed: PedMIDAS trend, headache pattern, medication/intervention overlay, prior plan status, and referral/escalation status |

## First-Visit Workflow

### Starting context
1. PCP opens Bridge for the patient.
2. Bridge loads a synthetic pre-visit history: prior visits, relevant medications, selected vitals, and context.
3. The dashboard begins with facts already known and visibly marks unknowns.

### During the interview
4. A synthetic STT stream emits transcript chunks from the visit.
5. The Anthropic-powered Visit Intelligence Agent reads each chunk.
6. The agent extracts evidence-linked facts into the headache profile.
7. The dashboard updates in real time with structured, glanceable information.
8. The agent identifies unanswered high-value questions instead of inventing answers.

### During the visit, the PCP sees
- headache onset, frequency, duration, location, quality, severity
- associated symptoms and triggers
- sleep, hydration, meals, screen time, stress, and relevant habits when discussed
- current acute medication use
- school / functional impact
- patient-reported headache diary draft
- PedMIDAS completion state and score when enough answers exist
- positive, negative, and unknown safety-screen elements
- compact prior-history context
- grounded Q&A about the patient’s profile and history

### At visit completion
9. PCP reviews the generated structured summary and draft plan.
10. PCP selects “Complete visit.”
11. Bridge generates a printable PDF for clinician and family use.

## Follow-Up Workflow

The follow-up screen proves the system is longitudinal, not just a transcription summary.

It prioritizes:
- “what changed since the last visit” brief
- PedMIDAS trend
- headache-day / severity trend
- medication or intervention overlay
- adherence or side-effect notes when available
- prior plan status
- current referral / escalation consideration

The follow-up state should answer: **Is the child improving, stable, worsening, or in need of clinician-reviewed escalation?**

## Agent Responsibilities

The **Visit Intelligence Agent** is the engine. It is not a generic chat assistant.

| Agent action | Input | Visible output |
|---|---|---|
| Read context | Medplum FHIR case data (JSON fallback) | Prior-history snapshot and cited facts |
| Process conversation | Live transcript chunk | Structured headache profile updates |
| Capture disability | PedMIDAS-relevant answers | Completion state, missing questions, score when complete |
| Build pattern | Frequency/severity statements | Patient-reported headache diary draft |
| Safety screen | Positive/negative red-flag statements | Red-flag panel with absent/present/unknown states |
| Detect missing data | Incomplete interview | Focused questions to ask next |
| Draft action plan | Patient facts + constrained demo pathway | Clinician-review plan and family instructions |
| Answer question | Patient record only | Source-cited response |
| Generate artifact | Completed visit state | Printable PDF summary and action plan |

## Agent Grounding Rules

Every important output must be traceable to a source.

Sources include:
- prior-history JSON entries
- transcript turns
- vitals / local demo record fields
- local, curated demo pathway reference

The agent must:
- return `unknown` when evidence is missing
- never fill gaps with plausible-sounding clinical details
- separate patient facts from pathway suggestions
- expose source snippets through clickable citations
- avoid hidden reasoning / chain-of-thought displays

## UI Design

### First Visit: Three-region layout

#### Left: Safety and patient context
- Patient card: age, preferred language, clinic, visit state
- Pre-visit history snapshot
- Relevant vitals/context
- Red-flag screen
- Acute-medication / overuse signal when available

#### Center: Live visit intelligence
- Compact transcript stream
- Agent status rail: “reading history,” “extracting symptoms,” “updating PedMIDAS,” “checking safety screen”
- Structured headache profile
- PedMIDAS capture card
- Patient-reported headache diary / 30-day pattern

#### Right: PCP action console
- Missing questions to ask
- ICHD-3-informed feature screen, clearly marked “clinician review required”
- Draft care pathway / next-step suggestions
- Referral or escalation consideration
- Grounded Ask Bridge
- Complete visit / export PDF

### Follow-Up: Hierarchy changes
The same layout language stays, but the center becomes a longitudinal review surface:
- trend chart
- timeline
- treatment overlay
- changes since last visit
- updated plan

## Key Visual Components

### Headache profile
A structured, highly glanceable set of cards—not a narrative block:
- Onset
- Headache days/month
- Attack duration
- Quality/location
- Severity
- Associated symptoms
- Triggers
- Lifestyle factors
- Acute medication use
- School impact

Each field shows one of:
- present
- absent / negative
- unknown
- needs clinician confirmation

### PedMIDAS capture
PedMIDAS should not be a decorative gauge. It should show:
- six-question completion state
- captured responses
- missing items
- total only when sufficiently complete
- functional context such as school impact

PedMIDAS is a validated tool that can help quantify disability and monitor response over time. [1][2]

### Headache diary
A visual 30-day draft derived from patient/parent report during the interview.
- Label it “Patient-reported draft” until confirmed.
- Use intensity/frequency encoding.
- Never imply a precise diary was recorded if the transcript does not support it.

### Red-flag screen
Show each concern as:
- Present
- Absent
- Unknown

When a concerning seeded case is selected, display a clear escalation card that pauses routine pathway suggestions and asks for clinician confirmation. Do not generate urgent orders or claim a diagnosis.

### Grounded Ask Bridge
This is secondary to the dashboard. It can answer questions such as:
- “What has the family reported about school impact?”
- “Which red-flag questions are still unanswered?”
- “What changed since the previous visit?”

Every answer includes citations to transcript turns/history entries. It must not provide unsupported clinical advice.

## Care-Pathway Support

Bridge can show an **ICHD-3-informed feature screen** and a small local curated demo pathway. It can highlight what was stated, what remains unknown, and what requires clinician review.

The ICHD-3 reference describes migraine-without-aura features, but Bridge does not use those criteria to issue an autonomous diagnosis. [3]

For nonurgent demo cases, the action console may contain reviewable categories such as:
- lifestyle and diary support
- acute symptom-management discussion
- preventive-pathway consideration
- defined follow-up interval
- referral / escalation consideration if red flags or persistent issues arise

The UI must say “draft for clinician review.” It may not issue prescriptions, doses, or orders.

## PDF Artifact

At the end of the first visit, Bridge produces a real printable PDF containing:
1. Patient and visit information
2. Structured headache profile
3. PedMIDAS capture / status
4. Safety-screen status
5. Headache diary summary
6. Evidence-linked clinician-review summary
7. Draft next steps and family instructions
8. Disclaimer: final clinical decisions remain with the clinician

This is the tangible end-of-demo payoff.

## Demo Cases

### Case A — First visit, nonurgent pathway
This is the main demo.
- Child with several months of recurrent headaches
- Transcript reveals frequency, associated symptoms, lifestyle contributors, school impact, and no seeded red flags
- PedMIDAS starts incomplete and completes as the interview progresses
- Agent surfaces missing questions, builds structured profile, and drafts a clinician-review plan
- End with PDF export

### Case B — Follow-up or escalation
Use as a quick second state / backup wow moment.
Option 1: Follow-up shows worsening / persistent symptoms and a referral consideration.
Option 2: A red flag appears; routine pathway is paused and clinician-reviewed escalation is highlighted.

## Demo Script

### 0:00–0:20 — Problem
“PCPs in underserved settings have a short visit to build a detailed headache story. The history is fragmented, and the live conversation becomes a transcript that rarely turns into a usable clinical picture.”

### 0:20–1:25 — Live first visit
- Load Case A.
- Stream transcript chunks.
- Show profile fields populating.
- Point out PedMIDAS capture, diary, safety screen, and missing questions.
- Show compact agent action status.

### 1:25–2:05 — Clinical clarity
- Show clinician-review feature screen / action console.
- Ask one grounded question.
- Click a citation to prove evidence grounding.

### 2:05–2:35 — Tangible action
- Complete visit.
- Show structured summary and plan.
- Export the family/clinician PDF.

### 2:35–3:00 — Longitudinal proof
- Toggle to follow-up / escalation case.
- Show PedMIDAS trend and referral consideration.
- Close: “Bridge helps the PCP keep the full headache story visible from the first visit until specialist co-management is actually needed.”

## Technical Architecture

### Frontend (as built)
- React 19 + TypeScript + Vite
- Tailwind v4 (custom Bridge theme; no component library — hand-built cards)
- Inline SVG charts (PedMIDAS trend, diary heatmap, pain-location diagram)
- All rendered data originates from backend `VisitState`

### Backend (as built)
- FastAPI + Pydantic v2
- Anthropic Claude Agent SDK (schema-validated structured output)
- Medplum FHIR: seed script, case-load reads, visit-summary write-back
- Seed data in JSON as deterministic fallback
- Local/in-memory state

### Real vs simulated

| Build as real | Simulate for MVP |
|---|---|
| Frontend dashboard | EHR access beyond Medplum (Epic/Cerner) |
| Medplum FHIR read / write-back | Real patient documents |
| Transcript-chunk processing interface | Live STT microphone pipeline |
| Structured agent extraction | Real fax ingestion at scale |
| Evidence/citation drawer | Broad guideline database |
| PDF generation | Patient portal / messaging |
| One grounded Q&A path | Long-term production storage |
| Follow-up visualization | Autonomous actions/orders |

## Must-Have Build Order

1. Seeded case JSON and schemas
2. First-visit dashboard from static data
3. Transcript-chunk simulator
4. Deterministic structured state updates
5. Agent SDK structured extraction call
6. Evidence drawer
7. End-visit summary and PDF generation
8. Follow-up state
9. Grounded Q&A
10. Demo hardening and polish

## Kill List

Do not spend time on:
- auth
- real EHR integration
- production STT
- multiple disease specialties
- generic chat features
- autonomous medication selection
- elaborate settings/admin pages
- deep analytics unrelated to the decision during this visit
- complex real-time infrastructure

## Success Criteria

A judge should understand, almost immediately:
1. The PCP is conducting a pediatric headache visit.
2. Bridge is actively turning conversation plus history into a structured clinical picture.
3. The system helps the clinician see functional impact, missing questions, safety signals, and next steps.
4. Every important claim is evidence-linked.
5. The clinician—not the model—remains the decision-maker.

## Final Product Principle

**Bridge is not a chatbot that summarizes a chart after the fact. It is a structured visit-intelligence agent that makes the live pediatric headache encounter easier to assess, safer to review, and easier to carry forward into follow-up care.**