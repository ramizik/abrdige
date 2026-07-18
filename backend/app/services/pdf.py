"""End-of-visit PDF generation from structured visit state (reportlab).

Two audiences, two documents:
- ``doctor``  — clinical visit summary: KPI strip, structured profile,
  red-flag screen, PedMIDAS trend, diary heatmap, EMR summary, decision
  support, clinician-review plan.
- ``patient`` — family action plan: plain-language summary, checklist,
  diary heatmap, PedMIDAS explained, warning signs, follow-up.

Visuals mirror the frontend dashboard (trend chart with intervention
marker, 30-day heatmap, tone colors).
"""

from __future__ import annotations

import re
from io import BytesIO
from typing import Literal

from reportlab.graphics.shapes import Circle, Drawing, Line, PolyLine, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from ..models import VisitState

Audience = Literal["doctor", "patient"]

# --- palette (mirrors frontend tones) ---
PRIMARY = colors.HexColor("#1899BE")      # cyan
PRIMARY_SOFT = colors.HexColor("#E4F4FA")
PRIMARY_BORDER = colors.HexColor("#9FD4E6")
VIOLET = colors.HexColor("#7C3AED")
AMBER = colors.HexColor("#B45309")
AMBER_SOFT = colors.HexColor("#FDF3D7")
RED = colors.HexColor("#C2410B")
RED_SOFT = colors.HexColor("#FBE9E0")
INK = colors.HexColor("#22314A")
INK_2 = colors.HexColor("#44506B")
MUTED = colors.HexColor("#66748C")
BORDER = colors.HexColor("#DDE4EE")
SURFACE_2 = colors.HexColor("#F4F7FB")
HEAT = [colors.HexColor("#EDF1F6"), colors.HexColor("#BFDCD3"),
        colors.HexColor("#67A89A"), PRIMARY]

PAGE_W, PAGE_H = letter
MARGIN = 0.65 * inch
CONTENT_W = PAGE_W - 2 * MARGIN

_EV_SUFFIX = re.compile(r"\s*\[[^\]]*\]\s*$")


def _plain(line: str) -> str:
    """Strip trailing evidence-id suffixes like '[ev-1, ev-2]'."""
    return _EV_SUFFIX.sub("", line).strip()


def _styles():
    base = getSampleStyleSheet()
    body = ParagraphStyle("bbody", parent=base["BodyText"], fontSize=9.5,
                          leading=13.5, textColor=INK)
    return {
        "h2": ParagraphStyle("bh2", parent=base["Heading2"], fontSize=11.5,
                             textColor=INK, spaceBefore=10, spaceAfter=4),
        "eyebrow": ParagraphStyle("beyebrow", parent=body, fontSize=7.5,
                                  textColor=MUTED, spaceBefore=8, spaceAfter=2),
        "body": body,
        "big": ParagraphStyle("bbig", parent=body, fontSize=11, leading=15),
        "small": ParagraphStyle("bsmall", parent=body, fontSize=8,
                                leading=11, textColor=MUTED),
        "cell_label": ParagraphStyle("bcl", parent=body, fontSize=8,
                                     textColor=MUTED),
        "cell_value": ParagraphStyle("bcv", parent=body, fontSize=9.5,
                                     leading=12.5),
    }


# ---------------------------------------------------------------- drawings

def _pedmidas_band(score: float | None) -> tuple[str, colors.Color]:
    if score is None:
        return "not yet scored", MUTED
    if score <= 10:
        return "little to no disability", PRIMARY
    if score <= 30:
        return "mild disability", PRIMARY
    if score <= 50:
        return "moderate disability", AMBER
    return "severe disability", RED


def pedmidas_gauge(score: float | None, width: float = CONTENT_W) -> Drawing:
    """Horizontal severity gauge with grading bands and a score marker."""
    h = 44
    d = Drawing(width, h)
    bands = [(0, 10, "0–10 · little/none"), (10, 30, "11–30 · mild"),
             (30, 50, "31–50 · moderate"), (50, 70, ">50 · severe")]
    band_colors = [PRIMARY_SOFT, colors.HexColor("#D3ECF5"), AMBER_SOFT, RED_SOFT]
    x0, bar_w, bar_y, bar_h = 0, width, 16, 12
    span = 70.0
    for (lo, hi, label), bc in zip(bands, band_colors):
        bx = x0 + bar_w * lo / span
        bw = bar_w * (hi - lo) / span
        d.add(Rect(bx, bar_y, bw, bar_h, fillColor=bc, strokeColor=colors.white,
                   strokeWidth=1))
        d.add(String(bx + 3, bar_y - 9, label, fontName="Helvetica",
                     fontSize=6.5, fillColor=MUTED))
    if score is not None:
        sx = x0 + bar_w * min(score, span) / span
        _, tone = _pedmidas_band(score)
        d.add(Line(sx, bar_y - 3, sx, bar_y + bar_h + 3, strokeColor=tone,
                   strokeWidth=2))
        d.add(String(min(max(sx - 8, 0), width - 30), bar_y + bar_h + 6,
                     f"{score:.0f}", fontName="Helvetica-Bold", fontSize=10,
                     fillColor=tone))
    return d


