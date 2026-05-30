export interface MemoryConfig {
  storageDir: string;
  backend: string;
  maxEntries?: number;
  ttlDays?: number;
  autoInject?: boolean;
  recording?: { enabled: boolean };
}

export type MemoryScope = 'global' | 'workspace';

export type MemoryFactStatus = 'active' | 'review' | 'rejected' | 'archived';

export type MemoryFactSource = 'explicit' | 'auto-extracted' | 'imported';

export interface MemoryFact {
  id: string;
  scope: MemoryScope;
  workspaceId?: string;
  content: string;
  importance: number;
  confidence: number;
  status: MemoryFactStatus;
  tags: string[];
  source: MemoryFactSource;
  sourceProcessId?: string;
  sourceTurnIndex?: number;
  sourceRalphIteration?: number;
  createdAt: string;
  updatedAt: string;
  recalledCount: number;
  lastRecalledAt?: string;
}

export type MemoryEpisodeEventType = 'chat-turn' | 'ralph-iteration' | 'note-session' | 'commit-chat';

export interface MemoryProvenance {
  createdBy: 'user' | 'ai' | 'system';
  extractedFrom?: string;
  model?: string;
  version: number;
}

export interface MemoryEpisode {
  id: string;
  scope: MemoryScope;
  workspaceId?: string;
  processId: string;
  sessionId?: string;
  ralphId?: string;
  turnIndex?: number;
  iterationIndex?: number;
  summary: string;
  eventType: MemoryEpisodeEventType;
  createdAt: string;
  provenance: MemoryProvenance;
}

export interface MemoryV2ExportData {
  version: number;
  exportedAt: string;
  scope: MemoryScope;
  workspaceId?: string;
  facts: MemoryFact[];
  episodes: MemoryEpisode[];
}

export interface ListFactsOptions {
  q?: string;
  status?: MemoryFactStatus | MemoryFactStatus[];
  limit?: number;
}

// ── Memory V2 Scope types ─────────────────────────────────────────────────────

export interface MemoryScopeCounts {
  activeFacts: number;
  reviewFacts: number;
  episodes: number;
}

export interface MemoryScopeInfo {
  id: string;
  type: 'global' | 'workspace';
  label: string;
  enabled: boolean;
  workspaceId?: string;
  counts: MemoryScopeCounts;
}

export interface MemoryScopesResponse {
  scopes: MemoryScopeInfo[];
}
