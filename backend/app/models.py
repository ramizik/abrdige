"""Pydantic schemas for Bridge. Mirrors frontend/src/types/bridge.ts — keep in sync."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

FactStatus = Literal["present", "negative", "unknown", "needs_confirmation"]
RedFlagStatus = Literal["present", "absent", "unknown"]
SourceType = Literal["history", "transcript", "vitals", "document", "guideline"]
VisitMode = Literal["first_visit", "follow_up"]
VisitPhase = Literal["not_started", "in_progress", "complete"]


class EvidenceRef(BaseModel):
    id: str
    source_type: SourceType
    source_label: str
    quote: str
    timestamp: Optional[str] = None


class ExtractedFact(BaseModel):
    value: Optional[str] = None
    status: FactStatus = "unknown"
    evidence_ids: list[str] = Field(default_factory=list)


class NumericFact(BaseModel):
    value: Optional[float] = None
    status: FactStatus = "unknown"
    evidence_ids: list[str] = Field(default_factory=list)


class ListFact(BaseModel):
    value: list[str] = Field(default_factory=list)
    status: FactStatus = "unknown"
    evidence_ids: list[str] = Field(default_factory=list)


class HeadacheProfile(BaseModel):
    """Intake capture: what the EMR does not reliably structure for headache
    decision-making — pattern, phenotype, functional burden, treatment response."""

    # current headache pattern
    onset: ExtractedFact = Field(default_factory=ExtractedFact)
    frequency_days_per_month: NumericFact = Field(default_factory=NumericFact)
    severe_attacks_per_month: NumericFact = Field(default_factory=NumericFact)
    episode_duration: ExtractedFact = Field(default_factory=ExtractedFact)
    progression: ExtractedFact = Field(default_factory=ExtractedFact)
    # headache phenotype
    location: ExtractedFact = Field(default_factory=ExtractedFact)
    quality: ExtractedFact = Field(default_factory=ExtractedFact)
    severity: ExtractedFact = Field(default_factory=ExtractedFact)
    activity_worsening: ExtractedFact = Field(default_factory=ExtractedFact)
    associated_symptoms: ListFact = Field(default_factory=ListFact)
    aura: ExtractedFact = Field(default_factory=ExtractedFact)
    aura_duration: ExtractedFact = Field(default_factory=ExtractedFact)
    # context
    triggers: ListFact = Field(default_factory=ListFact)
    relievers: ListFact = Field(default_factory=ListFact)
    habits: ListFact = Field(default_factory=ListFact)
    diary_available: ExtractedFact = Field(default_factory=ExtractedFact)
    family_history: ExtractedFact = Field(default_factory=ExtractedFact)
    # recent treatment response
    acute_medication_use: ListFact = Field(default_factory=ListFact)
    preventive_medication_use: ListFact = Field(default_factory=ListFact)
    treatment_response: ExtractedFact = Field(default_factory=ExtractedFact)
    # acute meds >= 10 days/month
    medication_overuse_risk: ExtractedFact = Field(default_factory=ExtractedFact)
    non_medical_interventions: ListFact = Field(default_factory=ListFact)
    # functional burden
    school_impact: ExtractedFact = Field(default_factory=ExtractedFact)
    activity_impact: ExtractedFact = Field(default_factory=ExtractedFact)
    repeat_visits: ExtractedFact = Field(default_factory=ExtractedFact)
    # "In the past 4 weeks, how much have headaches interfered with daily life?"
    headache_interference: ExtractedFact = Field(default_factory=ExtractedFact)


class ExamSnapshot(BaseModel):
    """PCP exam findings stated during the visit (clinician-reported)."""

    general_appearance: ExtractedFact = Field(default_factory=ExtractedFact)
    neuro_exam: ListFact = Field(default_factory=ListFact)
    funduscopic: ExtractedFact = Field(default_factory=ExtractedFact)


class ClinicianAssessment(BaseModel):
    """What the PCP explicitly states during the visit — never inferred."""

    impression: ExtractedFact = Field(default_factory=ExtractedFact)
    # low / moderate / high
    concern_level: ExtractedFact = Field(default_factory=ExtractedFact)
    # likely migraine / likely tension-type / possible secondary / unsure
    tentative_classification: ExtractedFact = Field(default_factory=ExtractedFact)
    # acute treatment today, preventive discussion, imaging, routine neurology
    # referral, expedited neurology/ED referral, headache diary + follow-up
    plan_selections: ListFact = Field(default_factory=ListFact)


class RedFlag(BaseModel):
    key: str
    label: str
    status: RedFlagStatus = "unknown"
    evidence_ids: list[str] = Field(default_factory=list)


class PedMIDASResponse(BaseModel):
    question_id: str
    question: str
    value: Optional[float] = None
    evidence_ids: list[str] = Field(default_factory=list)


class PedMIDASState(BaseModel):
    responses: list[PedMIDASResponse] = Field(default_factory=list)
    score: Optional[float] = None
    completion: Literal["complete", "partial", "not_started"] = "not_started"
    missing_question_ids: list[str] = Field(default_factory=list)


class DiaryDay(BaseModel):
    day: int  # 1..30, relative to today going back
    intensity: Optional[int] = None  # 0 none .. 3 severe; None = unknown
    evidence_ids: list[str] = Field(default_factory=list)


class HeadacheDiary(BaseModel):
    label: str = "Patient-reported draft"
    days: list[DiaryDay] = Field(default_factory=list)


class CarePlanDraft(BaseModel):
    summary: list[str] = Field(default_factory=list)
    questions_to_ask: list[str] = Field(default_factory=list)
    suggested_pathway: list[str] = Field(default_factory=list)
    referral_considerations: list[str] = Field(default_factory=list)
    patient_instructions: list[str] = Field(default_factory=list)
    disclaimer: str = (
        "Draft for clinician review. Final clinical decisions remain with the clinician."
    )
    evidence_ids: list[str] = Field(default_factory=list)


class TranscriptTurn(BaseModel):
    id: str
    speaker: Literal["clinician", "patient", "parent"]
    text: str
    timestamp: Optional[str] = None


class HistoryEntry(BaseModel):
    id: str
    label: str
    date: Optional[str] = None
    text: str


class PedMIDASPoint(BaseModel):
    date: str
    score: float
    evidence_ids: list[str] = Field(default_factory=list)


class MedicationEvent(BaseModel):
    date: str
    label: str
    kind: Literal["start", "change", "stop"] = "start"
    evidence_ids: list[str] = Field(default_factory=list)


class Patient(BaseModel):
    id: str
    name: str
    age: int
    sex: str
    preferred_language: str = "English"
    clinic: str = ""
    mrn: str = ""
    provider: str = ""
    visit_length: str = ""
    visit_type: str = ""
    chief_complaint: str = ""
    referral_status: str = ""


# --- Pre-visit referral review (New Referral — Initial Review screen) ---


class BriefLine(BaseModel):
    id: str
    text: str
    source_label: str
    evidence_ids: list[str] = Field(default_factory=list)


class TimelineEvent(BaseModel):
    date: str
    label: str
    sublabel: str = ""
    kind: Literal["er_visit", "records", "call", "visit", "today"] = "visit"


class ReferralSnapshot(BaseModel):
    reason: str = ""
    duration: str = ""
    prior_workup: str = ""
    family_history: str = ""


class PriorEvaluation(BaseModel):
    id: str
    title: str
    detail: str = ""
    evidence_ids: list[str] = Field(default_factory=list)


class PlanItem(BaseModel):
    id: str
    title: str
    detail: str = ""
    evidence_ids: list[str] = Field(default_factory=list)


class HandoffItem(BaseModel):
    id: str
    title: str
    detail: str = ""
    status: Literal["draft_ready", "pending_decision", "not_sent", "sent"] = (
        "pending_decision"
    )


class UnresolvedItem(BaseModel):
    id: str
    text: str
    requested_from: str = ""
    date: str = ""


class PrevisitBrief(BaseModel):
    """Seeded pre-visit intelligence shown on the referral-review screen."""

    headline: str = ""  # e.g. "New Referral - Initial Review"
    evidence: list[EvidenceRef] = Field(default_factory=list)  # merged into state.evidence
    documents_count: int = 0
    sources_count: int = 0
    assembled_seconds: float = 0.0
    confidence: Literal["low", "moderate", "high"] = "moderate"
    brief_lines: list[BriefLine] = Field(default_factory=list)
    timeline: list[TimelineEvent] = Field(default_factory=list)
    referral_snapshot: ReferralSnapshot = Field(default_factory=ReferralSnapshot)
    prior_evaluations: list[PriorEvaluation] = Field(default_factory=list)
    family_developmental_history: list[str] = Field(default_factory=list)
    draft_plan: list[PlanItem] = Field(default_factory=list)
    ask_during_visit: list[str] = Field(default_factory=list)
    handoff_items: list[HandoffItem] = Field(default_factory=list)
    unresolved_items: list[UnresolvedItem] = Field(default_factory=list)
    suggested_questions: list[str] = Field(default_factory=list)


# --- Agent-built EMR summary (auto-extracted from chart, not asked at intake) ---


EmrCategory = Literal[
    "pmh",
    "allergy",
    "family_history",
    "medication",
    "visit_note",
    "imaging",
    "lab",
    "referral",
    "no_show",
    "wait_status",
]


class EmrItem(BaseModel):
    id: str
    category: EmrCategory
    label: str
    detail: str = ""
    # headache-relevance flag, e.g. "overuse watch", "contraindication", "none on file"
    flag: str = ""
    date: str = ""
    evidence_ids: list[str] = Field(default_factory=list)


class EmrSummary(BaseModel):
    """What the agent pulled and summarized from the EMR at case load:
    PMH/allergies/family hx, prior PCP/ED/urgent-care/specialty notes,
    imaging, labs, referrals, no-shows, wait status, headache-relevant meds."""

    headline: str = "Agent-assembled chart summary"
    evidence: list[EvidenceRef] = Field(default_factory=list)  # merged into state.evidence
    items: list[EmrItem] = Field(default_factory=list)


Tone = Literal["neutral", "teal", "amber", "red"]


class InsightCriterion(BaseModel):
    text: str
    met: Literal["met", "partial", "unmet"] = "partial"


class InsightDx(BaseModel):
    """Differential-diagnosis candidate for clinician review (never autonomous)."""

    dx: str
    confidence: float
    tone: Tone = "neutral"
    guideline: str
    guideline_url: str
    criteria: list[InsightCriterion] = Field(default_factory=list)
    rationale: str = ""


class InsightTx(BaseModel):
    """Guideline-linked treatment consideration for clinician review."""

    step: str
    rec: str
    detail: str = ""
    evidence: str = ""
    evidence_url: str = ""
    tone: Tone = "neutral"


class InsightPack(BaseModel):
    note: Optional[str] = None
    dxs: list[InsightDx] = Field(default_factory=list)
    txs: list[InsightTx] = Field(default_factory=list)


class VisitState(BaseModel):
    """Aggregate state returned to the frontend after every update."""

    visit_id: str
    case_id: str
    mode: VisitMode = "first_visit"
    phase: VisitPhase = "not_started"
    patient: Patient
    previsit: Optional[PrevisitBrief] = None
    emr_summary: Optional[EmrSummary] = None
    history: list[HistoryEntry] = Field(default_factory=list)
    # "medplum" when prior history came live from the FHIR server, else "local"
    history_source: str = "local"
    transcript: list[TranscriptTurn] = Field(default_factory=list)
    chunks_processed: int = 0
    chunks_total: int = 0
    agent_status: str = "Idle"
    profile: HeadacheProfile = Field(default_factory=HeadacheProfile)
    exam: ExamSnapshot = Field(default_factory=ExamSnapshot)
    clinician_assessment: ClinicianAssessment = Field(default_factory=ClinicianAssessment)
    red_flags: list[RedFlag] = Field(default_factory=list)
    pedmidas: PedMIDASState = Field(default_factory=PedMIDASState)
    diary: HeadacheDiary = Field(default_factory=HeadacheDiary)
    missing_questions: list[str] = Field(default_factory=list)
    care_plan: Optional[CarePlanDraft] = None
    # follow-up mode extras
    pedmidas_trend: list[PedMIDASPoint] = Field(default_factory=list)
    medication_events: list[MedicationEvent] = Field(default_factory=list)
    changes_since_last_visit: list[str] = Field(default_factory=list)
    # Guideline-linked decision support (draft, clinician review required)
    insights: Optional[InsightPack] = None
    evidence: dict[str, EvidenceRef] = Field(default_factory=dict)


class CaseSummary(BaseModel):
    case_id: str
    title: str
    mode: VisitMode
    description: str


class AskRequest(BaseModel):
    question: str


class Citation(BaseModel):
    evidence_id: str
    quote: str
    source_label: str


class AskResponse(BaseModel):
    answer: str
    citations: list[Citation] = Field(default_factory=list)
    grounded: bool = True


class ChunkAdvanceResponse(BaseModel):
    state: VisitState
    done: bool


# --- Live analysis (Agent SDK structured output) ---


class RedFlagDelta(BaseModel):
    key: str
    status: RedFlagStatus
    evidence_ids: list[str] = Field(default_factory=list)


class PedMIDASResponseDelta(BaseModel):
    question_id: str
    value: Optional[float] = None
    evidence_ids: list[str] = Field(default_factory=list)


class ProfileDelta(BaseModel):
    """Partial headache profile — only fields supported by evidence are set."""

    onset: Optional[ExtractedFact] = None
    frequency_days_per_month: Optional[NumericFact] = None
    severe_attacks_per_month: Optional[NumericFact] = None
    episode_duration: Optional[ExtractedFact] = None
    progression: Optional[ExtractedFact] = None
    location: Optional[ExtractedFact] = None
    quality: Optional[ExtractedFact] = None
    severity: Optional[ExtractedFact] = None
    activity_worsening: Optional[ExtractedFact] = None
    associated_symptoms: Optional[ListFact] = None
    aura: Optional[ExtractedFact] = None
    aura_duration: Optional[ExtractedFact] = None
    triggers: Optional[ListFact] = None
    relievers: Optional[ListFact] = None
    habits: Optional[ListFact] = None
    diary_available: Optional[ExtractedFact] = None
    family_history: Optional[ExtractedFact] = None
    acute_medication_use: Optional[ListFact] = None
    preventive_medication_use: Optional[ListFact] = None
    treatment_response: Optional[ExtractedFact] = None
    medication_overuse_risk: Optional[ExtractedFact] = None
    non_medical_interventions: Optional[ListFact] = None
    school_impact: Optional[ExtractedFact] = None
    activity_impact: Optional[ExtractedFact] = None
    repeat_visits: Optional[ExtractedFact] = None
    headache_interference: Optional[ExtractedFact] = None


class ExamDelta(BaseModel):
    """Partial exam snapshot — only clinician-stated findings are set."""

    general_appearance: Optional[ExtractedFact] = None
    neuro_exam: Optional[ListFact] = None
    funduscopic: Optional[ExtractedFact] = None


class ClinicianAssessmentDelta(BaseModel):
    """Partial PCP assessment — only explicitly stated items are set."""

    impression: Optional[ExtractedFact] = None
    concern_level: Optional[ExtractedFact] = None
    tentative_classification: Optional[ExtractedFact] = None
    plan_selections: Optional[ListFact] = None


class AnalysisDelta(BaseModel):
    """Structured output contract for the Visit Intelligence Agent."""

    agent_status: str = "Analysis complete"
    evidence: list[EvidenceRef] = Field(default_factory=list)
    profile: ProfileDelta = Field(default_factory=ProfileDelta)
    exam: ExamDelta = Field(default_factory=ExamDelta)
    clinician_assessment: ClinicianAssessmentDelta = Field(
        default_factory=ClinicianAssessmentDelta
    )
    red_flags: list[RedFlagDelta] = Field(default_factory=list)
    pedmidas_responses: list[PedMIDASResponseDelta] = Field(default_factory=list)
    diary_days: list[DiaryDay] = Field(default_factory=list)
    missing_questions: list[str] = Field(default_factory=list)


class AnalyzeResponse(BaseModel):
    state: VisitState
    live: bool  # True = real Agent SDK analysis; False = deterministic fallback
    error: Optional[str] = None
