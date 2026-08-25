export type JsonObject = Record<string, unknown>;

export type ChatProvider = 'copilot' | 'codex' | 'claude' | 'opencode';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

/**
 * How a chat response is written. Style controls presentation only — never the
 * provider, model, reasoning effort, tools, or permission mode.
 *
 * `'default'` is a real, first-class wire value rather than the absence of one:
 * it means "add no style instruction at all", and it is representable in the
 * payload and in `process.metadata.chatStyle` so that switching *to* Default is
 * distinguishable from never having chosen a style.
 *
 * This file is the single source of truth for the values — nothing else may
 * re-list them.
 */
export type ChatStyle = 'default' | 'human' | 'direct' | 'analytical' | 'structured';

/** Stable wire values for {@link ChatStyle}, in display order (Default first). */
export const CHAT_STYLES: readonly ChatStyle[] = ['default', 'human', 'direct', 'analytical', 'structured'];

/** Style a new conversation starts on, and the value an omitted field means. */
export const DEFAULT_CHAT_STYLE: ChatStyle = 'default';

/** Display labels for {@link ChatStyle}, keyed by wire value. */
export const CHAT_STYLE_LABELS: Readonly<Record<ChatStyle, string>> = {
  default: 'Default',
  human: 'Human',
  direct: 'Direct',
  analytical: 'Analytical',
  structured: 'Structured',
};

/** Runtime guard for the stable {@link ChatStyle} wire values. */
export function isChatStyle(value: unknown): value is ChatStyle {
  return typeof value === 'string' && (CHAT_STYLES as readonly string[]).includes(value);
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  hasMore?: boolean;
}

export interface NativeCapabilityStatus {
  loaded: boolean;
  binaryPath?: string;
  reason?: string;
}

export interface HealthResponse {
  status: 'ok' | string;
  uptime: number;
  processCount: number;
  nativeFileIndex: NativeCapabilityStatus;
  nativeNotesIndex: NativeCapabilityStatus;
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
