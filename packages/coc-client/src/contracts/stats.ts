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
