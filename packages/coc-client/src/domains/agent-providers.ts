import type { AgentProvidersResponse } from '../contracts';
import type { RequestAdapter } from '../types';

export class AgentProvidersClient {
  constructor(private readonly transport: RequestAdapter) {}

  list(): Promise<AgentProvidersResponse> {
    return this.transport.request<AgentProvidersResponse>('/agent-providers');
  }
}
