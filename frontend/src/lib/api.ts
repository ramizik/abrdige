/** Typed client for the Bridge backend. One function per endpoint. */

import type {
  AnalyzeResponse,
  AskResponse,
  CaseSummary,
  ChunkAdvanceResponse,
  VisitState,
} from '../types/bridge';

export const API_BASE =
  import.meta.env.VITE_API_BASE ??
  (import.meta.env.PROD ? '/api' : 'http://localhost:8000');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  listCases: () => request<CaseSummary[]>('/cases'),

  /** Opens a case and creates a visit; returns initial VisitState. */
  openCase: (caseId: string) => request<VisitState>(`/cases/${caseId}`),

  /**
   * Processes the next transcript chunk; response contains the full updated state.
   * extract=false appends raw transcript only (STT simulation) — pair with analyze().
   */
  advanceChunk: (visitId: string, extract = true) =>
    request<ChunkAdvanceResponse>(
      `/visits/${visitId}/transcript-chunk?extract=${extract}`,
      { method: 'POST' },
    ),

  /** Mid-visit "Analyze" button: real Agent SDK pipeline over history + transcript so far. */
  analyze: (visitId: string) =>
    request<AnalyzeResponse>(`/visits/${visitId}/analyze`, { method: 'POST' }),

  completeVisit: (visitId: string) =>
    request<VisitState>(`/visits/${visitId}/complete`, { method: 'POST' }),

  ask: (visitId: string, question: string) =>
    request<AskResponse>(`/visits/${visitId}/ask`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

  /** URL for the end-of-visit PDF (open in new tab or iframe). */
  pdfUrl: (visitId: string) => `${API_BASE}/visits/${visitId}/export.pdf`,
};
