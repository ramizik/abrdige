/** TS mirror of backend/app/models.py — keep in sync. */

export type FactStatus = 'present' | 'negative' | 'unknown' | 'needs_confirmation';
export type RedFlagStatus = 'present' | 'absent' | 'unknown';
export type SourceType = 'history' | 'transcript' | 'vitals' | 'document' | 'guideline';
export type VisitMode = 'first_visit' | 'follow_up';
export type VisitPhase = 'not_started' | 'in_progress' | 'complete';

export interface EvidenceRef {
  id: string;
  source_type: SourceType;
  source_label: string;
  quote: string;
  timestamp?: string | null;
}

export interface ExtractedFact {
  value: string | null;
  status: FactStatus;
  evidence_ids: string[];
}

export interface NumericFact {
  value: number | null;
  status: FactStatus;
  evidence_ids: string[];
}

export interface ListFact {
  value: string[];
  status: FactStatus;
  evidence_ids: string[];
}

/** Intake capture: what the EMR does not reliably structure for headache decisions. */
export interface HeadacheProfile {
  // current headache pattern
  onset: ExtractedFact;
  frequency_days_per_month: NumericFact;
  severe_attacks_per_month: NumericFact;
  episode_duration: ExtractedFact;
  progression: ExtractedFact;
  // headache phenotype
  location: ExtractedFact;
  quality: ExtractedFact;
  severity: ExtractedFact;
  activity_worsening: ExtractedFact;
  associated_symptoms: ListFact;
  aura: ExtractedFact;
  aura_duration: ExtractedFact;
  // context
  triggers: ListFact;
  relievers: ListFact;
  habits: ListFact;
  diary_available: ExtractedFact;
  family_history: ExtractedFact;
  // recent treatment response
  acute_medication_use: ListFact;
  preventive_medication_use: ListFact;
  treatment_response: ExtractedFact;
  /** acute meds >= 10 days/month */
  medication_overuse_risk: ExtractedFact;
  non_medical_interventions: ListFact;
  // functional burden
  school_impact: ExtractedFact;
  activity_impact: ExtractedFact;
  repeat_visits: ExtractedFact;
  /** "In the past 4 weeks, how much have headaches interfered with daily life?" */
  headache_interference: ExtractedFact;
}

/** PCP exam findings stated during the visit (clinician-reported). */
export interface ExamSnapshot {
  general_appearance: ExtractedFact;
  neuro_exam: ListFact;
  funduscopic: ExtractedFact;
}

/** What the PCP explicitly states during the visit — never inferred. */
export interface ClinicianAssessment {
  impression: ExtractedFact;
  /** low / moderate / high */
  concern_level: ExtractedFact;
  /** likely migraine / likely tension-type / possible secondary / unsure */
  tentative_classification: ExtractedFact;
  plan_selections: ListFact;
}

/** --- Agent-built EMR summary (auto-extracted from chart, not asked at intake) --- */

export type EmrCategory =
  | 'pmh'
  | 'allergy'
  | 'family_history'
  | 'medication'
  | 'visit_note'
  | 'imaging'
  | 'lab'
  | 'referral'
  | 'no_show'
  | 'wait_status';

export interface EmrItem {
  id: string;
  category: EmrCategory;
  label: string;
  detail: string;
  /** headache-relevance flag, e.g. "overuse watch", "contraindication" */
  flag: string;
  date: string;
  evidence_ids: string[];
}

export interface EmrSummary {
  headline: string;
  evidence: EvidenceRef[]; // merged into VisitState.evidence by the backend
  items: EmrItem[];
}

export interface RedFlag {
  key: string;
  label: string;
  status: RedFlagStatus;
  evidence_ids: string[];
}

export interface PedMIDASResponse {
  question_id: string;
  question: string;
  value: number | null;
  evidence_ids: string[];
}

export interface PedMIDASState {
  responses: PedMIDASResponse[];
  score: number | null;
  completion: 'complete' | 'partial' | 'not_started';
  missing_question_ids: string[];
}

export interface DiaryDay {
  day: number; // 1..30, relative days back from today
  intensity: number | null; // 0 none .. 3 severe
  evidence_ids: string[];
}

