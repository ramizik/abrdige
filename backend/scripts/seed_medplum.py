"""Seed Medplum with synthetic FHIR data for Bridge demo cases.

Idempotent: uses FHIR conditional update (PUT ?identifier=...) so reruns
update in place instead of duplicating. Run from backend/:

    python -m scripts.seed_medplum
"""

import base64
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from app.services import medplum  # noqa: E402

DEMO_DATA_DIR = Path(__file__).resolve().parent.parent / "app" / "demo_data"


def seed_case(raw: dict) -> None:
    case_id = raw["case_id"]
    patient = raw["patient"]
    family, given = (patient["name"].rsplit(" ", 1) + [""])[:2][::-1]
    patient_resource = {
        "resourceType": "Patient",
        "identifier": [{"system": medplum.IDENT_SYSTEM, "value": case_id}],
        "name": [{"given": [given or patient["name"]], "family": family}],
        "gender": "female" if patient.get("sex") == "F" else "male",
    }
    res = medplum.fhir(
        "PUT",
        f"Patient?identifier={medplum.IDENT_SYSTEM}|{case_id}",
        patient_resource,
    )
    if res is None:
        print(f"  !! Patient upsert failed for {case_id}")
        return
    patient_ref = f"Patient/{res['id']}"
    print(f"  Patient {patient['name']} -> {patient_ref}")

    for hx in raw["history"]:
        doc = {
            "resourceType": "DocumentReference",
            "status": "current",
            "subject": {"reference": patient_ref},
            "type": {"text": hx["label"]},
            "date": hx["date"] + "T00:00:00Z",
            "identifier": [
                {"system": medplum.IDENT_SYSTEM, "value": case_id},
                {"system": medplum.IDENT_SYSTEM + "/hx", "value": f"{case_id}:{hx['id']}"},
            ],
            "content": [
                {
                    "attachment": {
                        "contentType": "text/plain",
                        "data": base64.b64encode(hx["text"].encode()).decode(),
                    }
                }
            ],
        }
        res = medplum.fhir(
            "PUT",
            f"DocumentReference?identifier={medplum.IDENT_SYSTEM}/hx|{case_id}:{hx['id']}",
            doc,
        )
        print(f"  {hx['id']} ({hx['label']}) -> {'ok' if res else 'FAILED'}")

    questionnaire = {
        "resourceType": "Questionnaire",
        "status": "active",
        "title": "PedMIDAS (Pediatric Migraine Disability Assessment)",
        "identifier": [
            {"system": medplum.IDENT_SYSTEM + "/pedmidas", "value": case_id}
        ],
        "item": [
            {"linkId": q["question_id"], "text": q["question"], "type": "integer"}
            for q in raw["pedmidas_questions"]
        ],
    }
    res = medplum.fhir(
        "PUT",
        f"Questionnaire?identifier={medplum.IDENT_SYSTEM}/pedmidas|{case_id}",
        questionnaire,
    )
    print(f"  PedMIDAS Questionnaire -> {'ok' if res else 'FAILED'}")

    # Full case definition: the single source of truth the backend reads at
    # case load (history, previsit brief, chunks, catalogs, care plan, Q&A).
    doc_id = medplum.push_case_def(case_id, raw)
    print(f"  case definition -> {'DocumentReference/' + doc_id if doc_id else 'FAILED'}")


def main() -> None:
    if not medplum.enabled():
        sys.exit("MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET not set")
    for path in sorted(DEMO_DATA_DIR.glob("case_*.json")):
        raw = json.loads(path.read_text())
        print(f"Seeding {raw['case_id']} — {raw['title']}")
        seed_case(raw)
    print("Done.")


if __name__ == "__main__":
    main()
