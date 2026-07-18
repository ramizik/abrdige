"""In-memory case/visit store with deterministic delta application."""

import json
import uuid
from pathlib import Path
from typing import Any

from . import medplum
from ..models import (
    CarePlanDraft,
    CaseSummary,
    DiaryDay,
    EmrSummary,
    EvidenceRef,
    HeadacheDiary,
    HistoryEntry,
    InsightPack,
    MedicationEvent,
    Patient,
    PrevisitBrief,
    PedMIDASPoint,
    PedMIDASResponse,
    RedFlag,
    TranscriptTurn,
    VisitState,
)

DEMO_DATA_DIR = Path(__file__).resolve().parent.parent / "demo_data"

_cases: dict[str, dict[str, Any]] = {}
# case_id -> "medplum" | "local" (where the case definition actually came from)
_case_source: dict[str, str] = {}
_visits: dict[str, VisitState] = {}
# visit_id -> case raw dict (for chunks / canned answers)
_visit_case: dict[str, dict[str, Any]] = {}


def load_cases() -> None:
    """Load demo cases, preferring Medplum FHIR with the local JSON fallback.

    Local files define which cases exist; for each one we try to fetch the
    seeded case definition from Medplum. Any failure silently falls back to
    the bundled snapshot so the demo can never blank-screen.
    """
    for path in sorted(DEMO_DATA_DIR.glob("case_*.json")):
        local = json.loads(path.read_text())
        case_id = local["case_id"]
        remote = medplum.fetch_case_def(case_id) if medplum.enabled() else None
        _cases[case_id] = remote or local
        _case_source[case_id] = "medplum" if remote else "local"


def list_cases() -> list[CaseSummary]:
    if not _cases:
        load_cases()
    return [
        CaseSummary(
            case_id=c["case_id"],
            title=c["title"],
            mode=c["mode"],
            description=c["description"],
        )
        for c in _cases.values()
    ]


def get_case_raw(case_id: str) -> dict[str, Any] | None:
    if not _cases:
        load_cases()
    return _cases.get(case_id)


def create_visit(case_id: str) -> VisitState | None:
    raw = get_case_raw(case_id)
    if raw is None:
        return None
    visit_id = f"v-{uuid.uuid4().hex[:8]}"
    state = VisitState(
        visit_id=visit_id,
        case_id=case_id,
        mode=raw["mode"],
        phase="in_progress",
        patient=Patient(**raw["patient"]),
        previsit=(
            PrevisitBrief(**raw["previsit"]) if raw.get("previsit") else None
        ),
        emr_summary=(
            EmrSummary(**raw["emr_summary"]) if raw.get("emr_summary") else None
        ),
        insights=(InsightPack(**raw["insights"]) if raw.get("insights") else None),
        history=[HistoryEntry(**h) for h in raw["history"]],
        history_source=_case_source.get(case_id, "local"),
        chunks_total=len(raw.get("chunks", [])),
        agent_status="Reading prior history",
        red_flags=[
            RedFlag(key=rf["key"], label=rf["label"]) for rf in raw["red_flag_catalog"]
        ],
    )
    state.pedmidas.missing_question_ids = [
        q["question_id"] for q in raw["pedmidas_questions"]
    ]
    if state.emr_summary:
        for ref in state.emr_summary.evidence:
            state.evidence[ref.id] = ref
    if state.previsit:
        for ref in state.previsit.evidence:
            state.evidence[ref.id] = ref
        if state.previsit.ask_during_visit:
            state.missing_questions = list(state.previsit.ask_during_visit)
    if "precomputed_state" in raw:
        _apply_delta(state, raw["precomputed_state"], raw)
    _visits[visit_id] = state
    _visit_case[visit_id] = raw
    return state


def get_visit(visit_id: str) -> VisitState | None:
    return _visits.get(visit_id)


def get_visit_case_raw(visit_id: str) -> dict[str, Any] | None:
    return _visit_case.get(visit_id)


def advance_chunk(
    visit_id: str,
    delta_override: dict[str, Any] | None = None,
    apply_delta: bool = True,
) -> VisitState | None:
    """Apply the next transcript chunk. delta_override lets the live extraction
    path substitute its own delta. apply_delta=False appends raw transcript
    turns only — used when the real Analyze pipeline does the extraction."""
    state = _visits.get(visit_id)
    raw = _visit_case.get(visit_id)
    if state is None or raw is None:
        return None
    chunks = raw.get("chunks", [])
    if state.chunks_processed >= len(chunks):
        return state
    chunk = chunks[state.chunks_processed]
    for turn in chunk.get("turns", []):
        state.transcript.append(TranscriptTurn(**turn))
    if apply_delta:
        _apply_delta(state, delta_override or chunk.get("delta", {}), raw)
    else:
        state.agent_status = "Listening — press Analyze for an updated picture"
    state.chunks_processed += 1
    return state


