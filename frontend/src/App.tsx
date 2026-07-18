/**
 * Placeholder harness proving backend wiring end-to-end.
 * Will be replaced by the Claude Design dashboard — components should consume
 * `VisitState` from src/types/bridge.ts via `api` in src/lib/api.ts.
 */

import { useEffect, useState } from 'react';
import { api } from './lib/api';
import type { AskResponse, CaseSummary, VisitState } from './types/bridge';

export default function App() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [state, setState] = useState<VisitState | null>(null);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listCases().then(setCases).catch((e) => setError(String(e)));
  }, []);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, maxWidth: 900 }}>
      <h1>Bridge — API wiring harness</h1>
      <p>Temporary screen. Real dashboard comes from Claude Design.</p>
      {error && <pre style={{ color: 'crimson' }}>{error}</pre>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        {cases.map((c) => (
          <button
            key={c.case_id}
            disabled={busy}
            onClick={run(async () => {
              setAnswer(null);
              setState(await api.openCase(c.case_id));
            })}
          >
            Open {c.title}
          </button>
        ))}
        {state && (
          <>
            <button
              disabled={busy || state.chunks_processed >= state.chunks_total}
              onClick={run(async () => {
                const res = await api.advanceChunk(state.visit_id);
                setState(res.state);
              })}
            >
              Next chunk ({state.chunks_processed}/{state.chunks_total})
            </button>
            <button
              disabled={busy}
              onClick={run(async () => setState(await api.completeVisit(state.visit_id)))}
            >
              Complete visit
            </button>
            <button
              disabled={busy}
              onClick={run(async () =>
                setAnswer(await api.ask(state.visit_id, 'What did the family report about school impact?')),
              )}
            >
              Ask (school impact)
            </button>
            <a href={api.pdfUrl(state.visit_id)} target="_blank" rel="noreferrer">
              <button disabled={busy}>Export PDF</button>
            </a>
          </>
        )}
      </div>

      {state && (
        <p>
          <b>{state.patient.name}</b> · {state.mode} · phase: {state.phase} · agent:{' '}
          <i>{state.agent_status}</i> · PedMIDAS: {state.pedmidas.completion}
          {state.pedmidas.score != null && ` (score ${state.pedmidas.score})`}
        </p>
      )}
      {answer && (
        <pre style={{ background: '#f1f5f9', padding: 12 }}>{JSON.stringify(answer, null, 2)}</pre>
      )}
      {state && (
        <details open>
          <summary>VisitState JSON</summary>
          <pre style={{ background: '#f8fafc', padding: 12, fontSize: 11 }}>
            {JSON.stringify(state, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
