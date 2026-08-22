export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  turnCount: number;
  cost?: number;
  actualUsdCost?: number;
  estimatedUsdCost?: number;
  displayedUsdCost?: number;
  displayedUsdCostSource?: 'native' | 'estimated' | 'mixed';
  costBreakdown?: {
    inputUsd: number;
    cachedInputUsd: number;
    cacheWriteUsd: number;
    outputUsd: number;
  };
  pricingSource?: string;
  pricingUnavailable?: boolean;
  duration?: number;
  tokenLimit?: number;
  currentTokens?: number;
  systemTokens?: number;
  toolDefinitionsTokens?: number;
  conversationTokens?: number;
}

export interface TokenUsageStatsEntry {
  date: string;
  byModel: Record<string, TokenUsage>;
  dayTotal: TokenUsage;
}

export interface TokenUsageStatsResponse {
  entries: TokenUsageStatsEntry[];
  models: string[];
  generatedAt: string;
  totalDays: number;
}

export interface TokenUsageStatsQuery {
  days?: number;
}

export type TurnPerformanceGroupBy =
  | 'provider'
  | 'model'
  | 'workspace'
  | 'kind'
  | 'turnIndex'
  | 'day';

export interface TurnPerformanceDistribution {
  p50: number | null;
  p90: number | null;
  p99: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  n: number;
}

export interface TurnPerformanceGroup {
  key: Record<string, string | number>;
  turnCount: number;
  ttftMs: TurnPerformanceDistribution;
  tpsGeneration: TurnPerformanceDistribution;
  tpsWall: TurnPerformanceDistribution;
  outputTokens: number;
}

export interface TurnPerformanceStatsResponse {
  groups: TurnPerformanceGroup[];
  groupBy: TurnPerformanceGroupBy[];
  days: number | null;
  totalEvents: number;
  excludedEvents: {
    nonCompleted: number;
    noFirstToken: number;
    noTokenUsage: number;
  };
  generatedAt: string;
}

export interface TurnPerformanceStatsQuery {
  days?: number;
  groupBy?: TurnPerformanceGroupBy | TurnPerformanceGroupBy[];
  firstTurnOnly?: boolean;
  processId?: string;
}
