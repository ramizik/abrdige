/**
 * ByeByeHeadache — Pediatric Headache Copilot.
 * UI ported from the Lovable design; every rendered value originates from the
 * backend `VisitState` (Medplum-sourced case data + agent extraction deltas).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from './lib/api';
import { toneVars, type Tone } from './lib/tone';
import type {
  AskResponse,
  CaseSummary,
  EvidenceRef,
  ExtractedFact,
  InsightPack,
  ListFact,
  NumericFact,
  PlanItem,
  VisitState,
} from './types/bridge';

/* ---------------- Evidence drawer context ---------------- */

type EvidenceCtx = { open: (title: string, ids: string[]) => void };
const EvidenceContext = createContext<EvidenceCtx>({ open: () => {} });

/** Fixed PedMIDAS instrument text — mirrors backend pedmidas_questions ids. */
const PEDMIDAS_QUESTIONS: Record<string, string> = {
  pm1: 'Full school days missed in last 3 months',
  pm2: 'Partial school days missed in last 3 months',
  pm3: 'School days functioning at less than half',
  pm4: 'Days unable to do home activities/chores',
  pm5: 'Days unable to join play/social/sports',
  pm6: 'Days participated in activities at less than half',
};

/* ---------------- App shell ---------------- */

type Tab = 'live' | 'headache';

export default function App() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [state, setState] = useState<VisitState | null>(null);
  const [tab, setTab] = useState<Tab>('live');
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ title: string; refs: EvidenceRef[] } | null>(null);

  const openCase = useCallback(async (caseId: string) => {
    setError(null);
    setState(null);
    setDrawer(null);
    try {
      const s = await api.openCase(caseId);
      setState(s);
      setTab('live');
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantTab = params.get('tab');
    if (wantTab === 'headache') setTab('headache');
    api
      .listCases()
      .then((cs) => {
        setCases(cs);
        const wanted = params.get('case');
        const target = cs.find((c) => c.case_id === wanted) ?? cs[0];
        if (target) void openCase(target.case_id).then(() => {
          if (wantTab === 'headache') setTab('headache');
        });
      })
      .catch((e) => setError(String(e)));
  }, [openCase]);

  const evidenceCtx = useMemo<EvidenceCtx>(
    () => ({
      open: (title, ids) => {
        if (!state) return;
        const refs = ids.map((id) => state.evidence[id]).filter(Boolean);
        if (refs.length > 0) setDrawer({ title, refs });
      },
    }),
    [state],
  );

  return (
    <EvidenceContext.Provider value={evidenceCtx}>
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-background)' }}>
        <TopBar cases={cases} state={state} onSelect={openCase} />
        <Tabs tab={tab} onTab={setTab} />
        <main className="flex-1 min-h-0">
          {error && (
            <div className="m-4 rounded-[10px] p-4 border" style={{ background: 'var(--color-destructive-soft)', borderColor: 'var(--color-destructive-soft-border)' }}>
              <div className="text-[13px] font-bold" style={{ color: 'var(--color-destructive)' }}>
                Backend unreachable
              </div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--color-ink-2)' }}>{error}</div>
              <button
                onClick={() => (cases.length ? openCase(cases[0].case_id) : window.location.reload())}
                className="mt-2 text-[11.5px] font-semibold rounded-[7px] px-3 py-1.5 cursor-pointer"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              >
                Retry
              </button>
            </div>
          )}
          {!error && !state && (
            <div className="flex items-center justify-center h-[60vh]">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: 'var(--color-primary)' }} />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: 'var(--color-primary)' }} />
                </span>
                <span className="text-[13px]" style={{ color: 'var(--color-muted-foreground)' }}>
                  Loading case from Medplum FHIR…
                </span>
              </div>
            </div>
          )}
          {state && tab === 'live' && <LiveVisitView key={state.visit_id} state={state} setState={setState} onReset={() => openCase(state.case_id)} />}
          {state && tab === 'headache' && <HeadacheView state={state} />}
        </main>
        {drawer && <EvidenceDrawer title={drawer.title} refs={drawer.refs} onClose={() => setDrawer(null)} />}
      </div>
    </EvidenceContext.Provider>
  );
}

/* ---------------- Top bar + tabs ---------------- */

function redFlagsPresent(state: VisitState): number {
  return state.red_flags.filter((r) => r.status === 'present').length;
}

function badgeToneFor(state: VisitState | null): Tone {
  if (!state) return 'neutral';
  if (redFlagsPresent(state) > 0) return 'red';
  if (state.mode === 'follow_up') return 'teal';
  return 'neutral';
}

