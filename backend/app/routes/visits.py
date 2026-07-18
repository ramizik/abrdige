from fastapi import APIRouter, HTTPException, Response

from ..models import AskRequest, AskResponse, ChunkAdvanceResponse, Citation, VisitState
from ..services import extraction, pdf, store

router = APIRouter()


def _require_visit(visit_id: str) -> VisitState:
    state = store.get_visit(visit_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Unknown visit: {visit_id}")
    return state


@router.post("/visits/{visit_id}/transcript-chunk", response_model=ChunkAdvanceResponse)
async def advance_transcript_chunk(visit_id: str) -> ChunkAdvanceResponse:
    """Process the next transcript chunk and return the full updated state."""
    state = _require_visit(visit_id)
    raw = store.get_visit_case_raw(visit_id)
    delta_override = None
    if not extraction.demo_mode() and state.chunks_processed < state.chunks_total:
        chunk = raw["chunks"][state.chunks_processed]
        delta_override = await extraction.extract_delta_live(chunk, raw)
    state = store.advance_chunk(visit_id, delta_override)
    return ChunkAdvanceResponse(
        state=state, done=state.chunks_processed >= state.chunks_total
    )


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
            "Content-Disposition": f'inline; filename="bridge-visit-{visit_id}.pdf"'
        },
    )
