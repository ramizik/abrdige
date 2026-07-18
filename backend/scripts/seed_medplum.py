"""Seed Medplum with synthetic FHIR data for ByeByeHeadache demo cases.

Builds a browsable EHR graph, not just blobs:
- one Patient per demo case (Elena / Maya / Jordan / Noah), referenced by
  every resource of that case
- one Encounter per prior-visit history entry
- vitals parsed out of the vitals notes into LOINC-coded Observations
- PedMIDAS: one shared Questionnaire + trend scores as Observations
- one DocumentReference per history note (linked to its Encounter)
- the full case definition JSON as a DocumentReference — what the backend reads

Idempotent: uses FHIR conditional update (PUT ?identifier=...) so reruns
update in place instead of duplicating. Run from backend/:

    python -m scripts.seed_medplum
"""

import base64
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from app.services import medplum  # noqa: E402

# Seeding is offline tooling — allow slower calls than the 3s demo-read budget.
medplum.TIMEOUT_S = 15.0

DEMO_DATA_DIR = Path(__file__).resolve().parent.parent / "app" / "demo_data"

SYS = medplum.IDENT_SYSTEM  # https://bridge.demo/case
PATIENT_SYS = "https://bridge.demo/patient"
MRN_SYS = "https://bridge.demo/mrn"

# Demo reference date: every case's "today" visit is 2026-07-18.
TODAY_YEAR = 2026

LOINC = "http://loinc.org"
VITAL_PATTERNS: list[tuple[str, str, str, str, str]] = [
    # (regex over note text, loinc code, display, unit, ucum)
    (r"BP (\d+)/\d+", "8480-6", "Systolic blood pressure", "mmHg", "mm[Hg]"),
    (r"BP \d+/(\d+)", "8462-4", "Diastolic blood pressure", "mmHg", "mm[Hg]"),
    (r"HR (\d+)", "8867-4", "Heart rate", "beats/min", "/min"),
    (r"T ([\d.]+)C", "8310-5", "Body temperature", "Cel", "Cel"),
    (r"Ht (\d+) cm", "8302-2", "Body height", "cm", "cm"),
    (r"Wt (\d+) kg", "29463-7", "Body weight", "kg", "kg"),
]


def upsert(resource_type: str, ident_system: str, ident_value: str, resource: dict) -> dict | None:
    resource.setdefault("identifier", []).insert(
        0, {"system": ident_system, "value": ident_value}
    )
    return medplum.fhir(
        "PUT", f"{resource_type}?identifier={ident_system}|{ident_value}", resource
    )


def seed_patient(patient: dict) -> str | None:
    parts = patient["name"].split()
    given, family = parts[:-1], parts[-1]
    # Synthetic fixed birthday (Mar 4) so the stated age is exact on 2026-07-18.
    birth_date = f"{TODAY_YEAR - patient['age']}-03-04"
    res = upsert(
        "Patient",
        PATIENT_SYS,
        patient["id"],
        {
            "resourceType": "Patient",
            "identifier": [{"system": MRN_SYS, "value": patient["mrn"].replace("MRN ", "")}],
            "name": [{"given": given, "family": family}],
            "gender": "female" if patient.get("sex") == "F" else "male",
            "birthDate": birth_date,
        },
    )
    if res is None:
        return None
    ref = f"Patient/{res['id']}"
    print(f"  Patient {patient['name']} -> {ref}")
    return ref


def seed_vitals(hx: dict, case_id: str, patient_ref: str, patient_name: str, encounter_ref: str) -> None:
    for pattern, code, display, unit, ucum in VITAL_PATTERNS:
        m = re.search(pattern, hx["text"])
        if not m:
            continue
        obs = {
            "resourceType": "Observation",
            "status": "final",
            "category": [
                {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                            "code": "vital-signs",
                        }
                    ]
                }
            ],
            "code": {"coding": [{"system": LOINC, "code": code, "display": display}], "text": display},
            "subject": {"reference": patient_ref, "display": patient_name},
            "encounter": {"reference": encounter_ref},
            "effectiveDateTime": hx["date"],
            "valueQuantity": {
                "value": float(m.group(1)),
                "unit": unit,
                "system": "http://unitsofmeasure.org",
                "code": ucum,
            },
        }
        res = upsert("Observation", SYS + "/vital", f"{case_id}:{hx['id']}:{code}", obs)
        print(f"    Observation {display} = {m.group(1)} -> {'ok' if res else 'FAILED'}")


