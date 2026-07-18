"""Mid-visit analysis pipeline — real Claude Agent SDK path.

The PCP presses "Analyze": the agent re-reads the full visit so far (history +
accumulated transcript) and returns a validated structured delta that overwrites
the dashboard state. Falls back gracefully; the caller keeps the deterministic
state on any failure.
"""

import json
import os
from pathlib import Path
from typing import Any

from ..models import AnalysisDelta, VisitState

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "analysis.md"

ANALYSIS_MODEL = os.environ.get("BRIDGE_ANALYSIS_MODEL", "claude-sonnet-5")


def _inline_refs(schema: dict[str, Any]) -> dict[str, Any]:
    """Inline $ref/$defs — the CLI structured-output validator rejects $refs
    and silently falls back to a {"response": string} wrapper otherwise."""
    defs = schema.get("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                name = node["$ref"].split("/")[-1]
                return resolve({k: v for k, v in defs[name].items()})
            return {k: resolve(v) for k, v in node.items() if k != "$defs"}
        if isinstance(node, list):
            return [resolve(v) for v in node]
        return node

    return resolve({k: v for k, v in schema.items() if k != "$defs"})


async def analyze_visit(
    state: VisitState, case_raw: dict[str, Any]
) -> tuple[dict[str, Any] | None, str | None]:
    """Run the Agent SDK over the full visit-so-far. Returns (delta, error)."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None, "ANTHROPIC_API_KEY not configured"
    try:
        from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

        payload = {
            "history": [h.model_dump() for h in state.history],
            "transcript": [t.model_dump() for t in state.transcript],
            "red_flag_catalog": case_raw["red_flag_catalog"],
            "pedmidas_questions": case_raw["pedmidas_questions"],
            "current_missing_questions": state.missing_questions,
        }
        options = ClaudeAgentOptions(
            system_prompt=PROMPT_PATH.read_text(),
            model=ANALYSIS_MODEL,
            allowed_tools=[],
            max_turns=1,
            output_format={
                "type": "json_schema",
                "schema": _inline_refs(AnalysisDelta.model_json_schema()),
            },
        )
        structured: dict[str, Any] | None = None
        error: str | None = None
        async for message in query(prompt=json.dumps(payload), options=options):
            if isinstance(message, ResultMessage):
                structured = message.structured_output
                if message.is_error:
                    error = message.result or "agent returned an error"
        if structured is None:
            return None, error or "no structured output returned"
        # CLI fallback shape when the schema is rejected: {"response": "<json>"}
        if set(structured.keys()) == {"response"} and isinstance(structured["response"], str):
            structured = json.loads(structured["response"])
        delta = AnalysisDelta.model_validate(structured)
        return delta.model_dump(exclude_none=True), None
    except Exception as exc:  # any SDK/parse failure → deterministic fallback
        return None, f"{type(exc).__name__}: {exc}"
