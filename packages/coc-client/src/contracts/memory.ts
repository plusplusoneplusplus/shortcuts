import type { JsonObject } from './common';

export type MemoryBackend = 'file' | 'sqlite' | 'vector';
export type MemoryLevel = 'system' | 'repo' | 'git-remote';
export type MemoryPromoteTarget = 'memory' | 'system';

export interface MemoryConfig {
  storageDir: string;
  backend: MemoryBackend;
  maxEntries?: number;
  ttlDays?: number;
  autoInject?: boolean;
  recording?: { enabled: boolean };
}

export interface MemoryStats {
  charCount: number;
  charLimit: number;
  lastModified: string | null;
  pendingRawCount: number;
  claimedRawCount: number;
  consolidatedAt: string | null;
  promotionStatus?: 'idle' | 'queued' | 'running';
  promotionTaskId?: string;
  promotionProcessId?: string;
  lastPromotedAt?: string | null;
  lastPromotionError?: string | null;
  consolidationStatus?: 'idle' | 'queued' | 'running';
  consolidationTaskId?: string;
  consolidationProcessId?: string;
  lastAggregatedAt?: string | null;
  lastAggregateError?: string | null;
}

export type MemoryOverviewResponse = MemoryStats;

export interface BoundedMemoryResponse {
  content: string;
  charCount: number;
  charLimit: number;
  lastModified: string | null;
}

export interface BoundedMemorySaveResponse {
  charCount: number;
  charLimit: number;
  lastModified: string | null;
}

export interface MemoryLevelCharStats {
  charCount: number;
  charLimit: number;
  lastModified: string | null;
}

export interface MemoryLevelsOverviewEntry extends MemoryLevelCharStats {
  hash: string;
}

export interface BoundedMemoryLevelsOverview {
  system: MemoryLevelCharStats;
  repos: MemoryLevelsOverviewEntry[];
  gitRemotes: MemoryLevelsOverviewEntry[];
}

export interface BoundedMemoryDeleteResponse {
  success: true;
}

export interface RepoMemoryDeleteResponse {
  success: boolean;
}

export interface MemoryPromoteResponse {
  taskId: string;
  processId: string | null;
  operation?: 'promotion';
  status: string;
}

export interface MemoryPromoteRequest {
  model?: string;
  target?: MemoryPromoteTarget | string;
}

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
  args: JsonObject;
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
