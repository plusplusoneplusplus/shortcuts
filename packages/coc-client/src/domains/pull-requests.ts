import type {
  ProviderConfigRequest,
  SanitizedProviderConfigResponse,
} from '../contracts';
import type { RequestAdapter } from '../types';

export class PullRequestsClient {
  constructor(private readonly transport: RequestAdapter) {}

  getProviderConfig(): Promise<SanitizedProviderConfigResponse> {
    return this.transport.request<SanitizedProviderConfigResponse>('/providers/config');
  }

  saveProviderConfig(config: ProviderConfigRequest): Promise<void> {
    return this.transport.request<void>('/providers/config', {
      method: 'PUT',
      body: { ...config },
    });
  }
}
