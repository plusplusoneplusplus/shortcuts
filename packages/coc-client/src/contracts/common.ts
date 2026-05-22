export type JsonObject = Record<string, unknown>;

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  hasMore?: boolean;
}

export interface HealthResponse {
  status: 'ok' | string;
  uptime: number;
  processCount: number;
}

export interface OpenApiDocument extends JsonObject {}

export interface ModelInfo {
  id: string;
  name?: string;
  label?: string;
  enabled?: boolean;
  capabilities?: JsonObject;
  /** Reasoning efforts the model accepts (e.g. ['low','medium','high','xhigh']). Empty/undefined when unknown. */
  supportedReasoningEfforts?: string[];
  /** Default reasoning effort the model picks when none is requested. */
  defaultReasoningEffort?: string;
  [key: string]: unknown;
}

export interface EnabledModelsResponse {
  enabledModels: string[];
}
