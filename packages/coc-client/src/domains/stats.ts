import type { TokenUsageStatsQuery, TokenUsageStatsResponse } from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';

function serializeTokenUsageQuery(query?: TokenUsageStatsQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return { days: query.days };
}

export class StatsClient {
  constructor(private readonly transport: RequestAdapter) {}

  tokenUsage(query?: TokenUsageStatsQuery): Promise<TokenUsageStatsResponse> {
    return this.transport.request<TokenUsageStatsResponse>('/stats/token-usage', {
      query: serializeTokenUsageQuery(query),
    });
  }
}
