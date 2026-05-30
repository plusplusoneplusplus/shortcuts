import type {
  AgentProvidersResponse,
  ProviderInstallStatus,
  ProviderModelsResponse,
  ProviderEnabledModelsResponse,
  ProviderReasoningEffortsResponse,
  ProviderEffortTiersResponse,
  ModelQueryRequest,
  ProviderModelQueryResponse,
} from '../contracts';
import type { RequestAdapter } from '../types';

export interface ProviderInstallStatusResponse {
  status: ProviderInstallStatus;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface ProviderInstallResponse {
  status: string;
  message?: string;
}

export class AgentProvidersClient {
  constructor(private readonly transport: RequestAdapter) {}

  list(): Promise<AgentProvidersResponse> {
    return this.transport.request<AgentProvidersResponse>('/agent-providers');
  }

  /**
   * Returns the current SDK install status for the given optional provider
   * ('codex' or 'claude').
   */
  getProviderInstallStatus(provider: string): Promise<ProviderInstallStatusResponse> {
    return this.transport.request<ProviderInstallStatusResponse>(
      `/providers/sdk/${encodeURIComponent(provider)}/install-status`,
    );
  }

  /**
   * Triggers an on-demand npm install of the optional SDK package for the
   * given provider ('codex' or 'claude').  Returns 202 when install starts,
   * or 200 when the package is already installed.
   */
  installProvider(provider: string): Promise<ProviderInstallResponse> {
    return this.transport.request<ProviderInstallResponse>(
      `/providers/sdk/${encodeURIComponent(provider)}/install`,
      { method: 'POST' },
    );
  }

  listModels(provider: string): Promise<ProviderModelsResponse> {
    return this.transport.request<ProviderModelsResponse>(
      `/agent-providers/${encodeURIComponent(provider)}/models`,
    );
  }

  getEnabledModels(provider: string): Promise<ProviderEnabledModelsResponse> {
    return this.transport.request<ProviderEnabledModelsResponse>(
      `/agent-providers/${encodeURIComponent(provider)}/models/enabled`,
    );
  }

  setEnabledModels(provider: string, enabledModels: string[]): Promise<ProviderEnabledModelsResponse> {
    return this.transport.request<ProviderEnabledModelsResponse>(
      `/agent-providers/${encodeURIComponent(provider)}/models/enabled`,
      { method: 'PUT', body: { enabledModels: [...enabledModels] } },
    );
  }

  getReasoningEfforts(provider: string): Promise<ProviderReasoningEffortsResponse> {
    return this.transport.request<ProviderReasoningEffortsResponse>(
      `/agent-providers/${encodeURIComponent(provider)}/models/reasoning-efforts`,
    );
  }

  setReasoningEffort(provider: string, modelId: string, effort: string): Promise<ProviderReasoningEffortsResponse> {
    return this.transport.request<ProviderReasoningEffortsResponse>(
      `/agent-providers/${encodeURIComponent(provider)}/models/reasoning-efforts`,
      { method: 'PUT', body: { modelId, effort } },
    );
  }

  getEffortTiers(provider: string): Promise<ProviderEffortTiersResponse> {
    return this.transport.request<ProviderEffortTiersResponse>(
      `/agent-providers/${encodeURIComponent(provider)}/effort-tiers`,
    );
  }

  setEffortTier(
    provider: string,
    tier: 'low' | 'medium' | 'high',
    model: string,
    reasoningEffort?: string | null,
  ): Promise<ProviderEffortTiersResponse> {
    return this.transport.request<ProviderEffortTiersResponse>(
      `/agent-providers/${encodeURIComponent(provider)}/effort-tiers`,
      { method: 'PUT', body: { tier, model, reasoningEffort: reasoningEffort ?? null } },
    );
  }

  queryModel(provider: string, request: ModelQueryRequest): Promise<ProviderModelQueryResponse> {
    return this.transport.request<ProviderModelQueryResponse>(
      `/agent-providers/${encodeURIComponent(provider)}/models/query`,
      { method: 'POST', body: request },
    );
  }
}
