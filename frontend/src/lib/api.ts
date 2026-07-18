/** Typed client for the Bridge backend. One function per endpoint. */

import type {
  AskResponse,
  CaseSummary,
  ChunkAdvanceResponse,
  VisitState,
} from '../types/bridge';

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';

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

  /** Processes the next transcript chunk; response contains the full updated state. */
  advanceChunk: (visitId: string) =>
    request<ChunkAdvanceResponse>(`/visits/${visitId}/transcript-chunk`, {
      method: 'POST',
    }),

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