function TopBar({
  cases,
  state,
  onSelect,
}: {
  cases: CaseSummary[];
  state: VisitState | null;
  onSelect: (id: string) => void;
}) {
  const badge = toneVars(badgeToneFor(state));
  const p = state?.patient;
  const meta = state?.previsit
    ? `${state.previsit.documents_count} documents · ${state.previsit.sources_count} sources · assembled in ${state.previsit.assembled_seconds}s`
    : state
    ? `history: ${state.history.length} records · source: ${state.emr_summary ? 'EMR + intake' : 'chart'}`
    : '';
  return (
    <div
      className="flex items-center gap-3.5 px-[18px] py-[9px] border-b"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="relative w-8 h-8 rounded-[9px] flex items-center justify-center font-bold text-[15px]"
          style={{
            background: 'linear-gradient(135deg, var(--cyan), var(--violet) 55%, var(--pink))',
            color: 'var(--color-primary-foreground)',
            boxShadow: '0 0 0 1px oklch(0.55 0.13 200 / 0.6), 0 8px 24px -8px oklch(0.65 0.20 300 / 0.55)',
          }}
        >
          B
          <span
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
            style={{ background: 'var(--lime)', boxShadow: '0 0 8px var(--lime)' }}
          />
        </div>
        <div className="flex flex-col leading-tight">
          <div className="text-[16px] font-bold tracking-tight display text-gradient-clinical">ByeByeHeadache</div>
          <div className="text-[10px] mono" style={{ color: 'var(--color-muted-foreground)' }}>
            Pediatric Headache Copilot
          </div>
        </div>
      </div>

      <div className="w-px h-7" style={{ background: 'var(--color-border)' }} />
      {p && (
        <>
          <div className="flex items-baseline gap-2">
            <div className="text-[14px] font-semibold">{p.name}</div>
            <div className="text-[11.5px]" style={{ color: 'var(--color-ink-3)' }}>
              {p.age} y · {p.sex} · {p.mrn} · {p.provider}
            </div>
          </div>
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold border"
            style={{ background: badge.bg, color: badge.fg, borderColor: badge.bd }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: badge.fg }} />
            {p.referral_status}
          </div>
        </>
      )}
      <div className="ml-auto flex items-center gap-4">
        <div className="mono text-[10px]" style={{ color: 'var(--color-muted-foreground)' }}>
          {meta}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mono text-[9.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-muted-foreground)' }}>
            Demo case
          </span>
          <select
            value={state?.case_id ?? ''}
            onChange={(e) => onSelect(e.target.value)}
            className="cursor-pointer rounded-[7px] px-2 py-1 text-[11.5px] font-semibold outline-none"
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-foreground)',
            }}
          >
            {cases.map((c) => (
              <option key={c.case_id} value={c.case_id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function Tabs({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const items: { k: Tab; label: string }[] = [
    { k: 'live', label: 'Live Visit' },
    { k: 'headache', label: 'Headache Summary' },
  ];
  return (
    <div
      className="flex items-center px-[18px] pt-1.5 border-b"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      {items.map((it) => {
        const active = tab === it.k;
        return (
          <button
            key={it.k}
            onClick={() => onTab(it.k)}
            className="cursor-pointer px-3.5 py-[9px] text-[12.5px] font-semibold border-b-2"
            style={{
              color: active ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
              borderColor: active ? 'var(--color-primary)' : 'transparent',
              background: 'none',
            }}
          >
            {it.label}
          </button>
        );
      })}
      <span
        className="ml-auto mono text-[9.5px] pb-2"
        style={{ color: 'color-mix(in oklab, var(--color-muted-foreground) 70%, transparent)' }}
      >
        headache vertical · more visit types coming
      </span>
    </div>
  );
}

/* ---------------- Reusable primitives ---------------- */

function Card({
  eyebrow,
  right,
  children,
  className = '',
}: {
  eyebrow?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card-surface p-[13px_16px] ${className}`}>
      {(eyebrow || right) && (
        <div className="flex items-center gap-2 mb-2">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

function Chip({ tone = 'neutral', children, onClick }: { tone?: Tone; children: React.ReactNode; onClick?: () => void }) {
  const t = toneVars(tone);
  return (
    <span
      onClick={onClick}
      className={`mono text-[9.5px] rounded px-1.5 py-[1px] border ${onClick ? 'cursor-pointer' : ''}`}
      style={{ background: t.bg, color: t.fg, borderColor: t.bd }}
    >
      {children}
    </span>
  );
}

function EvidenceChip({ label, ids, title }: { label?: string; ids: string[]; title: string }) {
  const { open } = useContext(EvidenceContext);
  if (ids.length === 0) return null;
  return (
    <Chip tone="teal" onClick={() => open(title, ids)}>
      {label ?? `evidence ×${ids.length}`}
    </Chip>
  );
}

function BulletLine({ text }: { text: string }) {
  return (
    <div className="flex gap-2 items-baseline">
      <span className="w-2.5 h-[2px] flex-none rounded-sm mt-1.5" style={{ background: 'var(--color-primary)' }} />
      <span className="text-[11.5px]" style={{ color: 'var(--color-ink-2)' }}>{text}</span>
    </div>
  );
}

/** "…text [ev-1, ev-2]" → { text, ids } */
function splitEvidenceSuffix(line: string): { text: string; ids: string[] } {
  const m = line.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  if (!m) return { text: line, ids: [] };
  return { text: m[1], ids: m[2].split(',').map((s) => s.trim()) };
}

function StatusBar({ state }: { state: VisitState }) {
  const present = redFlagsPresent(state);
  const screened = state.red_flags.filter((r) => r.status !== 'unknown').length;
  const tone: Tone = present > 0 ? 'red' : screened > 0 ? 'teal' : 'neutral';
  const label =
    present > 0
      ? `Red flags present (${present}) — escalation review`
      : screened > 0
      ? `No urgent red flags · ${screened}/${state.red_flags.length} screened`
      : 'Red-flag screen not started';
  const t = toneVars(tone);
  return (
    <div className="flex items-center gap-2 rounded-[10px] px-3 py-2.5 border" style={{ background: t.bg, borderColor: t.bd }}>
      <span className="w-2 h-2 rounded-full flex-none" style={{ background: t.fg }} />
      <span className="text-[12px] font-semibold" style={{ color: t.fg }}>{label}</span>
    </div>
  );
}

function Banner({ state }: { state: VisitState }) {
  const present = state.red_flags.filter((r) => r.status === 'present');
  if (present.length === 0) return null;
  const t = toneVars('red');
  return (
    <div className="flex gap-2.5 items-start rounded-[10px] p-3 border" style={{ background: t.bg, borderColor: t.bd }}>
      <span
        className="w-[18px] h-[18px] rounded-full text-white font-bold text-[11px] flex items-center justify-center flex-none mt-[1px]"
        style={{ background: t.fg }}
      >
        !
      </span>
      <div>
        <div className="text-[13px] font-bold" style={{ color: t.fg }}>
          Routine pathway paused — red flags detected
        </div>
        <div className="text-[12px] mt-[3px] leading-[1.45]" style={{ color: 'var(--color-ink-2)' }}>
          {present.map((r) => r.label).join(' · ')}. Clinician review required before continuing the routine plan.
        </div>
      </div>
    </div>
  );
}

/* ---------------- LIVE VISIT VIEW ---------------- */

function LiveVisitView({
  state,
  setState,
  onReset,
}: {
  state: VisitState;
  setState: (s: VisitState) => void;
  onReset: () => void;
}) {
  const [playing, setPlaying] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeNote, setAnalyzeNote] = useState<string | null>(null);
  const inflight = useRef(false);
  const done = state.chunks_total === 0 || state.chunks_processed >= state.chunks_total;

  // Auto-advance: each tick asks the backend to process the next transcript chunk.
  useEffect(() => {
    if (!playing || done || inflight.current) return;
    const t = setTimeout(async () => {
      if (inflight.current) return;
      inflight.current = true;
      try {
        const res = await api.advanceChunk(state.visit_id);
        setState(res.state);
      } catch {
        setPlaying(false);
      } finally {
        inflight.current = false;
      }
    }, 1600);
    return () => clearTimeout(t);
  }, [playing, done, state, setState]);

  const analyze = async () => {
    setPlaying(false);
    setAnalyzing(true);
    setAnalyzeNote(null);
    try {
      const res = await api.analyze(state.visit_id);
      setState(res.state);
      setAnalyzeNote(res.live ? 'Live Agent SDK analysis applied' : `Fallback kept: ${res.error ?? 'live analysis unavailable'}`);
    } catch (e) {
      setAnalyzeNote(String(e));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div
      className="grid gap-3 p-3 overflow-hidden min-h-0"
      style={{ gridTemplateColumns: '300px minmax(0,1fr) 360px', height: 'calc(100vh - 84px)' }}
    >
      {/* LEFT: patient + safety + history */}
      <div className="overflow-y-auto flex flex-col gap-2.5 min-h-0">
        <PatientCard state={state} />
        <StatusBar state={state} />
        <VitalStrip state={state} />
        <EmrSummaryCard state={state} />
        <HistoryCard state={state} />
      </div>

      {/* CENTER: transcript + agent + live-extracted structured picture */}
      <div className="overflow-y-auto flex flex-col gap-2.5 min-h-0 min-w-0">
        <Banner state={state} />
        <AgentRail
          state={state}
          playing={playing}
          done={done}
          analyzing={analyzing}
          analyzeNote={analyzeNote}
          onToggle={() => setPlaying((v) => !v)}
          onReset={onReset}
          onAnalyze={analyze}
        />
        <TranscriptCard state={state} />
        <HeadacheProfileCard state={state} />
        <PedMidasCapture state={state} />
        {state.mode === 'follow_up' && state.changes_since_last_visit.length > 0 && (
          <ChangesCard state={state} />
        )}
        {state.previsit && (
          <Card
            eyebrow="Longitudinal Timeline · From Records"
            right={<span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>reconstructed from outside records</span>}
          >
            <Timeline state={state} />
          </Card>
        )}
      </div>

      {/* RIGHT: action console */}
      <div className="overflow-y-auto flex flex-col gap-2.5 min-h-0">
        <EscalationCard state={state} />
        {state.insights && <IntelligentInsights pack={state.insights} />}
        <PlanCard state={state} />
        <MissingQuestions state={state} />
        <AskBridgeCard state={state} />
        <UnresolvedCard state={state} />
        <CompleteVisitCard state={state} setState={setState} />
      </div>
    </div>
  );
}

function AgentRail({
  state,
  playing,
  done,
  analyzing,
  analyzeNote,
  onToggle,
  onReset,
  onAnalyze,
}: {
  state: VisitState;
  playing: boolean;
  done: boolean;
  analyzing: boolean;
  analyzeNote: string | null;
  onToggle: () => void;
  onReset: () => void;
  onAnalyze: () => void;
}) {
  const progress = state.chunks_total > 0 ? Math.round((state.chunks_processed / state.chunks_total) * 100) : 100;
  return (
    <div className="card-surface p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: 'var(--color-primary)' }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: 'var(--color-primary)' }} />
        </span>
        <div className="text-[12px] font-semibold">Visit Intelligence Agent</div>
        <span className="ml-auto mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>
          Anthropic Agent SDK · schema-validated
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border-soft)' }}>
          <div className="h-full transition-all duration-500" style={{ width: `${progress}%`, background: 'var(--color-primary)' }} />
        </div>
        <span className="mono text-[10px]" style={{ color: 'var(--color-muted-foreground)' }}>
          {state.chunks_processed}/{state.chunks_total} chunks
        </span>
        {state.chunks_total > 0 && (
          <button
            onClick={onToggle}
            disabled={done}
            className="text-[11.5px] font-semibold rounded-[7px] px-2.5 py-1 cursor-pointer"
            style={{
              background: playing ? 'var(--color-secondary)' : 'var(--color-primary)',
              color: playing ? 'var(--color-foreground)' : 'var(--color-primary-foreground)',
              border: '1px solid var(--color-border)',
              opacity: done ? 0.5 : 1,
            }}
          >
            {done ? 'Complete' : playing ? 'Pause' : 'Resume'}
          </button>
        )}
        <button
          onClick={onAnalyze}
          disabled={analyzing}
          className="text-[11.5px] font-semibold rounded-[7px] px-2.5 py-1 cursor-pointer"
          style={{ background: 'var(--color-accent)', color: 'var(--color-accent-foreground)', border: '1px solid var(--color-border)' }}
        >
          {analyzing ? 'Analyzing…' : 'Analyze (Agent SDK)'}
        </button>
        {done && state.chunks_total > 0 && (
          <button
            onClick={onReset}
            className="text-[11.5px] font-semibold rounded-[7px] px-2.5 py-1 cursor-pointer"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
          >
            Reset
          </button>
        )}
      </div>
      <div
        className="mt-2.5 rounded-lg px-2.5 py-2 flex items-start gap-2"
        style={{ background: 'var(--color-primary-soft)', border: '1px solid var(--color-primary-soft-border)' }}
      >
        <span className="mono text-[9.5px] mt-[3px]" style={{ color: 'var(--color-primary)' }}>AGENT</span>
        <span className="text-[12px]" style={{ color: 'var(--color-ink-2)' }}>{state.agent_status}</span>
      </div>
      {analyzeNote && (
        <div className="mt-1.5 mono text-[10px]" style={{ color: 'var(--color-muted-foreground)' }}>{analyzeNote}</div>
      )}
    </div>
  );
}

const SPEAKER_LABEL: Record<string, string> = { clinician: 'PCP', parent: 'Parent', patient: 'Patient', interpreter: 'Interpreter' };

function TranscriptCard({ state }: { state: VisitState }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [state.transcript.length]);
  return (
    <Card
      eyebrow="Live Transcript"
      right={<span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>simulated STT · demo</span>}
    >
      <div className="flex flex-col gap-2.5 max-h-[280px] overflow-y-auto pr-1">
        {state.transcript.length === 0 && (
          <div className="text-[12px] italic" style={{ color: 'var(--color-muted-foreground)' }}>
            {state.chunks_total === 0 ? 'No live transcript for this visit — review the structured summary.' : 'Waiting for first transcript chunk…'}
          </div>
        )}
        {state.transcript.map((t, i) => {
          const isPCP = t.speaker === 'clinician';
          return (
            <div key={t.id ?? i} className="flex gap-2 items-start">
              <span className="mono text-[9.5px] pt-[3px] flex-none w-9" style={{ color: 'var(--color-muted-foreground)' }}>
                {t.timestamp ?? `#${i + 1}`}
              </span>
              <span
                className="text-[10px] font-semibold uppercase tracking-wider flex-none rounded px-1.5 py-[1px] mt-[1px]"
                style={{
                  background: isPCP ? 'var(--color-primary-soft)' : 'var(--color-secondary)',
                  color: isPCP ? 'var(--color-primary)' : 'var(--color-ink-2)',
                }}
              >
                {SPEAKER_LABEL[t.speaker] ?? t.speaker}
              </span>
              <span className="text-[12.5px] leading-[1.5] flex-1" style={{ color: 'var(--color-ink-2)' }}>{t.text}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </Card>
  );
}

/* ---------------- Structured profile (backend facts) ---------------- */

type AnyFact = ExtractedFact | NumericFact | ListFact;

function factDisplay(f: AnyFact): { text: string; state: 'known' | 'unknown' | 'review' | 'negative' } {
  const v = f.value;
  const has = Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && `${v}` !== '';
  const text = Array.isArray(v) ? v.join(', ') : v !== null && v !== undefined ? `${v}` : '';
  if (f.status === 'needs_confirmation') return { text: has ? text : 'needs confirmation', state: 'review' };
  if (f.status === 'negative') return { text: has ? text : 'denied', state: 'negative' };
  if (f.status === 'present' && has) return { text, state: 'known' };
  return { text: 'unknown', state: 'unknown' };
}

function ProfileField({ label, fact }: { label: string; fact: AnyFact }) {
  const { open } = useContext(EvidenceContext);
  const d = factDisplay(fact);
  const style =
    d.state === 'known' || d.state === 'negative'
      ? { bg: 'var(--color-surface-2)', fg: 'var(--color-foreground)', bd: 'var(--color-border)' }
      : d.state === 'review'
      ? { bg: 'var(--color-warning-soft)', fg: 'var(--color-warning)', bd: 'var(--color-warning-soft-border)' }
      : { bg: 'var(--color-surface-2)', fg: 'var(--color-muted-foreground)', bd: 'var(--color-border)' };
  const clickable = fact.evidence_ids.length > 0;
  return (
    <div
      className={`rounded-lg p-2 border ${clickable ? 'cursor-pointer' : ''}`}
      style={{ background: style.bg, borderColor: style.bd }}
      onClick={clickable ? () => open(label, fact.evidence_ids) : undefined}
      title={clickable ? 'Show evidence' : undefined}
    >
      <div className="eyebrow" style={{ fontSize: '9.5px', marginBottom: 2 }}>{label}</div>
      <div className="text-[12.5px] font-semibold flex items-center gap-1.5 flex-wrap" style={{ color: style.fg }}>
        {d.text}
        {d.state === 'review' && (
          <span className="mono text-[8.5px] rounded px-1" style={{ background: 'var(--color-warning-strong)', color: 'white' }}>REVIEW</span>
        )}
        {clickable && (
          <span className="mono text-[8.5px] rounded px-1" style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
            ev·{fact.evidence_ids.length}
          </span>
        )}
      </div>
    </div>
  );
}

function HeadacheProfileCard({ state }: { state: VisitState }) {
  const p = state.profile;
  const fields: { label: string; fact: AnyFact }[] = [
    { label: 'Onset', fact: p.onset },
    { label: 'Frequency (days/mo)', fact: p.frequency_days_per_month },
    { label: 'Episode duration', fact: p.episode_duration },
    { label: 'Progression', fact: p.progression },
    { label: 'Location', fact: p.location },
    { label: 'Quality', fact: p.quality },
    { label: 'Severity', fact: p.severity },
    { label: 'Associated symptoms', fact: p.associated_symptoms },
    { label: 'Aura', fact: p.aura },
    { label: 'Triggers', fact: p.triggers },
    { label: 'Habits / lifestyle', fact: p.habits },
    { label: 'Acute med use', fact: p.acute_medication_use },
    { label: 'Treatment response', fact: p.treatment_response },
    { label: 'Overuse risk', fact: p.medication_overuse_risk },
    { label: 'School impact', fact: p.school_impact },
    { label: 'Family Hx', fact: p.family_history },
  ];
  const known = fields.filter((f) => factDisplay(f.fact).state !== 'unknown').length;
  return (
    <Card
      eyebrow="Headache Profile"
      right={
        <>
          <Chip tone="teal">evidence-linked</Chip>
          <span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>{known}/{fields.length} captured</span>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {fields.map((f) => (
          <ProfileField key={f.label} label={f.label} fact={f.fact} />
        ))}
      </div>
    </Card>
  );
}

function PedMidasCapture({ state }: { state: VisitState }) {
  const { open } = useContext(EvidenceContext);
  const pm = state.pedmidas;
  const answered = new Map(pm.responses.map((r) => [r.question_id, r]));
  const allIds = Object.keys(PEDMIDAS_QUESTIONS);
  const done = allIds.filter((id) => answered.has(id) && answered.get(id)!.value !== null).length;
  return (
    <Card
      eyebrow="PedMIDAS Capture"
      right={
        <>
          <Chip tone={pm.completion === 'complete' ? 'teal' : 'neutral'}>{done}/{allIds.length} captured</Chip>
          {pm.score !== null && <Chip tone="teal">score {pm.score}</Chip>}
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {allIds.map((id, i) => {
          const r = answered.get(id);
          const captured = r !== undefined && r.value !== null;
          return (
            <div key={id} className="flex items-center gap-2 text-[11.5px]">
              <span
                className="w-[15px] h-[15px] rounded-full flex items-center justify-center flex-none text-[9px] font-bold"
                style={{
                  background: captured ? 'var(--color-primary-soft)' : 'var(--color-surface-2)',
                  color: captured ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
                  border: '1px solid ' + (captured ? 'var(--color-primary-soft-border)' : 'var(--color-border)'),
                }}
              >
                {captured ? '✓' : i + 1}
              </span>
              <span className="flex-1" style={{ color: captured ? 'var(--color-ink-2)' : 'var(--color-muted-foreground)' }}>
                {r?.question ?? PEDMIDAS_QUESTIONS[id]}
              </span>
              <span
                className={`mono text-[10px] font-semibold ${captured && r!.evidence_ids.length > 0 ? 'cursor-pointer underline' : ''}`}
                style={{ color: captured ? 'var(--color-foreground)' : 'var(--color-muted-foreground)' }}
                onClick={captured && r!.evidence_ids.length > 0 ? () => open(r!.question, r!.evidence_ids) : undefined}
              >
                {captured ? `${r!.value} days` : 'pending'}
              </span>
            </div>
          );
        })}
      </div>
      {pm.completion !== 'complete' && (
        <div className="mt-2 text-[10.5px]" style={{ color: 'var(--color-muted-foreground)' }}>
          Score is only shown once all six items are captured.
        </div>
      )}
    </Card>
  );
}

function ChangesCard({ state }: { state: VisitState }) {
  return (
    <Card eyebrow="Changes Since Last Visit" right={<Chip tone="teal">follow-up</Chip>}>
      <div className="flex flex-col gap-2">
        {state.changes_since_last_visit.map((line, i) => {
          const { text, ids } = splitEvidenceSuffix(line);
          return (
            <div key={i} className="flex items-baseline gap-2.5">
              <span className="mono text-[10px] flex-none" style={{ color: 'var(--color-muted-foreground)' }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-[12.5px] flex-1 leading-[1.45]">{text}</span>
              <EvidenceChip ids={ids} title="Change since last visit" />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------------- Left column cards ---------------- */

function PatientCard({ state }: { state: VisitState }) {
  const p = state.patient;
  return (
    <div className="card-surface p-3.5">
      <div className="flex items-baseline gap-2">
        <div className="text-[15px] font-bold">{p.name}</div>
        <div className="text-[11.5px]" style={{ color: 'var(--color-ink-3)' }}>
          {p.age} y · {p.sex}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 mt-2">
        {[
          ['Visit type', p.visit_type],
          ['Language', p.preferred_language],
          ['Clinic', p.clinic],
          ['Visit', `${p.visit_length} · ${p.provider}`],
          ['Chief complaint', p.chief_complaint],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between text-[11.5px] gap-2">
            <span style={{ color: 'var(--color-muted-foreground)' }}>{k}</span>
            <span className="font-medium text-right">{v}</span>
          </div>
        ))}
      </div>
      {state.previsit && (
        <div className="mt-2 pt-2 text-[11.5px]" style={{ borderTop: '1px solid var(--color-border-soft)', color: 'var(--color-ink-2)' }}>
          {state.previsit.headline}
        </div>
      )}
    </div>
  );
}

function VitalStrip({ state }: { state: VisitState }) {
  const haDays = state.diary.days.filter((d) => (d.intensity ?? 0) > 0).length;
  const freq = factDisplay(state.profile.frequency_days_per_month);
  const lastTrend = state.pedmidas_trend.length > 0 ? state.pedmidas_trend[state.pedmidas_trend.length - 1].score : null;
  const ped = state.pedmidas.score ?? lastTrend;
  const flags = redFlagsPresent(state);
  const tiles: { label: string; value: string; tone: Tone; sub?: string }[] = [
    {
      label: 'HA days/mo',
      value: freq.state === 'known' ? freq.text : haDays > 0 ? `${haDays}` : '—',
      tone: freq.state === 'known' || haDays > 0 ? 'teal' : 'neutral',
      sub: haDays > 0 ? `${haDays} diary days` : 'from intake',
    },
    {
      label: 'PedMIDAS',
      value: ped !== null ? `${ped}` : 'baseline',
      tone: ped !== null ? (ped > 30 ? 'red' : ped > 10 ? 'amber' : 'teal') : 'neutral',
      sub: state.pedmidas.completion === 'complete' ? 'captured today' : state.pedmidas.completion,
    },
    {
      label: 'Red flags',
      value: `${flags}`,
      tone: flags > 0 ? 'red' : 'teal',
      sub: flags > 0 ? 'escalation review' : 'none present',
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {tiles.map((t, i) => {
        const tv = toneVars(t.tone);
        return (
          <div key={i} className="rounded-[10px] p-2 border" style={{ background: tv.bg, borderColor: tv.bd }}>
            <div className="eyebrow" style={{ fontSize: 9, color: tv.fg }}>{t.label}</div>
            <div className="text-[18px] font-bold leading-tight" style={{ color: tv.fg }}>{t.value}</div>
            {t.sub && <div className="mono text-[9px] mt-[1px]" style={{ color: 'var(--color-muted-foreground)' }}>{t.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

const EMR_FLAG_TONE: Record<string, Tone> = {
  'overuse watch': 'amber',
  contraindication: 'red',
};

function EmrSummaryCard({ state }: { state: VisitState }) {
  const emr = state.emr_summary;
  if (!emr) return null;
  return (
    <Card
      eyebrow="EMR Summary · Agent-Pulled"
      right={<span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>auto-extracted from chart</span>}
    >
      <div className="text-[11.5px] mb-2" style={{ color: 'var(--color-ink-2)' }}>{emr.headline}</div>
      <div className="flex flex-col gap-1.5">
        {emr.items.map((it) => (
          <div key={it.id} className="rounded-lg px-2 py-1.5 border" style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border-soft)' }}>
            <div className="flex items-baseline gap-2">
              <span className="text-[11.5px] font-semibold flex-1">{it.label}</span>
              <span className="mono text-[9px]" style={{ color: 'var(--color-muted-foreground)' }}>{it.date}</span>
            </div>
            <div className="text-[10.5px] mt-[1px]" style={{ color: 'var(--color-ink-3)' }}>{it.detail}</div>
            <div className="flex gap-1.5 mt-1 flex-wrap">
              <Chip tone="neutral">{it.category.replace('_', ' ')}</Chip>
              {it.flag && <Chip tone={EMR_FLAG_TONE[it.flag] ?? 'amber'}>{it.flag}</Chip>}
              <EvidenceChip ids={it.evidence_ids} title={it.label} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function HistoryCard({ state }: { state: VisitState }) {
  const { open } = useContext(EvidenceContext);
  if (state.history.length === 0) return null;
  return (
    <Card eyebrow="Prior History Records">
      <div className="flex flex-col gap-1.5">
        {state.history.map((h) => (
          <div
            key={h.id}
            className="flex gap-2 items-baseline cursor-pointer"
            onClick={() => open(h.label, [h.id])}
            title={h.text}
          >
            <span className="w-2.5 h-[2px] flex-none rounded-sm mt-1.5" style={{ background: 'var(--color-primary)' }} />
            <span className="text-[11.5px] flex-1" style={{ color: 'var(--color-ink-2)' }}>{h.label}</span>
            <span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>{h.date ?? ''}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- Timeline ---------------- */

function Timeline({ state }: { state: VisitState }) {
  const nodes = state.previsit?.timeline ?? [];
  if (nodes.length === 0) return null;
  return (
    <div className="relative mt-3">
      <div className="absolute left-9 right-9 top-[5px] h-[2px]" style={{ background: 'var(--color-border)' }} />
      <div className="flex relative">
        {nodes.map((n, i) => {
          const teal = 'var(--color-primary)';
          const amber = 'var(--color-warning-strong)';
          const isToday = n.kind === 'today';
          const fill =
            isToday ? 'var(--color-foreground)' : n.kind === 'er_visit' ? amber : n.kind === 'visit' ? teal : 'var(--color-surface)';
          const border =
            isToday ? 'var(--color-foreground)' : n.kind === 'er_visit' ? amber : n.kind === 'visit' ? teal
            : 'color-mix(in oklab, var(--color-muted-foreground) 60%, transparent)';
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5 text-center">
              <span
                className="w-[11px] h-[11px] rounded-full"
                style={{ background: fill, border: `2.5px solid ${border}`, boxShadow: isToday ? '0 0 0 3px var(--color-border)' : 'none' }}
              />
              <span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>{n.date}</span>
              <span className="text-[11.5px]" style={{ fontWeight: isToday ? 700 : 600 }}>{n.label}</span>
              <span className="text-[10.5px]" style={{ color: 'var(--color-muted-foreground)' }}>{n.sublabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Right column ---------------- */

function EscalationCard({ state }: { state: VisitState }) {
  const present = state.red_flags.filter((r) => r.status === 'present');
  if (present.length === 0) return null;
  return (
    <div className="card-surface overflow-hidden" style={{ borderColor: 'var(--color-destructive-soft-border)' }}>
      <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ background: 'var(--color-destructive-soft)' }}>
        <span className="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold text-[10px]" style={{ background: 'var(--color-destructive)' }}>
          !
        </span>
        <span className="text-[12px] font-bold" style={{ color: 'var(--color-destructive)' }}>
          Escalation review — clinician required
        </span>
      </div>
      <div className="px-3.5 py-2.5 flex flex-col gap-2">
        {present.map((rf, i) => (
          <div key={rf.key} className="flex gap-2.5 items-baseline">
            <span className="mono text-[10px] flex-none" style={{ color: 'var(--color-destructive)' }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="flex-1">
              <div className="text-[12px] font-semibold">{rf.label}</div>
            </div>
            <EvidenceChip ids={rf.evidence_ids} title={rf.label} />
          </div>
        ))}
        {state.care_plan && state.care_plan.referral_considerations.length > 0 && (
          <div className="pt-1.5" style={{ borderTop: '1px solid var(--color-border-soft)' }}>
            {state.care_plan.referral_considerations.map((r, i) => (
              <div key={i} className="text-[11px] mt-1" style={{ color: 'var(--color-ink-3)' }}>{r}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function classifyPlan(item: PlanItem): 'today' | 'pending' {
  const s = (item.title + ' ' + item.detail).toLowerCase();
  if (/refer|neurolog|follow[- ]up|threshold|letter|504|action plan|escalat|specialist|imaging|mri|schedule|hand off|handoff|diary card|pending|fax|re-fax|records/.test(s)) {
    return 'pending';
  }
  return 'today';
}

function PlanSection({ title, items, accent, bg }: { title: string; items: { title: string; detail: string; ids?: string[] }[]; accent: string; bg: string }) {
  return (
    <div className="rounded-[10px] p-2.5 border" style={{ background: bg, borderColor: 'color-mix(in oklab, ' + accent + ' 30%, transparent)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
        <span className="eyebrow" style={{ fontSize: 9.5, color: accent }}>{title}</span>
        <span className="ml-auto mono text-[9.5px] font-semibold" style={{ color: accent }}>{items.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <div className="text-[11px] italic" style={{ color: 'var(--color-muted-foreground)' }}>—</div>
        ) : (
          items.map((pi, i) => (
            <div key={i} className="flex gap-2 items-baseline">
              <span className="mono text-[9.5px] flex-none" style={{ color: accent }}>{String(i + 1).padStart(2, '0')}</span>
              <div className="flex-1">
                <div className="text-[12px] font-semibold" style={{ color: 'var(--color-foreground)' }}>{pi.title}</div>
                <div className="text-[11px] mt-[1px]" style={{ color: 'var(--color-ink-3)' }}>{pi.detail}</div>
              </div>
              {pi.ids && <EvidenceChip ids={pi.ids} title={pi.title} />}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PlanCard({ state }: { state: VisitState }) {
  const esc = redFlagsPresent(state) > 0;

  // After completion the clinician-review care plan is authoritative.
  if (state.care_plan) {
    const cp = state.care_plan;
    return (
      <div className="card-surface p-2.5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="eyebrow">Clinician-Review Plan</div>
          <span className="ml-auto mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>draft · requires sign-off</span>
        </div>
        <PlanSection
          title="Visit summary"
          items={cp.summary.map(splitEvidenceSuffix).map((s) => ({ title: s.text, detail: '', ids: s.ids }))}
          accent="var(--color-primary)"
          bg="var(--color-primary-soft)"
        />
        <PlanSection
          title="Suggested pathway"
          items={cp.suggested_pathway.map((s) => ({ title: s, detail: '' }))}
          accent="var(--color-primary)"
          bg="var(--color-surface-2)"
        />
        <PlanSection
          title="Family instructions"
          items={cp.patient_instructions.map((s) => ({ title: s, detail: '' }))}
          accent="var(--color-warning-strong)"
          bg="var(--color-warning-soft)"
        />
        <div className="text-[10px] leading-[1.4] px-1" style={{ color: 'var(--color-muted-foreground)' }}>{cp.disclaimer}</div>
      </div>
    );
  }

  const draft = state.previsit?.draft_plan ?? [];
  if (draft.length === 0) return null;
  const today = draft.filter((i) => classifyPlan(i) === 'today');
  const pending = draft.filter((i) => classifyPlan(i) === 'pending');
  const pendingAll = [
    ...pending.map((i) => ({ title: i.title, detail: i.detail, ids: i.evidence_ids })),
    ...(state.previsit?.handoff_items ?? []).map((h) => ({ title: h.title, detail: `${h.detail} · ${h.status.replace('_', ' ')}` })),
  ];
  return (
    <div className="card-surface p-2.5 flex flex-col gap-2" style={{ opacity: esc ? 0.6 : 1 }}>
      <div className="flex items-center gap-2">
        <div className="eyebrow">Draft PCP Plan</div>
        <span className="ml-auto mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>for clinician review</span>
      </div>
      <PlanSection
        title="Discuss today"
        items={today.map((i) => ({ title: i.title, detail: i.detail, ids: i.evidence_ids }))}
        accent="var(--color-primary)"
        bg="var(--color-primary-soft)"
      />
      <PlanSection title="Pending · referrals & follow-ups" items={pendingAll} accent="var(--color-warning-strong)" bg="var(--color-warning-soft)" />
    </div>
  );
}

function MissingQuestions({ state }: { state: VisitState }) {
  const items = state.missing_questions;
  return (
    <Card eyebrow="Still to Ask" right={<Chip tone={items.length ? 'amber' : 'teal'}>{items.length} pending</Chip>}>
      {items.length === 0 ? (
        <div className="text-[12px]" style={{ color: 'var(--color-ink-2)' }}>
          Core question set covered — review structured summary before completing visit.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((q, i) => (
            <BulletLine key={i} text={q} />
          ))}
        </div>
      )}
    </Card>
  );
}

function AskBridgeCard({ state }: { state: VisitState }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ q: string; a: AskResponse } | null>(null);
  const { open } = useContext(EvidenceContext);

  const suggestions = (state.previsit?.suggested_questions ?? []).filter((s) => !s.endsWith('...'));

  const submit = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    try {
      const a = await api.ask(state.visit_id, question);
      setRes({ q: question, a });
    } catch (e) {
      setRes({ q: question, a: { answer: `Request failed: ${e}`, citations: [], grounded: false } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      eyebrow="Ask ByeByeHeadache"
      right={<span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>answers cite chart sources</span>}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(q);
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask about this chart…"
          disabled={busy}
          className="w-full rounded-[8px] px-2.5 py-1.5 text-[12px] outline-none"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
        />
      </form>
      {suggestions.length > 0 && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => {
                setQ(s);
                void submit(s);
              }}
              disabled={busy}
              className="cursor-pointer rounded-full px-2.5 py-[3px] text-[10.5px]"
              style={{ background: 'var(--color-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-ink-2)' }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {busy && (
        <div className="mt-2 text-[11px] italic" style={{ color: 'var(--color-muted-foreground)' }}>Searching chart evidence…</div>
      )}
      {res && !busy && (
        <div className="mt-2.5 rounded-lg px-3 py-2 border" style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border)' }}>
          <div className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>{res.q}</div>
          <div className="text-[12px] mt-1 leading-[1.45]">{res.a.answer}</div>
          <div className="mt-1.5 flex gap-1.5 flex-wrap">
            {res.a.citations.map((c) => (
              <Chip key={c.evidence_id} tone="teal" onClick={() => open(res.q, [c.evidence_id])}>
                {c.source_label}
              </Chip>
            ))}
            {!res.a.grounded && <Chip tone="amber">not grounded in chart</Chip>}
          </div>
        </div>
      )}
    </Card>
  );
}

function UnresolvedCard({ state }: { state: VisitState }) {
  const items = state.previsit?.unresolved_items ?? [];
  if (items.length === 0) return null;
  return (
    <div className="rounded-[10px] px-3.5 py-2.5 border" style={{ background: 'var(--color-warning-soft)', borderColor: 'var(--color-warning-soft-border)' }}>
      <div className="eyebrow" style={{ color: 'var(--color-warning)' }}>Unresolved</div>
      {items.map((u) => (
        <div key={u.id}>
          <div className="text-[11.5px] mt-1 leading-[1.45]" style={{ color: 'var(--color-ink-2)' }}>{u.text}</div>
          <div className="mt-1.5">
            <span
              className="mono text-[9.5px] rounded px-1.5 py-[2px]"
              style={{ background: 'color-mix(in oklab, var(--color-warning-strong) 25%, transparent)', color: 'var(--color-warning)' }}
            >
              requested from {u.requested_from} · {u.date}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function CompleteVisitCard({ state, setState }: { state: VisitState; setState: (s: VisitState) => void }) {
  const [busy, setBusy] = useState(false);
  const esc = redFlagsPresent(state) > 0;
  const complete = state.phase === 'complete';
  return (
    <div className="card-surface p-3.5 flex flex-col gap-2">
      <div className="eyebrow">Complete Visit</div>
      <div className="text-[11.5px]" style={{ color: 'var(--color-ink-3)' }}>
        {complete
          ? 'Visit summary generated — plan above is a draft for clinician review.'
          : 'Final summary and family PDF are drafts for clinician review — nothing sends without sign-off.'}
      </div>
      <div className="flex gap-2 mt-1">
        <button
          disabled={busy || complete}
          onClick={async () => {
            setBusy(true);
            try {
              setState(await api.completeVisit(state.visit_id));
            } finally {
              setBusy(false);
            }
          }}
          className="text-[11.5px] font-semibold rounded-[7px] px-3 py-1.5 cursor-pointer flex-1"
          style={{
            background: esc ? 'var(--color-destructive)' : 'var(--color-primary)',
            color: 'white',
            opacity: busy || complete ? 0.6 : 1,
          }}
        >
          {complete ? 'Visit complete ✓' : busy ? 'Completing…' : 'Complete visit'}
        </button>
        <a href={api.pdfUrl(state.visit_id)} target="_blank" rel="noreferrer">
          <button
            className="text-[11.5px] font-semibold rounded-[7px] px-3 py-1.5 cursor-pointer"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            Export PDF
          </button>
        </a>
      </div>
    </div>
  );
}

/* ---------------- Intelligent Insights (backend InsightPack) ---------------- */

function toneColor(t: Tone) {
  return t === 'red' ? 'var(--color-destructive)'
    : t === 'amber' ? 'var(--color-warning)'
    : t === 'teal' ? 'var(--color-primary)'
    : 'var(--color-muted-foreground)';
}

function ConfidenceBar({ value, tone }: { value: number; tone: Tone }) {
  const color = toneColor(tone);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border-soft)' }}>
        <div className="h-full transition-all duration-500" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
      <span className="mono text-[10px] font-semibold" style={{ color }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

function CriterionRow({ text, met }: { text: string; met: 'met' | 'partial' | 'unmet' }) {
  const sym = met === 'met' ? '✓' : met === 'partial' ? '◐' : '○';
  const color = met === 'met' ? 'var(--color-primary)' : met === 'partial' ? 'var(--color-warning)' : 'var(--color-muted-foreground)';
  return (
    <div className="flex items-start gap-1.5">
      <span className="mono text-[11px] font-bold flex-none leading-[1.4]" style={{ color }}>{sym}</span>
      <span className="text-[11px] leading-[1.45]" style={{ color: 'var(--color-ink-2)' }}>{text}</span>
    </div>
  );
}

function IntelligentInsights({ pack }: { pack: InsightPack }) {
  const [tab, setTab] = useState<'dx' | 'tx'>('dx');
  return (
    <Card
      eyebrow="Intelligent Insights"
      right={<span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>evidence-linked · draft</span>}
    >
      {pack.note && (
        <div
          className="rounded-lg px-2.5 py-1.5 mb-2 text-[11.5px] leading-[1.45]"
          style={{ background: 'var(--color-primary-soft)', border: '1px solid var(--color-primary-soft-border)', color: 'var(--color-ink-2)' }}
        >
          {pack.note}
        </div>
      )}

      <div className="flex gap-1 mb-2 p-0.5 rounded-lg" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border-soft)' }}>
        {(['dx', 'tx'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className="flex-1 text-[11px] font-semibold rounded-[6px] py-1 cursor-pointer transition-colors"
            style={{
              background: tab === k ? 'var(--color-background)' : 'transparent',
              color: tab === k ? 'var(--color-foreground)' : 'var(--color-muted-foreground)',
              border: tab === k ? '1px solid var(--color-border)' : '1px solid transparent',
            }}
          >
            {k === 'dx' ? `Differential Dx · ${pack.dxs.length}` : `Treatment Plan · ${pack.txs.length}`}
          </button>
        ))}
      </div>

      {tab === 'dx' && (
        <div className="flex flex-col gap-2">
          {pack.dxs.map((d, i) => (
            <div key={i} className="rounded-lg p-2" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border-soft)' }}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-[12.5px] font-semibold leading-[1.35]" style={{ color: 'var(--color-ink-1)' }}>{d.dx}</span>
                <Chip tone={d.tone}>{d.guideline}</Chip>
              </div>
              <ConfidenceBar value={d.confidence} tone={d.tone} />
              <div className="mt-1.5 flex flex-col gap-1">
                {d.criteria.map((c, j) => (
                  <CriterionRow key={j} text={c.text} met={c.met} />
                ))}
              </div>
              <div className="mt-1.5 text-[11px] italic leading-[1.45]" style={{ color: 'var(--color-ink-3)' }}>{d.rationale}</div>
              <div className="mt-1.5">
                <a href={d.guideline_url} target="_blank" rel="noreferrer" className="mono text-[10px] font-semibold underline" style={{ color: 'var(--color-primary)' }}>
                  {d.guideline} ↗
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'tx' && (
        <div className="flex flex-col gap-2">
          {pack.txs.map((t, i) => (
            <div key={i} className="rounded-lg p-2 flex gap-2" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border-soft)' }}>
              <span className="w-1 rounded-full flex-none" style={{ background: toneColor(t.tone) }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="mono text-[9.5px] uppercase tracking-wider" style={{ color: 'var(--color-muted-foreground)' }}>{t.step}</span>
                  <Chip tone={t.tone}>{t.evidence}</Chip>
                </div>
                <div className="text-[12.5px] font-semibold leading-[1.35]" style={{ color: 'var(--color-ink-1)' }}>{t.rec}</div>
                <div className="text-[11px] mt-[2px] leading-[1.45]" style={{ color: 'var(--color-ink-3)' }}>{t.detail}</div>
                <a href={t.evidence_url} target="_blank" rel="noreferrer" className="mono text-[10px] font-semibold underline mt-1 inline-block" style={{ color: 'var(--color-primary)' }}>
                  {t.evidence} ↗
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        className="mt-2 rounded-md px-2 py-1 text-[10px] leading-[1.4]"
        style={{ background: 'var(--color-surface-2)', border: '1px dashed var(--color-border-soft)', color: 'var(--color-muted-foreground)' }}
      >
        Decision support only — clinician confirms diagnosis & plan. Guidelines: ICHD-3, AAN/AHS 2019, CHAMP (NEJM 2017).
      </div>
    </Card>
  );
}

/* ---------------- HEADACHE SUMMARY VIEW ---------------- */

function HeadacheView({ state }: { state: VisitState }) {
  return (
    <div
      className="grid gap-3 p-3 overflow-hidden min-h-0"
      style={{ gridTemplateColumns: '300px minmax(0,1fr) 340px', height: 'calc(100vh - 84px)' }}
    >
      {/* LEFT: safety + lifestyle */}
      <div className="overflow-y-auto flex flex-col gap-2.5 min-h-0">
        <StatusBar state={state} />
        <RedFlagPanel state={state} />
        <ContextCard state={state} />
        <AcuteMedCard state={state} />
      </div>

      {/* CENTER: charts + prior visits */}
      <div className="overflow-y-auto flex flex-col gap-2.5 min-h-0 min-w-0">
        <Banner state={state} />
        <HeadacheKPIs state={state} />
        <div className="grid gap-2.5" style={{ gridTemplateColumns: state.pedmidas_trend.length >= 2 && state.diary.days.length > 0 ? '1.45fr 1fr' : '1fr' }}>
          {state.pedmidas_trend.length >= 2 && <PedMidasChart state={state} />}
          {state.diary.days.length > 0 && <HeadacheHeatmap state={state} />}
        </div>
        {state.mode === 'follow_up' && state.changes_since_last_visit.length > 0 && <ChangesCard state={state} />}
        <PriorVisits state={state} />
        <PainLocationCard state={state} />
      </div>

      {/* RIGHT: insights + ask + reference */}
      <div className="overflow-y-auto flex flex-col gap-2.5 min-h-0">
        <EscalationCard state={state} />
        {state.insights && <IntelligentInsights pack={state.insights} />}
        <AskDuringVisitCard state={state} />
        <LocationReferenceCard />
      </div>
    </div>
  );
}

function RedFlagPanel({ state }: { state: VisitState }) {
  const { open } = useContext(EvidenceContext);
  return (
    <Card eyebrow="Red-Flag Screen · 14-Item Catalog">
      <div className="flex flex-col">
        {state.red_flags.map((r) => {
          const flag = r.status === 'present';
          const unknown = r.status === 'unknown';
          return (
            <div
              key={r.key}
              className={`flex items-center gap-2 py-1 ${r.evidence_ids.length > 0 ? 'cursor-pointer' : ''}`}
              onClick={r.evidence_ids.length > 0 ? () => open(r.label, r.evidence_ids) : undefined}
            >
              <span
                className="w-[15px] h-[15px] rounded-full flex items-center justify-center text-[9.5px] font-bold flex-none"
                style={{
                  background: flag ? 'var(--color-destructive)' : unknown ? 'var(--color-surface-2)' : 'var(--color-primary-soft)',
                  color: flag ? 'white' : unknown ? 'var(--color-muted-foreground)' : 'var(--color-primary)',
                  border: unknown ? '1px solid var(--color-border)' : 'none',
                }}
              >
                {flag ? '!' : unknown ? '·' : '✓'}
              </span>
              <span className="text-[11.5px] flex-1" style={{ color: unknown ? 'var(--color-muted-foreground)' : 'var(--color-ink-2)' }}>
                {r.label}
              </span>
              <span
                className="mono text-[9.5px]"
                style={{
                  color: flag ? 'var(--color-destructive)' : unknown ? 'var(--color-muted-foreground)' : 'var(--color-muted-foreground)',
                  fontWeight: flag ? 700 : 400,
                }}
              >
                {flag ? 'FLAG' : unknown ? 'not asked' : 'clear'}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ContextCard({ state }: { state: VisitState }) {
  const p = state.profile;
  const rows: { label: string; fact: AnyFact }[] = [
    { label: 'Habits', fact: p.habits },
    { label: 'Triggers', fact: p.triggers },
    { label: 'Relievers', fact: p.relievers },
    { label: 'Diary kept', fact: p.diary_available },
    { label: 'Interference', fact: p.headache_interference },
  ];
  return (
    <Card eyebrow="Context & Lifestyle">
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const d = factDisplay(r.fact);
          const known = d.state !== 'unknown';
          return (
            <div key={r.label} className="flex items-start gap-2 text-[11.5px]">
              <span className="w-1.5 h-1.5 rounded-full flex-none mt-1.5" style={{ background: known ? 'var(--color-primary)' : 'var(--color-border)' }} />
              <span style={{ color: 'var(--color-muted-foreground)' }}>{r.label}</span>
              <span className="ml-auto font-medium text-right max-w-[60%]" style={{ color: known ? 'var(--color-foreground)' : 'var(--color-muted-foreground)' }}>
                {d.text}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AcuteMedCard({ state }: { state: VisitState }) {
  const meds = factDisplay(state.profile.acute_medication_use);
  const overuse = factDisplay(state.profile.medication_overuse_risk);
  if (meds.state === 'unknown' && overuse.state === 'unknown') return null;
  const risky = overuse.state === 'review' || (overuse.state === 'known' && state.profile.medication_overuse_risk.status === 'present');
  const tone = toneVars(risky ? 'amber' : 'teal');
  return (
    <Card eyebrow="Acute Medication Use">
      {meds.state !== 'unknown' && (
        <div className="text-[12.5px] font-semibold" style={{ color: 'var(--color-ink-1)' }}>{meds.text}</div>
      )}
      {overuse.state !== 'unknown' && (
        <div className="mt-1.5 rounded-lg px-2.5 py-2 border" style={{ background: tone.bg, borderColor: tone.bd }}>
          <div className="text-[11px] font-semibold" style={{ color: tone.fg }}>
            {risky ? 'Overuse watch' : 'Below overuse threshold'}
          </div>
          <div className="text-[11px] mt-[1px]" style={{ color: 'var(--color-ink-3)' }}>{overuse.text}</div>
        </div>
      )}
      <div className="mt-1.5 flex gap-1.5">
        <EvidenceChip ids={state.profile.acute_medication_use.evidence_ids} title="Acute medication use" />
        <span className="mono text-[9.5px] ml-auto" style={{ color: 'var(--color-muted-foreground)' }}>limit ≈ 10 d/mo</span>
      </div>
    </Card>
  );
}

function HeadacheKPIs({ state }: { state: VisitState }) {
  const days = state.diary.days.filter((d) => (d.intensity ?? 0) > 0).length;
  const severe = state.diary.days.filter((d) => (d.intensity ?? 0) >= 3).length;
  const freq = factDisplay(state.profile.frequency_days_per_month);
  const lastTrend = state.pedmidas_trend.length > 0 ? state.pedmidas_trend[state.pedmidas_trend.length - 1].score : null;
  const ped = state.pedmidas.score ?? lastTrend;
  const hasDiary = state.diary.days.length > 0;
  const kpis: { label: string; value: string; sub?: string; tone: Tone; icon: string }[] = [
    {
      label: 'Headache days / mo',
      value: freq.state === 'known' ? freq.text : hasDiary ? `${days}` : '—',
      sub: hasDiary ? `${days} diary days` : 'from intake',
      tone: freq.state === 'known' || hasDiary ? (days > 15 ? 'red' : days > 8 ? 'amber' : 'teal') : 'neutral',
      icon: '◐',
    },
    {
      label: 'Severe episodes',
      value: hasDiary ? `${severe}` : '—',
      sub: severe > 3 ? 'elevated' : 'within pattern',
      tone: severe > 3 ? 'amber' : hasDiary ? 'teal' : 'neutral',
      icon: '▲',
    },
    {
      label: 'PedMIDAS',
      value: ped !== null ? `${ped}` : 'TBD',
      sub: state.pedmidas.completion === 'complete' ? 'captured today' : state.pedmidas.completion.replace('_', ' '),
      tone: ped !== null ? (ped > 30 ? 'red' : ped > 10 ? 'amber' : 'teal') : 'neutral',
      icon: '◆',
    },
    {
      label: 'Red flags',
      value: `${redFlagsPresent(state)}`,
      sub: `${state.red_flags.filter((r) => r.status !== 'unknown').length}/${state.red_flags.length} screened`,
      tone: redFlagsPresent(state) > 0 ? 'red' : 'teal',
      icon: '⚑',
    },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {kpis.map((k, i) => {
        const tv = toneVars(k.tone);
        return (
          <div key={i} className="rounded-[10px] p-2.5 border relative overflow-hidden" style={{ background: tv.bg, borderColor: tv.bd }}>
            <div className="absolute top-1 right-2 text-[16px] opacity-40" style={{ color: tv.fg }}>{k.icon}</div>
            <div className="eyebrow" style={{ fontSize: 9, color: tv.fg }}>{k.label}</div>
            <div className="text-[20px] font-bold leading-tight mt-[2px]" style={{ color: tv.fg }}>{k.value}</div>
            {k.sub && <div className="mono text-[9px] mt-[2px]" style={{ color: 'var(--color-muted-foreground)' }}>{k.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

function PedMidasChart({ state }: { state: VisitState }) {
  const { open } = useContext(EvidenceContext);
  const points = state.pedmidas_trend;
  if (points.length < 2) return null;
  const improving = points[points.length - 1].score < points[0].score;
  const tone = toneVars(improving ? 'teal' : 'amber');
  const maxScore = Math.max(50, ...points.map((p) => p.score));
  const x0 = 50;
  const x1 = 410;
  const xs = (i: number) => x0 + (i * (x1 - x0)) / Math.max(1, points.length - 1);
  const ys = (s: number) => +(164 - (s / maxScore) * 135).toFixed(1);
  const pts = points.map((p, i) => ({ x: xs(i), y: ys(p.score), v: p.score, d: p.date, ids: p.evidence_ids }));
  const poly = pts.map((pt) => `${pt.x},${pt.y}`).join(' ');
  const delta = points[points.length - 1].score - points[0].score;
  const intervention = state.medication_events[0];
  return (
    <Card
      eyebrow="PedMIDAS Disability"
      right={
        <span className="text-[11px] font-bold" style={{ color: tone.fg }}>
          {improving ? `Improving · ${delta}` : `Worsening · +${delta}`} since first capture
        </span>
      }
    >
      <svg viewBox="0 0 460 202" className="w-full h-auto block mt-1.5">
        <line x1="30" y1="164" x2="450" y2="164" stroke="var(--color-border-soft)" />
        <line x1="30" y1="96.5" x2="450" y2="96.5" stroke="var(--color-border-soft)" />
        <line x1="30" y1="29" x2="450" y2="29" stroke="var(--color-border-soft)" />
        <text x="24" y="167" textAnchor="end" fill="var(--color-muted-foreground)" style={{ fontFamily: 'var(--font-mono)', fontSize: 9 }}>0</text>
        <text x="24" y="99" textAnchor="end" fill="var(--color-muted-foreground)" style={{ fontFamily: 'var(--font-mono)', fontSize: 9 }}>{Math.round(maxScore / 2)}</text>
        <text x="24" y="32" textAnchor="end" fill="var(--color-muted-foreground)" style={{ fontFamily: 'var(--font-mono)', fontSize: 9 }}>{maxScore}</text>
        {intervention && (
          <>
            <line x1="140" y1="18" x2="140" y2="168" stroke="color-mix(in oklab, var(--color-muted-foreground) 45%, transparent)" strokeDasharray="3 3" />
            <text x="146" y="24" fill="var(--color-ink-3)" style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5 }}>
              {intervention.label} · {intervention.date}
            </text>
          </>
        )}
        <polyline points={poly} fill="none" stroke={tone.fg} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((pt, i) => (
          <g key={i} onClick={() => pt.ids.length > 0 && open(`PedMIDAS ${pt.v} · ${pt.d}`, pt.ids)} style={{ cursor: pt.ids.length > 0 ? 'pointer' : 'default' }}>
            <circle cx={pt.x} cy={pt.y} r={4.5} fill="var(--color-surface)" stroke={tone.fg} strokeWidth={2.5} />
            <text x={pt.x} y={pt.y - 12} textAnchor="middle" fill="var(--color-foreground)" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>{pt.v}</text>
            <text x={pt.x} y={194} textAnchor="middle" fill="var(--color-muted-foreground)" style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5 }}>{pt.d}</text>
          </g>
        ))}
      </svg>
    </Card>
  );
}

function HeadacheHeatmap({ state }: { state: VisitState }) {
  const byDay = new Map(state.diary.days.map((d) => [d.day, d.intensity ?? 0]));
  const cells = Array.from({ length: 30 }, (_, i) => byDay.get(i + 1) ?? 0);
  const count = cells.filter((v) => v > 0).length;
  const colors = ['var(--color-border-soft)', '#BFDCD3', '#67A89A', 'var(--color-primary)'];
  return (
    <Card
      eyebrow={`${state.diary.label || 'Headache Days'} · Last 30`}
      right={<span className="mono text-[10px] font-semibold" style={{ color: 'var(--color-ink-2)' }}>{count}/30</span>}
    >
      <div className="grid grid-cols-10 gap-1 mt-3">
        {cells.map((v, i) => (
          <div key={i} className="aspect-square rounded" style={{ background: colors[Math.min(v, 3)] }} />
        ))}
      </div>
      <div className="flex items-center gap-1.5 mt-3">
        <span className="mono text-[9px]" style={{ color: 'var(--color-muted-foreground)' }}>none</span>
        {colors.map((c, i) => (
          <span key={i} className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
        ))}
        <span className="mono text-[9px]" style={{ color: 'var(--color-muted-foreground)' }}>severe</span>
        <span className="ml-auto mono text-[9px]" style={{ color: 'var(--color-muted-foreground)' }}>drafted from patient report</span>
      </div>
    </Card>
  );
}

function PriorVisits({ state }: { state: VisitState }) {
  const { open } = useContext(EvidenceContext);
  const timeline = (state.previsit?.timeline ?? []).filter((n) => n.kind !== 'today');
  const category = (kind: string, label: string): { key: string; color: string } => {
    const l = label.toLowerCase();
    if (kind === 'er_visit' || l.includes('urgent') || l.includes('er ')) return { key: 'ER / UC', color: 'var(--color-warning-strong)' };
    if (l.includes('neuro')) return { key: 'Neurology', color: '#8B5CF6' };
    if (l.includes('mri') || l.includes('imaging') || l.includes('ct')) return { key: 'Imaging', color: '#0EA5E9' };
    if (kind === 'call') return { key: 'Triage', color: 'var(--color-muted-foreground)' };
    if (kind === 'records') return { key: 'Records', color: 'var(--color-muted-foreground)' };
    return { key: 'PCP', color: 'var(--color-primary)' };
  };
  if (timeline.length === 0 && state.history.length === 0) return null;
  return (
    <Card
      eyebrow="Prior Headache Encounters"
      right={<span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>from EMR + outside records</span>}
    >
      <div className="flex flex-col gap-1.5">
        {timeline.length > 0
          ? timeline.map((n, i) => {
              const c = category(n.kind, n.label);
              return (
                <div key={i} className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 border" style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border-soft)' }}>
                  <span className="w-[3px] h-8 rounded-sm flex-none mt-[1px]" style={{ background: c.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12.5px] font-semibold">{n.label}</span>
                      <span
                        className="mono text-[9px] rounded px-1.5 py-[1px] font-semibold uppercase tracking-wider"
                        style={{ background: 'color-mix(in oklab, ' + c.color + ' 15%, transparent)', color: c.color }}
                      >
                        {c.key}
                      </span>
                      <span className="ml-auto mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>{n.date}</span>
                    </div>
                    <div className="text-[11px] mt-[2px]" style={{ color: 'var(--color-ink-3)' }}>{n.sublabel}</div>
                  </div>
                </div>
              );
            })
          : state.history.map((h) => (
              <div
                key={h.id}
                className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 border cursor-pointer"
                style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border-soft)' }}
                onClick={() => open(h.label, [h.id])}
              >
                <span className="w-[3px] h-8 rounded-sm flex-none mt-[1px]" style={{ background: 'var(--color-primary)' }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12.5px] font-semibold">{h.label}</span>
                    <span className="ml-auto mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>{h.date ?? ''}</span>
                  </div>
                  <div className="text-[11px] mt-[2px] truncate" style={{ color: 'var(--color-ink-3)' }}>{h.text}</div>
                </div>
              </div>
            ))}
      </div>
    </Card>
  );
}

/* ---------------- Pain location (read-only, from extracted location fact) ---------------- */

const ZONE_KEYWORDS: Record<string, string[]> = {
  frontal: ['frontal', 'forehead', 'front'],
  retroorbital: ['retro-orbital', 'retroorbital', 'behind the eye', 'eye'],
  temporal: ['temporal', 'temple', 'side of'],
  occipital: ['occipital', 'back of'],
  tmj: ['tmj', 'jaw'],
};

function PainLocationCard({ state }: { state: VisitState }) {
  const loc = factDisplay(state.profile.location);
  if (loc.state === 'unknown') return null;
  const text = loc.text.toLowerCase();
  const zones = Object.entries(ZONE_KEYWORDS)
    .filter(([, kws]) => kws.some((k) => text.includes(k)))
    .map(([z]) => z);
  const selRed = 'rgba(179,38,30,0.85)';
  const refRed = 'rgba(179,38,30,0.14)';
  const isSel = (k: string) => zones.includes(k.replace(/-[lr]$/, ''));

  const zoneCircle = (k: string, cx: number, cy: number, r: number) => {
    const sel = isSel(k);
    return (
      <circle
        key={k + cx}
        cx={cx}
        cy={cy}
        r={r}
        fill={sel ? selRed : refRed}
        stroke={sel ? '#B3261E' : '#C99490'}
        strokeWidth={sel ? 0 : 1.3}
        strokeDasharray={sel ? '0' : '2 2'}
      />
    );
  };

  return (
    <Card
      eyebrow="Patient-Reported Pain Location"
      right={<EvidenceChip ids={state.profile.location.evidence_ids} title="Pain location" />}
    >
      <div className="text-[12.5px] mt-1 leading-[1.45]" style={{ color: 'var(--color-ink-2)' }}>
        Extracted location: <b>{loc.text}</b>
      </div>
      <div className="grid grid-cols-2 gap-5 mt-3">
        <div className="flex flex-col items-center gap-1.5">
          <svg viewBox="0 0 200 240" className="w-full max-w-[210px] h-auto">
            <ellipse cx="100" cy="120" rx="70" ry="95" fill="#F1EFE9" stroke="#D9D6CC" strokeWidth="2" />
            <ellipse cx="30" cy="125" rx="10" ry="18" fill="#F1EFE9" stroke="#D9D6CC" strokeWidth="2" />
            <ellipse cx="170" cy="125" rx="10" ry="18" fill="#F1EFE9" stroke="#D9D6CC" strokeWidth="2" />
            <ellipse cx="75" cy="112" rx="9" ry="6" fill="#FFFFFF" stroke="#B9B4A7" strokeWidth="1.5" />
            <ellipse cx="125" cy="112" rx="9" ry="6" fill="#FFFFFF" stroke="#B9B4A7" strokeWidth="1.5" />
            <circle cx="75" cy="112" r="2.6" fill="#6B7480" />
            <circle cx="125" cy="112" r="2.6" fill="#6B7480" />
            <line x1="100" y1="118" x2="100" y2="142" stroke="#C9C5B9" strokeWidth="1.5" />
            <path d="M83,168 Q100,176 117,168" fill="none" stroke="#C9C5B9" strokeWidth="1.5" />
            {zoneCircle('frontal', 100, 75, 38)}
            {zoneCircle('retroorbital-l', 75, 108, 14)}
            {zoneCircle('retroorbital-r', 125, 108, 14)}
          </svg>
          <span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>Front view</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <svg viewBox="0 0 200 240" className="w-full max-w-[210px] h-auto">
            <ellipse cx="100" cy="120" rx="68" ry="92" fill="#F1EFE9" stroke="#D9D6CC" strokeWidth="2" />
            <ellipse cx="45" cy="128" rx="12" ry="20" fill="#F1EFE9" stroke="#D9D6CC" strokeWidth="2" />
            <polygon points="166,113 180,122 166,132" fill="#F1EFE9" stroke="#D9D6CC" strokeWidth="2" />
            {zoneCircle('temporal', 125, 78, 17)}
            {zoneCircle('tmj', 118, 150, 12)}
            {zoneCircle('occipital', 55, 115, 18)}
          </svg>
          <span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>Side view (facing right)</span>
        </div>
      </div>
    </Card>
  );
}

function AskDuringVisitCard({ state }: { state: VisitState }) {
  const items = (state.previsit?.ask_during_visit?.length ? state.previsit.ask_during_visit : state.missing_questions).slice(0, 4);
  if (items.length === 0) return null;
  return (
    <Card
      eyebrow="Ask During Visit"
      right={<span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>agent-suggested</span>}
    >
      <div className="flex flex-col gap-1.5">
        {items.map((q, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded-lg px-2 py-1.5"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border-soft)' }}
          >
            <span className="mono text-[9px] font-bold rounded px-1.5 py-[1px] flex-none mt-[1px]" style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
              Q{i + 1}
            </span>
            <span className="text-[11.5px] leading-[1.45]" style={{ color: 'var(--color-ink-2)' }}>{q}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Static literature reference — labeled as reference material, not patient data. */
function LocationReferenceCard() {
  const rows = [
    { label: 'Frontal / Forehead', tier: 'most common', op: 0.85, note: 'Most common site in pediatric migraine — often bifrontal.', chip: 'Frontiers Neurol 2019', tone: 'teal' as Tone },
    { label: 'Retro-orbital', tier: 'common', op: 0.65, note: 'Bifrontal–retro-orbital is the predominant pediatric pattern.', chip: 'J Headache Pain 2008', tone: 'teal' as Tone },
    { label: 'Temporal', tier: 'common', op: 0.5, note: 'Second most frequently reported site; often bilateral in younger kids.', chip: 'Cephalalgia 2005', tone: 'teal' as Tone },
    { label: 'Occipital', tier: 'uncommon · screen closely', op: 0.3, note: 'Isolated / new occipital pain warrants closer red-flag screening.', chip: 'ICHD-2 · AAO', tone: 'amber' as Tone },
    { label: 'TMJ / Jaw', tier: 'exam checkpoint', op: 0.2, note: 'Not a primary migraine site — jaw dysfunction can refer to temporal region.', chip: 'Exam checkpoint', tone: 'neutral' as Tone },
  ];
  return (
    <Card
      eyebrow="Common Pediatric Migraine Locations"
      right={<span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>reference · not patient data</span>}
    >
      <div className="flex flex-col gap-3">
        {rows.map((rz, i) => (
          <div key={i} className="flex gap-2.5 items-start">
            <span className="w-2.5 h-2.5 rounded-sm flex-none mt-[2px]" style={{ background: 'var(--color-destructive)', opacity: rz.op }} />
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[12.5px] font-semibold">{rz.label}</span>
                <span className="mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>{rz.tier}</span>
              </div>
              <div className="text-[11.5px] mt-[2px] leading-[1.45]" style={{ color: 'var(--color-ink-3)' }}>{rz.note}</div>
              <div className="mt-1"><Chip tone={rz.tone}>{rz.chip}</Chip></div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- Evidence drawer ---------------- */

const SOURCE_TONE: Record<string, Tone> = {
  transcript: 'teal',
  history: 'neutral',
  vitals: 'teal',
  document: 'neutral',
  guideline: 'amber',
};

function EvidenceDrawer({ title, refs, onClose }: { title: string; refs: EvidenceRef[]; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'oklch(0.2 0.03 260 / 0.25)' }} onClick={onClose} />
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-[380px] flex flex-col"
        style={{ background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)', boxShadow: '-12px 0 40px -12px oklch(0.3 0.08 260 / 0.3)' }}
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
          <div>
            <div className="eyebrow">Evidence</div>
            <div className="text-[13px] font-bold mt-0.5">{title}</div>
          </div>
          <button
            onClick={onClose}
            className="ml-auto cursor-pointer rounded-[7px] px-2.5 py-1 text-[11.5px] font-semibold"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {refs.map((r) => (
            <div key={r.id} className="rounded-[10px] p-3 border" style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border-soft)' }}>
              <div className="flex items-center gap-2">
                <Chip tone={SOURCE_TONE[r.source_type] ?? 'neutral'}>{r.source_type}</Chip>
                <span className="text-[11px] font-semibold" style={{ color: 'var(--color-ink-2)' }}>{r.source_label}</span>
                {r.timestamp && (
                  <span className="ml-auto mono text-[9.5px]" style={{ color: 'var(--color-muted-foreground)' }}>{r.timestamp}</span>
                )}
              </div>
              <div className="text-[12px] mt-2 leading-[1.5] italic" style={{ color: 'var(--color-ink-2)' }}>
                “{r.quote}”
              </div>
              <div className="mono text-[9px] mt-2" style={{ color: 'var(--color-muted-foreground)' }}>{r.id}</div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2.5 text-[10px]" style={{ borderTop: '1px solid var(--color-border-soft)', color: 'var(--color-muted-foreground)' }}>
          Every claim traces to a source — quotes are verbatim from chart or transcript.
        </div>
      </div>
    </>
  );
}
