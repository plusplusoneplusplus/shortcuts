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

export interface ReasoningEffortsResponse {
  reasoningEfforts: Record<string, string>;
}

export interface ModelQueryRequest {
  prompt: string;
  model?: string;
  timeoutMs?: number;
}

export interface ModelQueryResponse {
  success: boolean;
  response?: string;
  error?: string;
  model?: string;
  sessionId?: string;
  durationMs: number;
}

/** Response from GET /api/agent-providers/:provider/models */
export interface ProviderModelsResponse {
  provider: string;
  models: ModelInfo[];
}

/** Response from GET /api/agent-providers/:provider/models/enabled */
export interface ProviderEnabledModelsResponse {
  provider: string;
  enabledModels: string[];
}

/** Response from GET /api/agent-providers/:provider/models/reasoning-efforts */
export interface ProviderReasoningEffortsResponse {
  provider: string;
  reasoningEfforts: Record<string, string>;
}

/** Response from POST /api/agent-providers/:provider/models/query */
export interface ProviderModelQueryResponse {
  success: boolean;
  provider: string;
  response?: string;
  error?: string;
  model?: string;
  sessionId?: string;
  durationMs: number;
}
