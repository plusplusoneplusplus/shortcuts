import type { AgentProvidersResponse, ProviderInstallStatus } from '../contracts';
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
}
