import type { EnabledModelsResponse, ModelInfo } from '../contracts';
import type { RequestAdapter } from '../types';

export class ModelsClient {
  constructor(private readonly transport: RequestAdapter) {}

  list(): Promise<ModelInfo[]> {
    return this.transport.request<ModelInfo[]>('/models');
  }

  getEnabled(): Promise<EnabledModelsResponse> {
    return this.transport.request<EnabledModelsResponse>('/models/enabled');
  }

  setEnabled(enabledModels: string[]): Promise<EnabledModelsResponse> {
    return this.transport.request<EnabledModelsResponse>('/models/enabled', {
      method: 'PUT',
      body: { enabledModels: [...enabledModels] },
    });
  }
}
