import type {
  TokenUsageStatsQuery,
  TokenUsageStatsResponse,
  TurnPerformanceStatsQuery,
  TurnPerformanceStatsResponse,
} from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';

function serializeTokenUsageQuery(query?: TokenUsageStatsQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return { days: query.days };
}

function serializeTurnPerformanceQuery(
  query?: TurnPerformanceStatsQuery
): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    days: query.days,
    groupBy: query.groupBy,
    firstTurnOnly: query.firstTurnOnly ? 1 : undefined,
    processId: query.processId,
  };
}

export class StatsClient {
  constructor(private readonly transport: RequestAdapter) {}

  tokenUsage(query?: TokenUsageStatsQuery): Promise<TokenUsageStatsResponse> {
    return this.transport.request<TokenUsageStatsResponse>('/stats/token-usage', {
      query: serializeTokenUsageQuery(query),
    });
  }

  turnPerformance(query?: TurnPerformanceStatsQuery): Promise<TurnPerformanceStatsResponse> {
    return this.transport.request<TurnPerformanceStatsResponse>('/stats/turn-performance', {
      query: serializeTurnPerformanceQuery(query),
    });
  }
}