def pedmidas_trend(state: VisitState, width: float = CONTENT_W) -> Drawing | None:
    """Line chart mirroring the dashboard: grid, labeled points, dashed
    intervention marker."""
    points = state.pedmidas_trend
    if len(points) < 2:
        return None
    h = 150
    d = Drawing(width, h)
    max_score = max(50.0, *(p.score for p in points))
    left, right, bottom, top = 34, width - 12, 26, h - 16
    ys = lambda s: bottom + (top - bottom) * (s / max_score)  # noqa: E731
    xs = lambda i: left + (right - left) * (i / (len(points) - 1))  # noqa: E731
    for frac, label in ((0, "0"), (0.5, f"{max_score / 2:.0f}"), (1, f"{max_score:.0f}")):
        y = bottom + (top - bottom) * frac
        d.add(Line(left - 4, y, right, y, strokeColor=BORDER, strokeWidth=0.7))
        d.add(String(left - 8, y - 2.5, label, fontName="Helvetica", fontSize=7,
                     fillColor=MUTED, textAnchor="end"))
    improving = points[-1].score < points[0].score
    tone = PRIMARY if improving else AMBER
    if state.medication_events:
        ev = state.medication_events[0]
        ex = left + (right - left) * 0.22
        d.add(Line(ex, bottom, ex, top + 6, strokeColor=MUTED, strokeWidth=0.8,
                   strokeDashArray=[3, 3]))
        d.add(String(ex + 4, top + 2, f"{ev.label} · {ev.date}",
                     fontName="Helvetica", fontSize=7, fillColor=INK_2))
    d.add(PolyLine([c for i, p in enumerate(points) for c in (xs(i), ys(p.score))],
                   strokeColor=tone, strokeWidth=2, strokeLineJoin=1))
    for i, p in enumerate(points):
        x, y = xs(i), ys(p.score)
        d.add(Circle(x, y, 3.5, fillColor=colors.white, strokeColor=tone,
                     strokeWidth=2))
        d.add(String(x, y + 7, f"{p.score:.0f}", fontName="Helvetica-Bold",
                     fontSize=8.5, fillColor=INK, textAnchor="middle"))
        d.add(String(x, bottom - 12, p.date, fontName="Helvetica", fontSize=7,
                     fillColor=MUTED, textAnchor="middle"))
    return d


def diary_heatmap(state: VisitState, width: float = CONTENT_W) -> Drawing | None:
    """30-day intensity grid (10 x 3), oldest to most recent, with legend."""
    if not state.diary.days:
        return None
    by_day = {dd.day: (dd.intensity or 0) for dd in state.diary.days}
    cells = [by_day.get(i + 1, 0) for i in range(30)]
    cols, rows = 10, 3
    gap = 3
    cell = min((width - (cols - 1) * gap) / cols, 18)
    grid_w = cols * cell + (cols - 1) * gap
    h = rows * cell + (rows - 1) * gap + 18
    d = Drawing(width, h)
    for i, v in enumerate(cells):
        r, c = divmod(i, cols)
        x = c * (cell + gap)
        y = h - 18 - (r + 1) * cell - r * gap
        d.add(Rect(x, y, cell, cell, rx=2, ry=2, fillColor=HEAT[min(v, 3)],
                   strokeColor=None))
    lx = 0
    d.add(String(lx, 2, "none", fontName="Helvetica", fontSize=6.5, fillColor=MUTED))
    lx += 22
    for hc in HEAT:
        d.add(Rect(lx, 0, 8, 8, rx=1.5, ry=1.5, fillColor=hc, strokeColor=None))
        lx += 11
    d.add(String(lx + 2, 2, "severe", fontName="Helvetica", fontSize=6.5,
                 fillColor=MUTED))
    d.add(String(grid_w, 2, "oldest → most recent", fontName="Helvetica",
                 fontSize=6.5, fillColor=MUTED, textAnchor="end"))
    return d


