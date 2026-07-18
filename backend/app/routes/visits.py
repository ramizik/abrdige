from fastapi import APIRouter, HTTPException, Response

from ..models import (
    AnalyzeResponse,
    AskRequest,
    AskResponse,
    ChunkAdvanceResponse,
    Citation,
    VisitState,
)
from ..services import analysis, extraction, pdf, store

router = APIRouter()


def _require_visit(visit_id: str) -> VisitState:
    state = store.get_visit(visit_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Unknown visit: {visit_id}")
    return state


@router.post("/visits/{visit_id}/transcript-chunk", response_model=ChunkAdvanceResponse)
async def advance_transcript_chunk(
    visit_id: str, extract: bool = True
) -> ChunkAdvanceResponse:
    """Process the next transcript chunk and return the full updated state.

    extract=false appends raw transcript only (STT simulation) — dashboard
    updates then come from POST /analyze (the real Agent SDK pipeline).
    """
    state = _require_visit(visit_id)
    raw = store.get_visit_case_raw(visit_id)
    delta_override = None
    if extract and not extraction.demo_mode() and state.chunks_processed < state.chunks_total:
        chunk = raw["chunks"][state.chunks_processed]
        delta_override = await extraction.extract_delta_live(chunk, raw)
    state = store.advance_chunk(visit_id, delta_override, apply_delta=extract)
    return ChunkAdvanceResponse(
        state=state, done=state.chunks_processed >= state.chunks_total
    )


@router.post("/visits/{visit_id}/analyze", response_model=AnalyzeResponse)
async def analyze_visit(visit_id: str) -> AnalyzeResponse:
    """Mid-visit analysis: the Agent SDK re-reads history + transcript so far
    and returns an updated structured picture. Deterministic state is kept
    untouched if the live call fails."""
    state = _require_visit(visit_id)
    raw = store.get_visit_case_raw(visit_id)
    delta, error = await analysis.analyze_visit(state, raw)
    if delta is None:
        state.agent_status = "Live analysis unavailable — showing deterministic data"
        return AnalyzeResponse(state=state, live=False, error=error)
    state = store.apply_analysis_delta(visit_id, delta)
    return AnalyzeResponse(state=state, live=True)


@router.post("/visits/{visit_id}/complete", response_model=VisitState)
def complete_visit(visit_id: str) -> VisitState:
    _require_visit(visit_id)
    return store.complete_visit(visit_id)


@router.post("/visits/{visit_id}/ask", response_model=AskResponse)
def ask(visit_id: str, req: AskRequest) -> AskResponse:
    state = _require_visit(visit_id)
    raw = store.get_visit_case_raw(visit_id)
    result = extraction.answer_question(req.question, raw)
    citations = []
    for ev_id in result["citations"]:
        ref = state.evidence.get(ev_id)
        if ref:
            citations.append(
                Citation(evidence_id=ev_id, quote=ref.quote, source_label=ref.source_label)
            )
    return AskResponse(
        answer=result["answer"], citations=citations, grounded=result["grounded"]
    )


@router.get("/visits/{visit_id}/export.pdf")
def export_pdf(visit_id: str) -> Response:
    state = _require_visit(visit_id)
    if state.care_plan is None:
        state = store.complete_visit(visit_id)
    content = pdf.build_visit_pdf(state)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="byebyeheadache-visit-{visit_id}.pdf"'
        },
    )
