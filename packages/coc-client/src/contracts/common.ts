export type JsonObject = Record<string, unknown>;

export type ChatProvider = 'copilot' | 'codex' | 'claude' | 'opencode';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

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

/** Long-context tier pricing metadata for models with tiered context windows. */
export interface ModelBillingTokenPricesLongContext {
  /** Maximum prompt/context tokens available on the long-context tier. */
  contextMax?: number;
  [key: string]: unknown;
}

/** Tiered token pricing metadata attached to a model's billing info. */
export interface ModelBillingTokenPrices {
  longContext?: ModelBillingTokenPricesLongContext;
  [key: string]: unknown;
}

/** Billing metadata for a model. */
export interface ModelBilling {
  multiplier?: number;
  tokenPrices?: ModelBillingTokenPrices;
  [key: string]: unknown;
}

export interface ModelInfo {
  id: string;
  name?: string;
  label?: string;
  enabled?: boolean;
  capabilities?: JsonObject;
  /** Billing metadata, including long-context tier support (tokenPrices.longContext.contextMax). */
  billing?: ModelBilling;
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

/** A single effort-tier entry: model + optional reasoning effort. */
export interface EffortTierEntry {
  model: string;
  reasoningEffort?: string | null;
  /**
   * Where this tier came from. `'config'` means the admin saved it (stored
   * config wins); `'default'` means the hardcoded provider default is being
   * surfaced because no config exists for this tier.
   */
  source?: 'config' | 'default';
}

/** Response from GET/PUT /api/agent-providers/:provider/effort-tiers */
export interface ProviderEffortTiersResponse {
  provider: string;
  effortTiers: Partial<Record<'low' | 'medium' | 'high', EffortTierEntry>>;
  /**
   * Hardcoded provider defaults that fill any unset tier (or that the client
   * can revert to when clearing a configured tier). Empty `{}` for unknown
   * providers.
   */
  defaults: Partial<Record<'low' | 'medium' | 'high', { model: string; reasoningEffort: string | null }>>;
}
