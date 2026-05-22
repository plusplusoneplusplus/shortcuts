import type { EnabledModelsResponse, ModelInfo, ReasoningEffortsResponse } from '../contracts';
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

  getReasoningEfforts(): Promise<ReasoningEffortsResponse> {
    return this.transport.request<ReasoningEffortsResponse>('/models/reasoning-efforts');
  }

  setReasoningEffort(modelId: string, effort: string): Promise<ReasoningEffortsResponse> {
    return this.transport.request<ReasoningEffortsResponse>('/models/reasoning-efforts', {
      method: 'PUT',
      body: { modelId, effort },
    });
  }
}