def _status_dot(color: colors.Color) -> Drawing:
    d = Drawing(10, 8)
    d.add(Circle(4, 4, 3.4, fillColor=color, strokeColor=None))
    return d


# ---------------------------------------------------------------- shared blocks

def _kpi_strip(tiles: list[tuple[str, str, str, colors.Color]], st) -> Table:
    """Row of KPI tiles: (label, value, sub, tone)."""
    cells = []
    for label, value, sub, tone in tiles:
        cells.append([
            Paragraph(f'<font size="7" color="{tone.hexval()}"><b>{label.upper()}</b></font>', st["cell_label"]),
            Paragraph(f'<font size="15" color="{tone.hexval()}"><b>{value}</b></font>', st["cell_value"]),
            Paragraph(f'<font size="7">{sub}</font>', st["cell_label"]),
        ])
    n = len(cells)
    t = Table([[c for c in cells]], colWidths=[CONTENT_W / n] * n)
    inner = []
    for i, (_, _, _, tone) in enumerate(tiles):
        soft = {PRIMARY: PRIMARY_SOFT, AMBER: AMBER_SOFT, RED: RED_SOFT}.get(tone, SURFACE_2)
        inner.append(("BACKGROUND", (i, 0), (i, 0), soft))
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBEFORE", (1, 0), (-1, 0), 4, colors.white),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
        *inner,
    ]))
    return t


def _section(title: str, st) -> list:
    return [
        Spacer(1, 10),
        Paragraph(f'<font color="{MUTED.hexval()}" size="7.5"><b>{title.upper()}</b></font>', st["eyebrow"]),
        HRFlowable(width="100%", thickness=0.7, color=BORDER, spaceAfter=5),
    ]


def _page_frame(title: str, subtitle: str, accent: colors.Color):
    def draw(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(accent)
        canvas.rect(0, PAGE_H - 0.42 * inch, PAGE_W, 0.42 * inch, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 11)
        canvas.drawString(MARGIN, PAGE_H - 0.29 * inch, title)
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 0.29 * inch, subtitle)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(MARGIN, 0.4 * inch,
                          "Generated by ByeByeHeadache from synthetic demo data — not for clinical use.")
        canvas.drawRightString(PAGE_W - MARGIN, 0.4 * inch, f"page {doc.page}")
        canvas.restoreState()
    return draw


def _build(story, title: str, subtitle: str, accent: colors.Color) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.75 * inch,
                            bottomMargin=0.75 * inch, leftMargin=MARGIN,
                            rightMargin=MARGIN)
    frame = _page_frame(title, subtitle, accent)
    doc.build(story, onFirstPage=frame, onLaterPages=frame)
    return buf.getvalue()


def _flags_present(state: VisitState) -> list:
    return [rf for rf in state.red_flags if rf.status == "present"]


# ---------------------------------------------------------------- doctor PDF

