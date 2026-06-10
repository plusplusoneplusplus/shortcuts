import type { ChatProvider, ReasoningEffort } from './common';
import type { QueueTaskSummary } from './queue';

export const DREAM_CARD_CATEGORIES = [
  'skill-or-prompt-improvement',
  'user-workflow-suggestion',
  'product-improvement',
] as const;

export type DreamCardCategory = typeof DREAM_CARD_CATEGORIES[number];

export const DREAM_CARD_STATUSES = [
  'candidate',
  'visible',
  'approved',
  'dismissed',
  'converted',
  'superseded',
] as const;

export type DreamCardStatus = typeof DREAM_CARD_STATUSES[number];

export type DreamRunStatus = 'running' | 'completed' | 'failed';
export type DreamRunTrigger = 'manual' | 'idle';

export interface DreamSourceRange {
  processId: string;
  startTurnIndex: number;
  endTurnIndex: number;
}

export const DREAM_CONVERSION_ARTIFACT_TYPES = [
  'skill-hardening-task',
  'note',
  'memory',
  'work-item',
  'other',
] as const;

export type DreamConversionArtifactType = typeof DREAM_CONVERSION_ARTIFACT_TYPES[number];

export interface DreamConversionLink {
  artifactType: DreamConversionArtifactType;
  artifactId: string;
  artifactUrl?: string;
  createdAt: string;
}

export interface DreamCard {
  id: string;
  workspaceId: string;
  runId?: string;
  category: DreamCardCategory;
  status: DreamCardStatus;
  sourceRanges: DreamSourceRange[];
  observedPattern: string;
  whyItMatters: string;
  recommendation: string;
  expectedImpact: string;
  confidence: number;
  dedupFingerprint: string;
  notAlreadyCoveredRationale: string;
  criticRationale?: string;
  dedupRationale?: string;
  supersededByCardId?: string;
  conversion?: DreamConversionLink;
  createdAt: string;
  updatedAt: string;
  visibleAt?: string;
  approvedAt?: string;
  dismissedAt?: string;
  convertedAt?: string;
  supersededAt?: string;
}

export interface DreamRunRecord {
  id: string;
  workspaceId: string;
  trigger: DreamRunTrigger;
  status: DreamRunStatus;
  sourceRanges: DreamSourceRange[];
  candidateCardIds: string[];
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
}

export interface ListDreamCardsOptions {
  includeHidden?: boolean;
  statuses?: DreamCardStatus | DreamCardStatus[];
}

export interface ListDreamCardsResponse {
  cards: DreamCard[];
}

export interface DreamCardResponse {
  card: DreamCard;
}

export interface DreamRunRequest {
  provider?: ChatProvider;
  config?: {
    model?: string;
    reasoningEffort?: ReasoningEffort;
  };
  confidenceThreshold?: number;
  maxCandidates?: number;
  conversationLimit?: number;
  timeoutMs?: number;
}

export interface DreamConversationSelectionSummary {
  workspaceId: string;
  conversationCount: number;
  scannedProcessCount: number;
  skipped: {
    wrongWorkspace: number;
    nonCompleted: number;
    archived: number;
    missingProcess: number;
    noVisibleTurns: number;
    fullyCovered: number;
  };
}

export interface DreamAnalysisSummary {
  sourceRanges: DreamSourceRange[];
  rawCandidateCount: number;
  deterministicCandidateCount: number;
  acceptedCandidateCount: number;
  rejectedCandidateCount: number;
}

export interface DreamRunResponse {
  task: QueueTaskSummary;
}

export interface DismissDreamCardRequest {
  dedupRationale?: string;
}

export interface ConvertDreamCardRequest {
  artifactType: DreamConversionArtifactType;
  artifactId: string;
  artifactUrl?: string;
}

export interface SupersedeDreamCardRequest {
  supersededByCardId?: string;
  dedupRationale: string;
}
