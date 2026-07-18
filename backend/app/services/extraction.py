"""Agent SDK extraction path with deterministic fallback.

Two paths, one contract:
- BRIDGE_DEMO_MODE=1 (default): the chunk's precomputed delta from demo_data is used.
- BRIDGE_DEMO_MODE=0: the Anthropic Agent SDK extracts a delta live; any failure
  falls back to the precomputed delta so the demo can never break.
"""

import json
import os
from pathlib import Path
from typing import Any

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "extraction.md"

EXTRACTION_MODEL = os.environ.get("BRIDGE_EXTRACTION_MODEL", "claude-haiku-4-5-20251001")


def demo_mode() -> bool:
    return os.environ.get("BRIDGE_DEMO_MODE", "1") != "0"


async def extract_delta_live(
    chunk: dict[str, Any], case_raw: dict[str, Any]
) -> dict[str, Any] | None:
    """Extract a structured delta from a transcript chunk via the Agent SDK.

    Returns None on any failure — caller falls back to the precomputed delta.
    """
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    try:
        from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, TextBlock, query

        system_prompt = PROMPT_PATH.read_text()
        payload = {
            "transcript_chunk": chunk["turns"],
            "red_flag_keys": [rf["key"] for rf in case_raw["red_flag_catalog"]],
            "pedmidas_questions": case_raw["pedmidas_questions"],
        }
        options = ClaudeAgentOptions(
            system_prompt=system_prompt,
            model=EXTRACTION_MODEL,
            max_turns=1,
            allowed_tools=[],
        )
        text = ""
        async for message in query(prompt=json.dumps(payload), options=options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        text += block.text
        text = text.strip()
        if text.startswith("```"):
            text = text.strip("`")
            text = text[text.index("{"):]
        delta = json.loads(text[text.index("{"): text.rindex("}") + 1])
        return delta if isinstance(delta, dict) else None
    except Exception:
        return None


def answer_question(question: str, case_raw: dict[str, Any]) -> dict[str, Any]:
    """Grounded Q&A against canned answers for the seeded case.

    Deterministic keyword matching keeps the demo safe; the evidence drawer
    still works because citations point at real evidence IDs.
    """
    q_lower = question.lower()
    for entry in case_raw.get("canned_qa", []):
        if any(m in q_lower for m in entry["match"]):
            return {"answer": entry["answer"], "citations": entry["citations"], "grounded": True}
    return {
        "answer": (
            "I can only answer from this patient's recorded visit and history, and I "
            "don't have grounded evidence for that question yet. Try asking about "
            "school impact, red flags, medications, or family history."
        ),
        "citations": [],
        "grounded": False,
    }