def build_doctor_pdf(state: VisitState) -> bytes:
    st = _styles()
    p = state.patient
    prof = state.profile
    story: list = []

    story.append(Paragraph(
        f"<b>{p.name}</b> · {p.age} y/o {p.sex} · {p.mrn} · {p.clinic}", st["big"]))
    story.append(Paragraph(
        f"{'First headache visit' if state.mode == 'first_visit' else 'Follow-up visit'}"
        f" · {p.provider} · {p.visit_length} · chief complaint: {p.chief_complaint}",
        st["small"]))
    story.append(Spacer(1, 8))

    # KPI strip
    flags = len(_flags_present(state))
    freq = (f"{prof.frequency_days_per_month.value:.0f}"
            if prof.frequency_days_per_month.value is not None else "—")
    score = state.pedmidas.score
    trend_last = state.pedmidas_trend[-1].score if state.pedmidas_trend else None
    shown = score if score is not None else trend_last
    band, band_tone = _pedmidas_band(shown)
    diary_days = sum(1 for dd in state.diary.days if (dd.intensity or 0) > 0)
    story.append(_kpi_strip([
        ("HA days/mo", freq, "reported frequency", PRIMARY),
        ("PedMIDAS", f"{shown:.0f}" if shown is not None else "—", band, band_tone),
        ("Red flags", str(flags), "present on screen" if flags else "none present",
         RED if flags else PRIMARY),
        ("Diary days/30", str(diary_days) if state.diary.days else "—",
         "patient-reported draft", PRIMARY),
    ], st))

    # Red-flag alert banner
    if flags:
        story.append(Spacer(1, 6))
        alert = Table([[Paragraph(
            f'<font color="{RED.hexval()}"><b>Escalation review required</b> — '
            + " · ".join(rf.label for rf in _flags_present(state)) + "</font>",
            st["body"])]], colWidths=[CONTENT_W])
        alert.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), RED_SOFT),
            ("BOX", (0, 0), (-1, -1), 0.8, RED),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(alert)

    # Headache profile — two-column grid
    story.extend(_section("Headache profile (intake capture, evidence-linked)", st))

    def fact_val(fact) -> tuple[str, bool]:
        v = fact.value
        if isinstance(v, list):
            v = ", ".join(v) if v else None
        if v is None or v == "":
            if fact.status == "negative":
                return "None reported", True
            return "unknown / not captured", False
        return str(v), True

    profile_rows = [
        ("Onset", prof.onset), ("Frequency (d/mo)", prof.frequency_days_per_month),
        ("Episode duration", prof.episode_duration), ("Progression", prof.progression),
        ("Location", prof.location), ("Quality", prof.quality),
        ("Severity", prof.severity), ("Worse with activity", prof.activity_worsening),
        ("Associated symptoms", prof.associated_symptoms), ("Aura", prof.aura),
        ("Triggers", prof.triggers), ("Habits / lifestyle", prof.habits),
        ("Acute medication use", prof.acute_medication_use),
        ("Preventive medication", prof.preventive_medication_use),
        ("Treatment response", prof.treatment_response),
        ("Medication-overuse risk", prof.medication_overuse_risk),
        ("School impact", prof.school_impact), ("Activity impact", prof.activity_impact),
        ("Repeat visits", prof.repeat_visits), ("Family history", prof.family_history),
    ]
    grid = []
    for i in range(0, len(profile_rows), 2):
        row = []
        for label, fact in profile_rows[i:i + 2]:
            text, known = fact_val(fact)
            color = INK.hexval() if known else MUTED.hexval()
            row.append(Paragraph(
                f'<font size="7" color="{MUTED.hexval()}">{label.upper()}</font><br/>'
                f'<font size="9" color="{color}"><b>{text}</b></font>', st["cell_value"]))
        while len(row) < 2:
            row.append("")
        grid.append(row)
    pt = Table(grid, colWidths=[CONTENT_W / 2] * 2)
    pt.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, BORDER),
    ]))
    story.append(pt)

    # Red-flag screen — full catalog with colored status
    story.extend(_section("Red-flag screen · 14-item catalog", st))
    half = (len(state.red_flags) + 1) // 2
    columns = [state.red_flags[:half], state.red_flags[half:]]
    rf_rows = []
    for i in range(half):
        row = []
        for col in columns:
            if i < len(col):
                rf = col[i]
                tone, label = {
                    "present": (RED, "FLAG"),
                    "absent": (PRIMARY, "clear"),
                }.get(rf.status, (MUTED, "not asked"))
                row.extend([
                    _status_dot(tone),
                    Paragraph(rf.label, st["body"]),
                    Paragraph(f'<font color="{tone.hexval()}" size="7.5"><b>{label}</b></font>', st["body"]),
                ])
            else:
                row.extend(["", "", ""])
        rf_rows.append(row)
    w = CONTENT_W / 2
    rft = Table(rf_rows, colWidths=[14, w - 58, 44, 14, w - 58, 44])
    rft.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]))
    story.append(rft)

    # PedMIDAS
    story.extend(_section("PedMIDAS disability", st))
    pm = state.pedmidas
    if pm.completion == "complete" and pm.score is not None:
        story.append(Paragraph(
            f"Score <b>{pm.score:.0f}</b> — {_pedmidas_band(pm.score)[0]} (6/6 items captured this visit).",
            st["body"]))
    else:
        story.append(Paragraph(
            f"Capture {pm.completion.replace('_', ' ')}: "
            f"{6 - len(pm.missing_question_ids)}/6 items — score withheld until complete.",
            st["body"]))
    if pm.responses:
        resp_rows = [[Paragraph(r.question, st["body"]),
                      Paragraph(f"<b>{r.value:.0f} days</b>" if r.value is not None else "—", st["body"])]
                     for r in pm.responses]
        rt = Table(resp_rows, colWidths=[CONTENT_W - 70, 70])
        rt.setStyle(TableStyle([
            ("LINEBELOW", (0, 0), (-1, -2), 0.5, BORDER),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ]))
        story.append(rt)
    trend = pedmidas_trend(state)
    if trend:
        story.append(Spacer(1, 6))
        story.append(trend)

    # Diary heatmap
    heat = diary_heatmap(state)
    if heat:
        story.extend(_section("Headache diary · last 30 days (patient-reported draft)", st))
        story.append(heat)

    # Changes since last visit (follow-up)
    if state.changes_since_last_visit:
        story.extend(_section("Changes since last visit", st))
        for line in state.changes_since_last_visit:
            story.append(Paragraph(f"• {_plain(line)}", st["body"]))

    # EMR summary
    if state.emr_summary and state.emr_summary.items:
        story.extend(_section("Chart summary (agent-extracted from EMR)", st))
        for item in state.emr_summary.items:
            flag = (f' — <font color="{AMBER.hexval()}"><i>{item.flag}</i></font>'
                    if item.flag else "")
            detail = f": {item.detail}" if item.detail else ""
            story.append(Paragraph(f"• <b>{item.label}</b>{detail}{flag}", st["body"]))

    # Exam + clinician assessment
    exam_rows = [("General appearance", state.exam.general_appearance.value),
                 ("Neuro exam", ", ".join(state.exam.neuro_exam.value) or None),
                 ("Funduscopic", state.exam.funduscopic.value)]
    if any(v for _, v in exam_rows):
        story.extend(_section("Exam snapshot (clinician-reported)", st))
        for label, value in exam_rows:
            story.append(Paragraph(f"<b>{label}:</b> {value or 'not documented'}", st["body"]))
    ca = state.clinician_assessment
    if ca.impression.value or ca.tentative_classification.value or ca.plan_selections.value:
        story.extend(_section("PCP impression & plan (clinician-stated)", st))
        for label, value in [("Impression", ca.impression.value),
                             ("Concern level", ca.concern_level.value),
                             ("Tentative classification", ca.tentative_classification.value),
                             ("Plan selected", ", ".join(ca.plan_selections.value) or None)]:
            story.append(Paragraph(f"<b>{label}:</b> {value or '—'}", st["body"]))

    # Decision support
    if state.insights and state.insights.dxs:
        story.extend(_section("Decision support · guideline-linked (clinician confirms)", st))
        if state.insights.note:
            story.append(Paragraph(f"<i>{state.insights.note}</i>", st["small"]))
            story.append(Spacer(1, 3))
        for dx in state.insights.dxs:
            met = {"met": "✓", "partial": "±", "unmet": "—"}
            crits = "; ".join(f"{met[c.met]} {c.text}" for c in dx.criteria)
            story.append(Paragraph(
                f"• <b>{dx.dx}</b> ({dx.confidence * 100:.0f}%, {dx.guideline}) — {crits}",
                st["body"]))
        for tx in state.insights.txs:
            story.append(Paragraph(
                f"• <b>{tx.step}:</b> {tx.rec} <font size='7.5' color='{MUTED.hexval()}'>"
                f"({tx.evidence})</font>", st["body"]))

    # Care plan
    if state.care_plan:
        cp = state.care_plan
        story.extend(_section("Visit summary (evidence-linked)", st))
        for line in cp.summary:
            story.append(Paragraph(f"• {_plain(line)}", st["body"]))
        story.extend(_section("Draft next steps — clinician review required", st))
        for line in cp.suggested_pathway:
            story.append(Paragraph(f"• {line}", st["body"]))
        if cp.referral_considerations:
            story.extend(_section("Referral / escalation considerations", st))
            for line in cp.referral_considerations:
                story.append(Paragraph(f"• {line}", st["body"]))
        story.append(Spacer(1, 8))
        story.append(Paragraph(cp.disclaimer, st["small"]))

    return _build(story, "ByeByeHeadache · Clinical Visit Summary",
                  "draft — clinician review required", PRIMARY)


