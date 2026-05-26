export type MemoryLevel = 'system' | 'repo' | 'git-remote';

export interface MemoryConfig {
  storageDir: string;
  backend: string;
  maxEntries?: number;
  ttlDays?: number;
  autoInject?: boolean;
  recording?: { enabled: boolean };
}

// ── Explore-cache types ───────────────────────────────────────────────────────

export interface ExploreCacheStats {
  rawCount: number;
  consolidatedExists: boolean;
  consolidatedCount: number;
  lastAggregation: string | null;
}

export interface ExploreCacheRepoEntry extends ExploreCacheStats {
  hash: string;
  path?: string;
  name?: string;
  remoteUrl?: string;
}

export interface ExploreCacheGitRemoteEntry extends ExploreCacheStats {
  hash: string;
  remoteUrl?: string;
  name?: string;
}

export interface ExploreCacheLevelsOverview {
  system: ExploreCacheStats;
  repos: ExploreCacheRepoEntry[];
  gitRemotes: ExploreCacheGitRemoteEntry[];
}

export interface ExploreCacheRawListResponse {
  level: MemoryLevel;
  hash?: string;
  files: string[];
}

export interface ToolCallQAEntry {
  id: string;
  toolName: string;
  question: string;
  answer: string;
  args: Record<string, unknown>;
  gitHash?: string;
  timestamp: string;
}

export interface ConsolidatedIndexEntry {
  id: string;
  question: string;
  topics: string[];
  toolSources: string[];
  createdAt: string;
  hitCount: number;
  gitHash?: string;
}

export interface ExploreCacheConsolidatedListResponse {
  level: MemoryLevel;
  hash?: string;
  entries: ConsolidatedIndexEntry[];
}

export interface ConsolidatedEntryWithAnswer extends ConsolidatedIndexEntry {
  answer: string;
}

export interface ToolCallCacheStats {
  rawCount: number;
  consolidatedCount: number;
  consolidatedExists: boolean;
  lastAggregation: string | null;
}

export interface AggregateToolCallsResponse {
  aggregated?: boolean;
  rawCount: number;
  consolidatedCount: number;
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