def seed_case(raw: dict, patient_ref: str) -> None:
    case_id = raw["case_id"]
    patient_name = raw["patient"]["name"]

    for hx in raw["history"]:
        enc = upsert(
            "Encounter",
            SYS + "/enc",
            f"{case_id}:{hx['id']}",
            {
                "resourceType": "Encounter",
                "status": "finished",
                "class": {
                    "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                    "code": "AMB",
                    "display": "ambulatory",
                },
                "type": [{"text": hx["label"]}],
                "subject": {"reference": patient_ref, "display": patient_name},
                "period": {"start": hx["date"] + "T09:00:00Z"},
                "serviceProvider": {"display": raw["patient"].get("clinic", "Eastside Pediatrics")},
            },
        )
        if enc is None:
            print(f"  !! Encounter failed for {hx['id']}")
            continue
        encounter_ref = f"Encounter/{enc['id']}"
        print(f"  Encounter {hx['id']} ({hx['label']}, {hx['date']}) -> {encounter_ref}")

        doc = {
            "resourceType": "DocumentReference",
            "status": "current",
            "subject": {"reference": patient_ref, "display": patient_name},
            "context": {"encounter": [{"reference": encounter_ref}]},
            "type": {"text": hx["label"]},
            "date": hx["date"] + "T00:00:00Z",
            "description": hx["text"][:120],
            "content": [
                {
                    "attachment": {
                        "contentType": "text/plain",
                        "title": hx["label"],
                        "data": base64.b64encode(hx["text"].encode()).decode(),
                    }
                }
            ],
        }
        res = upsert("DocumentReference", SYS + "/hx", f"{case_id}:{hx['id']}", doc)
        print(f"    note -> {'ok' if res else 'FAILED'}")

        if "Vitals" in hx["label"]:
            seed_vitals(hx, case_id, patient_ref, patient_name, encounter_ref)

    # PedMIDAS trend points (follow-up cases) as scored Observations
    trend = raw.get("precomputed_state", {}).get("pedmidas_trend", [])
    for point in trend:
        obs = {
            "resourceType": "Observation",
            "status": "final",
            "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "survey"}]}],
            "code": {"text": "PedMIDAS total score"},
            "subject": {"reference": patient_ref, "display": patient_name},
            "effectiveDateTime": point["date"],
            "valueQuantity": {"value": point["score"], "unit": "score"},
        }
        res = upsert("Observation", SYS + "/pedmidas-score", f"{case_id}:{point['date']}", obs)
        print(f"  PedMIDAS score {point['score']} ({point['date']}) -> {'ok' if res else 'FAILED'}")

    # Full case definition: the single source of truth the backend reads at
    # case load (history, previsit brief, chunks, catalogs, care plan, Q&A).
    doc_id = medplum.push_case_def(case_id, raw)
    print(f"  case definition -> {'DocumentReference/' + doc_id if doc_id else 'FAILED'}")


def seed_questionnaire(raw: dict) -> None:
    res = upsert(
        "Questionnaire",
        SYS + "/questionnaire",
        "pedmidas",
        {
            "resourceType": "Questionnaire",
            "status": "active",
            "title": "PedMIDAS (Pediatric Migraine Disability Assessment)",
            "item": [
                {"linkId": q["question_id"], "text": q["question"], "type": "integer"}
                for q in raw["pedmidas_questions"]
            ],
        },
    )
    print(f"  PedMIDAS Questionnaire -> {'ok' if res else 'FAILED'}")


def cleanup_legacy() -> None:
    """Remove resources from earlier seeding schemes (shared Maya R. patient etc.)."""
    for case_id in ("case-a", "case-b"):
        medplum.fhir("DELETE", f"Patient?identifier={SYS}|{case_id}")
        medplum.fhir("DELETE", f"Questionnaire?identifier={SYS}/pedmidas|{case_id}")
    # Old single shared patient ("Maya R.", pt-001) from the 2-case scheme.
    medplum.fhir("DELETE", f"Patient?identifier={PATIENT_SYS}|pt-001")
    print("Legacy patients/questionnaires removed.")


def main() -> None:
    if not medplum.enabled():
        sys.exit("MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET not set")
    cleanup_legacy()
    cases = [json.loads(p.read_text()) for p in sorted(DEMO_DATA_DIR.glob("case_*.json"))]
    seed_questionnaire(cases[0])
    for raw in cases:
        print(f"Seeding {raw['case_id']} — {raw['title']}")
        patient_ref = seed_patient(raw["patient"])
        if patient_ref is None:
            sys.exit(f"Patient upsert failed for {raw['case_id']}")
        seed_case(raw, patient_ref)
    print("Done.")


if __name__ == "__main__":
    main()
