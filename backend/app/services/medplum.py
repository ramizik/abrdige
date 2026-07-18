"""Narrow Medplum FHIR client for ByeByeHeadache.

Scope (per CLAUDE.md): case-load reads + visit-completion write-back only.
Every read must fail soft — callers fall back to the bundled JSON snapshot.
Stdlib only; 3s timeout so a Medplum hiccup can never stall the demo.
"""

import base64
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

log = logging.getLogger("bridge.medplum")

TIMEOUT_S = 3.0
IDENT_SYSTEM = "https://bridge.demo/case"
CASE_DEF_SYSTEM = IDENT_SYSTEM + "/case-def"

_token: str | None = None
_token_exp: float = 0.0


def _base_url() -> str:
    return os.getenv("MEDPLUM_BASE_URL", "https://api.medplum.com").rstrip("/")


def enabled() -> bool:
    return bool(os.getenv("MEDPLUM_CLIENT_ID") and os.getenv("MEDPLUM_CLIENT_SECRET"))


def _get_token() -> str | None:
    global _token, _token_exp
    if _token and time.time() < _token_exp - 60:
        return _token
    if not enabled():
        return None
    data = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": os.getenv("MEDPLUM_CLIENT_ID", ""),
            "client_secret": os.getenv("MEDPLUM_CLIENT_SECRET", ""),
        }
    ).encode()
    req = urllib.request.Request(f"{_base_url()}/oauth2/token", data=data, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            payload = json.loads(resp.read())
        _token = payload["access_token"]
        _token_exp = time.time() + float(payload.get("expires_in", 3600))
        return _token
    except Exception as exc:  # noqa: BLE001 — fail soft by design
        log.warning("Medplum token mint failed: %s", exc)
        return None


def fhir(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Perform one FHIR request. Returns parsed JSON or None on any failure."""
    token = _get_token()
    if token is None:
        return None
    url = f"{_base_url()}/fhir/R4/{path.lstrip('/')}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        req.add_header("Content-Type", "application/fhir+json")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            raw = resp.read()
        return json.loads(raw) if raw else {}
    except Exception as exc:  # noqa: BLE001 — fail soft by design
        log.warning("Medplum %s %s failed: %s", method, path, exc)
        return None


# ---------- case-load read ----------

def fetch_case_def(case_id: str) -> dict[str, Any] | None:
    """Fetch the full case definition JSON seeded into Medplum.

    The seed script stores each demo case verbatim as a DocumentReference
    attachment so Medplum is the source of truth for everything the agent
    consumes (history, previsit brief, transcript chunks, PedMIDAS catalog,
    care plan, canned Q&A). Returns None on any failure so the caller falls
    back to the bundled local JSON.
    """
    bundle = fhir(
        "GET",
        f"DocumentReference?identifier={CASE_DEF_SYSTEM}|{case_id}&_count=1&_sort=-date",
    )
    if not bundle or not bundle.get("entry"):
        return None
    res = bundle["entry"][0].get("resource", {})
    try:
        raw = base64.b64decode(res["content"][0]["attachment"]["data"]).decode("utf-8")
        case = json.loads(raw)
    except Exception as exc:  # noqa: BLE001 — fail soft by design
        log.warning("Medplum case-def decode failed for %s: %s", case_id, exc)
        return None
    return case if case.get("case_id") == case_id else None


def push_case_def(case_id: str, case_raw: dict[str, Any]) -> str | None:
    """Upsert the full case definition JSON into Medplum (seed-script use)."""
    resource = {
        "resourceType": "DocumentReference",
        "status": "current",
        "type": {"text": "ByeByeHeadache case definition (synthetic demo data)"},
        "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "identifier": [{"system": CASE_DEF_SYSTEM, "value": case_id}],
        "description": f"Full ByeByeHeadache case definition for {case_id}",
        "content": [
            {
                "attachment": {
                    "contentType": "application/json",
                    "data": base64.b64encode(
                        json.dumps(case_raw).encode()
                    ).decode(),
                }
            }
        ],
    }
    created = fhir(
        "PUT",
        f"DocumentReference?identifier={CASE_DEF_SYSTEM}|{case_id}",
        resource,
    )
    return created.get("id") if created else None


# ---------- visit-completion write-back ----------

def push_visit_summary(case_id: str, patient_name: str, summary_lines: list[str]) -> str | None:
    """Write the end-of-visit summary back to Medplum. Best-effort."""
    text = "\n".join(summary_lines) if summary_lines else "Visit completed."
    resource = {
        "resourceType": "DocumentReference",
        "status": "current",
        "type": {"text": "ByeByeHeadache visit summary (draft, clinician review required)"},
        "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "identifier": [{"system": IDENT_SYSTEM + "/summary", "value": case_id}],
        "description": f"ByeByeHeadache visit summary for {patient_name} ({case_id})",
        "content": [
            {
                "attachment": {
                    "contentType": "text/plain",
                    "data": base64.b64encode(text.encode()).decode(),
                }
            }
        ],
    }
    created = fhir("POST", "DocumentReference", resource)
    return created.get("id") if created else None
