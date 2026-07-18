from fastapi import APIRouter, HTTPException

from ..models import CaseSummary, VisitState
from ..services import store

router = APIRouter()


@router.get("/cases", response_model=list[CaseSummary])
def get_cases() -> list[CaseSummary]:
    return store.list_cases()


@router.get("/cases/{case_id}", response_model=VisitState)
def open_case(case_id: str) -> VisitState:
    """Open a case: creates a visit and returns its initial state."""
    state = store.create_visit(case_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Unknown case: {case_id}")
    return state