export interface HeadacheDiary {
  label: string;
  days: DiaryDay[];
}

export interface CarePlanDraft {
  summary: string[];
  questions_to_ask: string[];
  suggested_pathway: string[];
  referral_considerations: string[];
  patient_instructions: string[];
  disclaimer: string;
  evidence_ids: string[];
}

export interface TranscriptTurn {
  id: string;
  speaker: 'clinician' | 'patient' | 'parent';
  text: string;
  timestamp?: string | null;
}

export interface HistoryEntry {
  id: string;
  label: string;
  date?: string | null;
  text: string;
}

export interface PedMIDASPoint {
  date: string;
  score: number;
  evidence_ids: string[];
}

export interface MedicationEvent {
  date: string;
  label: string;
  kind: 'start' | 'change' | 'stop';
  evidence_ids: string[];
}

export interface Patient {
  id: string;
  name: string;
  age: number;
  sex: string;
  preferred_language: string;
  clinic: string;
  mrn: string;
  provider: string;
  visit_length: string;
  visit_type: string;
  chief_complaint: string;
  referral_status: string;
}

/** --- Pre-visit referral review (New Referral — Initial Review screen) --- */

export interface BriefLine {
  id: string;
  text: string;
  source_label: string;
  evidence_ids: string[];
}

export interface TimelineEvent {
  date: string;
  label: string;
  sublabel: string;
  kind: 'er_visit' | 'records' | 'call' | 'visit' | 'today';
}

export interface ReferralSnapshot {
  reason: string;
  duration: string;
  prior_workup: string;
  family_history: string;
}

export interface PriorEvaluation {
  id: string;
  title: string;
  detail: string;
  evidence_ids: string[];
}

export interface PlanItem {
  id: string;
  title: string;
  detail: string;
  evidence_ids: string[];
}

export interface HandoffItem {
  id: string;
  title: string;
  detail: string;
  status: 'draft_ready' | 'pending_decision' | 'not_sent' | 'sent';
}

export interface UnresolvedItem {
  id: string;
  text: string;
  requested_from: string;
  date: string;
}

export interface PrevisitBrief {
  headline: string;
  evidence: EvidenceRef[]; // merged into VisitState.evidence by the backend
  documents_count: number;
  sources_count: number;
  assembled_seconds: number;
  confidence: 'low' | 'moderate' | 'high';
  brief_lines: BriefLine[];
  timeline: TimelineEvent[];
  referral_snapshot: ReferralSnapshot;
  prior_evaluations: PriorEvaluation[];
  family_developmental_history: string[];
  draft_plan: PlanItem[];
  ask_during_visit: string[];
  handoff_items: HandoffItem[];
  unresolved_items: UnresolvedItem[];
  suggested_questions: string[];
}

export interface VisitState {
  visit_id: string;
  case_id: string;
  mode: VisitMode;
  phase: VisitPhase;
  patient: Patient;
  previsit: PrevisitBrief | null;
  emr_summary: EmrSummary | null;
  history: HistoryEntry[];
  transcript: TranscriptTurn[];
  chunks_processed: number;
  chunks_total: number;
  agent_status: string;
  profile: HeadacheProfile;
  exam: ExamSnapshot;
  clinician_assessment: ClinicianAssessment;
  red_flags: RedFlag[];
  pedmidas: PedMIDASState;
  diary: HeadacheDiary;
  missing_questions: string[];
  care_plan: CarePlanDraft | null;
  pedmidas_trend: PedMIDASPoint[];
  medication_events: MedicationEvent[];
  changes_since_last_visit: string[];
  evidence: Record<string, EvidenceRef>;
}

export interface CaseSummary {
  case_id: string;
  title: string;
  mode: VisitMode;
  description: string;
}

export interface Citation {
  evidence_id: string;
  quote: string;
  source_label: string;
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
  grounded: boolean;
}

export interface ChunkAdvanceResponse {
  state: VisitState;
  done: boolean;
}

export interface AnalyzeResponse {
  state: VisitState;
  /** true = real Agent SDK analysis; false = deterministic fallback kept */
  live: boolean;
  error?: string | null;
}
