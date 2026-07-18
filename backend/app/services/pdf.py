"""End-of-visit PDF generation from structured visit state (reportlab)."""

from io import BytesIO

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from ..models import VisitState

TEAL = "#0f766e"
SLATE = "#334155"


def build_visit_pdf(state: VisitState) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter, topMargin=0.7 * inch, bottomMargin=0.7 * inch
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], textColor=TEAL, fontSize=16)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=SLATE, fontSize=12)
    body = ParagraphStyle("body", parent=styles["BodyText"], fontSize=9.5, leading=13)
    small = ParagraphStyle("small", parent=body, fontSize=8, textColor="#64748b")

    story = []
    p = state.patient
    story.append(Paragraph("ByeByeHeadache — Visit Summary (Draft for Clinician Review)", h1))
    story.append(
        Paragraph(
            f"{p.name} · {p.age} y/o {p.sex} · {p.clinic} · "
            f"{'First visit' if state.mode == 'first_visit' else 'Follow-up visit'}",
            body,
        )
    )
    story.append(Spacer(1, 10))

    story.append(Paragraph("Headache Profile", h2))
    prof = state.profile
    rows = [
        ("Onset", prof.onset.value),
        ("Frequency", f"{prof.frequency_days_per_month.value} days/month"
         if prof.frequency_days_per_month.value is not None else None),
        ("Severe attacks", f"{prof.severe_attacks_per_month.value:.0f}/month"
         if prof.severe_attacks_per_month.value is not None else None),
        ("Episode duration", prof.episode_duration.value),
        ("Progression", prof.progression.value),
        ("Location", prof.location.value),
        ("Quality", prof.quality.value),
        ("Severity", prof.severity.value),
        ("Worse with activity", prof.activity_worsening.value),
        ("Associated symptoms", ", ".join(prof.associated_symptoms.value) or None),
        ("Aura", prof.aura.value),
        ("Aura duration", prof.aura_duration.value),
        ("Triggers (needs confirmation)" if prof.triggers.status == "needs_confirmation"
         else "Triggers", ", ".join(prof.triggers.value) or None),
        ("Relievers", ", ".join(prof.relievers.value) or None),
        ("Habits", ", ".join(prof.habits.value) or None),
        ("Headache diary kept", prof.diary_available.value),
        ("Family history", prof.family_history.value),
        ("Acute medication use", ", ".join(prof.acute_medication_use.value) or None),
        ("Preventive medication",
         ", ".join(prof.preventive_medication_use.value)
         if prof.preventive_medication_use.value
         else ("None" if prof.preventive_medication_use.status == "negative" else None)),
        ("Treatment response", prof.treatment_response.value),
        ("Medication overuse risk", prof.medication_overuse_risk.value),
        ("Non-medical interventions", ", ".join(prof.non_medical_interventions.value) or None),
        ("School impact", prof.school_impact.value),
        ("Sports/activity impact", prof.activity_impact.value),
        ("Repeat PCP/ED visits", prof.repeat_visits.value),
        ("Daily-life interference", prof.headache_interference.value),
    ]
    for label, value in rows:
        story.append(Paragraph(f"<b>{label}:</b> {value if value else 'Unknown / not captured'}", body))
    story.append(Spacer(1, 8))

    exam = state.exam
    exam_rows = [
        ("General appearance", exam.general_appearance.value),
        ("Neuro exam", ", ".join(exam.neuro_exam.value) or None),
        ("Funduscopic", exam.funduscopic.value),
    ]
    if any(v for _, v in exam_rows):
        story.append(Paragraph("Exam Snapshot (clinician-reported)", h2))
        for label, value in exam_rows:
            story.append(Paragraph(f"<b>{label}:</b> {value if value else 'Not documented'}", body))
        story.append(Spacer(1, 8))

    ca = state.clinician_assessment
    if ca.impression.value or ca.tentative_classification.value or ca.plan_selections.value:
        story.append(Paragraph("PCP Impression & Plan (clinician-stated)", h2))
        ca_rows = [
            ("Impression", ca.impression.value),
            ("Concern level today", ca.concern_level.value),
            ("Tentative classification", ca.tentative_classification.value),
            ("Plan selected", ", ".join(ca.plan_selections.value) or None),
        ]
        for label, value in ca_rows:
            story.append(Paragraph(f"<b>{label}:</b> {value if value else '—'}", body))
        story.append(Spacer(1, 8))

    story.append(Paragraph("PedMIDAS", h2))
    pm = state.pedmidas
    if pm.completion == "complete":
        story.append(Paragraph(f"<b>Score: {pm.score:.0f}</b> (complete, 6/6 items)", body))
    else:
        story.append(Paragraph(f"Capture {pm.completion}: {6 - len(pm.missing_question_ids)}/6 items", body))
    for r in pm.responses:
        story.append(Paragraph(f"• {r.question}: {r.value:.0f}" if r.value is not None else f"• {r.question}: —", body))
    story.append(Spacer(1, 8))

    if state.emr_summary and state.emr_summary.items:
        story.append(Paragraph("Chart Summary (agent-extracted from EMR)", h2))
        for item in state.emr_summary.items:
            flag = f" — <i>{item.flag}</i>" if item.flag else ""
            detail = f": {item.detail}" if item.detail else ""
            story.append(Paragraph(f"• <b>{item.label}</b>{detail}{flag}", body))
        story.append(Spacer(1, 8))

    story.append(Paragraph("Red-Flag Screen", h2))
    for rf in state.red_flags:
        story.append(Paragraph(f"• {rf.label}: <b>{rf.status}</b>", body))
    story.append(Spacer(1, 8))

    if state.diary.days:
        story.append(Paragraph("Headache Diary (patient-reported draft)", h2))
        story.append(
            Paragraph(
                f"{len(state.diary.days)} headache days reported over the last 30 days "
                "(intensity per patient/parent report; unconfirmed).",
                body,
            )
        )
        story.append(Spacer(1, 8))

    if state.care_plan:
        cp = state.care_plan
        story.append(Paragraph("Visit Summary (evidence-linked)", h2))
        for line in cp.summary:
            story.append(Paragraph(f"• {line}", body))
        story.append(Spacer(1, 6))
        story.append(Paragraph("Draft Next Steps — Clinician Review Required", h2))
        for line in cp.suggested_pathway:
            story.append(Paragraph(f"• {line}", body))
        if cp.referral_considerations:
            story.append(Spacer(1, 6))
            story.append(Paragraph("Referral / Escalation Considerations", h2))
            for line in cp.referral_considerations:
                story.append(Paragraph(f"• {line}", body))
        story.append(Spacer(1, 6))
        story.append(Paragraph("Family Instructions (draft)", h2))
        for line in cp.patient_instructions:
            story.append(Paragraph(f"• {line}", body))
        story.append(Spacer(1, 10))
        story.append(Paragraph(cp.disclaimer, small))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Generated by ByeByeHeadache from synthetic demo data. Not for clinical use.", small
        )
    )

    doc.build(story)
    return buf.getvalue()