def apply_analysis_delta(visit_id: str, delta: dict[str, Any]) -> VisitState | None:
    """Apply a live Agent SDK analysis delta. Analysis is a full re-assessment,
    so the diary is rebuilt rather than appended to."""
    state = _visits.get(visit_id)
    raw = _visit_case.get(visit_id)
    if state is None or raw is None:
        return None
    if delta.get("diary_days"):
        state.diary.days = []
    _apply_delta(state, delta, raw)
    return state


def complete_visit(visit_id: str) -> VisitState | None:
    state = _visits.get(visit_id)
    raw = _visit_case.get(visit_id)
    if state is None or raw is None:
        return None
    if raw.get("care_plan"):
        state.care_plan = CarePlanDraft(**raw["care_plan"])
    state.phase = "complete"
    state.agent_status = "Visit summary ready"
    if medplum.enabled():
        summary_lines = state.care_plan.summary if state.care_plan else []
        medplum.push_visit_summary(state.case_id, state.patient.name, summary_lines)
    return state


def _apply_delta(state: VisitState, delta: dict[str, Any], raw: dict[str, Any]) -> None:
    if "agent_status" in delta:
        state.agent_status = delta["agent_status"]
    for ev in delta.get("evidence", []):
        ref = EvidenceRef(**ev)
        state.evidence[ref.id] = ref
    for target_name in ("profile", "exam", "clinician_assessment"):
        target = getattr(state, target_name)
        for field, fact in (delta.get(target_name) or {}).items():
            if fact is None or not hasattr(target, field):
                continue
            fact_cls = type(getattr(target, field))
            # Live agent deltas sometimes mismatch value shape — coerce
            # instead of 500-ing mid-visit.
            value = fact.get("value") if isinstance(fact, dict) else None
            if isinstance(fact, dict):
                if fact_cls.__name__ == "ExtractedFact" and isinstance(value, list):
                    fact = {**fact, "value": ", ".join(str(v) for v in value)}
                elif fact_cls.__name__ == "ListFact" and isinstance(value, str):
                    fact = {**fact, "value": [value]}
                elif fact_cls.__name__ == "NumericFact" and isinstance(value, str):
                    try:
                        fact = {**fact, "value": float(value.split()[0])}
                    except ValueError:
                        continue
            try:
                setattr(target, field, fact_cls(**fact))
            except Exception:
                continue  # skip malformed field, keep the visit alive
    for rf_delta in delta.get("red_flags", []):
        for rf in state.red_flags:
            if rf.key == rf_delta["key"]:
                rf.status = rf_delta["status"]
                rf.evidence_ids = rf_delta.get("evidence_ids", [])
    for resp in delta.get("pedmidas_responses", []):
        q = next(
            q for q in raw["pedmidas_questions"] if q["question_id"] == resp["question_id"]
        )
        state.pedmidas.responses = [
            r for r in state.pedmidas.responses if r.question_id != resp["question_id"]
        ]
        state.pedmidas.responses.append(
            PedMIDASResponse(question=q["question"], **resp)
        )
    _recompute_pedmidas(state, raw)
    for d in delta.get("diary_days", []):
        state.diary.days.append(DiaryDay(**d))
    for point in delta.get("pedmidas_trend", []):
        state.pedmidas_trend.append(PedMIDASPoint(**point))
    for ev_event in delta.get("medication_events", []):
        state.medication_events.append(MedicationEvent(**ev_event))
    if "changes_since_last_visit" in delta:
        state.changes_since_last_visit = delta["changes_since_last_visit"]
    if "missing_questions" in delta:
        state.missing_questions = list(delta["missing_questions"])
    for q_text in delta.get("missing_questions_add", []):
        if q_text not in state.missing_questions:
            state.missing_questions.append(q_text)
    for q_text in delta.get("missing_questions_remove", []):
        if q_text in state.missing_questions:
            state.missing_questions.remove(q_text)


def _recompute_pedmidas(state: VisitState, raw: dict[str, Any]) -> None:
    all_ids = [q["question_id"] for q in raw["pedmidas_questions"]]
    answered = {r.question_id for r in state.pedmidas.responses if r.value is not None}
    state.pedmidas.missing_question_ids = [i for i in all_ids if i not in answered]
    if not answered:
        state.pedmidas.completion = "not_started"
        state.pedmidas.score = None
    elif state.pedmidas.missing_question_ids:
        state.pedmidas.completion = "partial"
        state.pedmidas.score = None
    else:
        state.pedmidas.completion = "complete"
        state.pedmidas.score = sum(r.value or 0 for r in state.pedmidas.responses)