# ---------------------------------------------------------------- patient PDF

def build_patient_pdf(state: VisitState) -> bytes:
    st = _styles()
    p = state.patient
    first = p.name.split()[0]
    cp = state.care_plan
    story: list = []

    story.append(Paragraph(f"<b>Headache Action Plan for {first}</b>", ParagraphStyle(
        "title", parent=st["big"], fontSize=15, leading=19, textColor=INK)))
    story.append(Paragraph(
        f"{p.name} · {p.age} years old · visit with {p.provider} at {p.clinic}",
        st["small"]))
    story.append(Spacer(1, 6))

    # What we talked about
    story.extend(_section("What we talked about today", st))
    summary_lines = [_plain(line) for line in (cp.summary if cp else [])]
    if not summary_lines:
        summary_lines = ["Your care team reviewed the headache story you shared today."]
    for line in summary_lines:
        story.append(Paragraph(f"• {line}", st["big"]))

    # Action plan checklist
    instructions = (cp.patient_instructions if cp else [])
    if instructions:
        story.extend(_section("Your action plan", st))
        rows = []
        for i, line in enumerate(instructions, 1):
            box = Drawing(14, 12)
            box.add(Rect(1, 0, 11, 11, rx=2, ry=2, fillColor=colors.white,
                         strokeColor=PRIMARY, strokeWidth=1.2))
            rows.append([box, Paragraph(f"<b>{i}.</b> {line}", st["big"])])
        t = Table(rows, colWidths=[20, CONTENT_W - 20])
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(t)

    # Medicines mentioned today
    meds = state.profile.acute_medication_use.value + state.profile.preventive_medication_use.value
    if meds:
        story.extend(_section("Medicines we talked about", st))
        for m in meds:
            story.append(Paragraph(f"• {m}", st["big"]))
        story.append(Paragraph(
            "Only use medicines the way your doctor explained. Using headache "
            "medicine more than 2–3 days a week can make headaches worse — "
            "keep track in the diary.", st["small"]))

    # Headache score, explained
    score = state.pedmidas.score
    trend_last = state.pedmidas_trend[-1].score if state.pedmidas_trend else None
    shown = score if score is not None else trend_last
    if shown is not None:
        story.extend(_section(f"{first}'s headache impact score (PedMIDAS)", st))
        band, _ = _pedmidas_band(shown)
        story.append(Paragraph(
            f"Today's score is <b>{shown:.0f}</b> — that means <b>{band}</b>. "
            "This score counts how many days headaches got in the way of school, "
            "home, and fun. Tracking it shows whether things are getting better.",
            st["big"]))
        story.append(Spacer(1, 4))
        story.append(pedmidas_gauge(shown))
        trend = pedmidas_trend(state)
        if trend:
            story.append(Spacer(1, 2))
            story.append(Paragraph("How the score has changed:", st["small"]))
            story.append(trend)

    # Diary
    heat = diary_heatmap(state)
    if heat:
        story.extend(_section(f"{first}'s headache days · last 30 days", st))
        story.append(Paragraph(
            "Each square is one day — darker means a stronger headache. "
            "Keep filling in the diary every day; bring it to the next visit.",
            st["body"]))
        story.append(Spacer(1, 4))
        story.append(heat)

    # Warning signs
    story.extend(_section("When to call the clinic right away", st))
    warn = [
        "A sudden, very severe headache — the worst ever",
        "Headache that wakes them from sleep, or vomiting first thing in the morning",
        "New problems with vision, speech, balance, or weakness/numbness",
        "Fever with a stiff neck, or a seizure",
        "Headaches that keep getting worse week after week",
    ]
    rows = [[_status_dot(RED), Paragraph(w, st["big"])] for w in warn]
    wt = Table(rows, colWidths=[16, CONTENT_W - 16])
    wt.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, -1), RED_SOFT),
        ("BOX", (0, 0), (-1, -1), 0.8, RED),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(KeepTogether(wt))

    # Everyday habits that help
    story.extend(_section("Everyday habits that help", st))
    for tip in [
        "Same bedtime and wake-up time every day — even weekends",
        "Drink water through the day (a bottle at school helps)",
        "Don't skip meals, especially breakfast",
        "Take screen breaks in the evening",
    ]:
        story.append(Paragraph(f"• {tip}", st["big"]))

    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "This plan was prepared with your care team and reviewed by your doctor. "
        "It is not a diagnosis. If you are worried, call the clinic — and in an "
        "emergency, call 911.", st["small"]))

    return _build(story, "ByeByeHeadache · Family Action Plan",
                  f"for {first} and family", VIOLET)


# ---------------------------------------------------------------- entry point

def build_visit_pdf(state: VisitState, audience: Audience = "doctor") -> bytes:
    if audience == "patient":
        return build_patient_pdf(state)
    return build_doctor_pdf(state)
