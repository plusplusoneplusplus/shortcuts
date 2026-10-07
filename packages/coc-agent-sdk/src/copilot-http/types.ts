import type { TokenUsage } from '../types';

export type CopilotWireApi = 'chat-completions' | 'responses';
export interface CopilotCredentialSnapshot {
    token: string;
    host: string;
    login: string;
}
export type CopilotCredentialConfig =
    | { source: 'copilot-cli' }
    | { source: 'environment'; variable: string; host?: string; login?: string }
    | { source: 'resolver'; resolve: (signal: AbortSignal) => Promise<CopilotCredentialSnapshot> }
    | { source: 'cli-config'; account: 'active-cli-account' | { host: string; login: string }; configPath?: string }
    | { source: 'gh-cli'; host: string; login: string }
    | { source: 'keychain'; host: string; login: string };

export interface CopilotModelBinding {
    api: CopilotWireApi;
    reportedModels: readonly string[];
    outputLimitField: 'max_tokens' | 'max_completion_tokens' | 'max_output_tokens';
    jsonSchema?: boolean;
    reasoningEfforts?: readonly string[];
}
export interface CopilotCompletionInput {
    model: string;
    api: CopilotWireApi;
    messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[];
    maxOutputTokens?: number;
    jsonSchema?: { name: string; schema: Record<string, unknown>; strict: boolean };
    reasoningEffort?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface CopilotCompletionDiagnostics {
    transport: 'direct';
    api: CopilotWireApi;
    reportedModel: string;
    durationMs: number;
    requestId?: string;
    usageUnavailableReason?: string;
    /** Known totals remain useful when shared TokenUsage cannot represent missing cache counts. */
    tokenCounts?: Pick<TokenUsage, 'inputTokens' | 'outputTokens' | 'totalTokens' | 'turnCount'>
        & Partial<Pick<TokenUsage, 'cacheReadTokens' | 'cacheWriteTokens'>>;
    catalogEndpointMetadata: 'advertised' | 'unknown';
    totalNanoAiu?: number;
    cacheHit: boolean;
    timings: { credentialMs: number; catalogMs: number; inferenceMs: number };
}
export interface CopilotCompletionResult {
    text: string;
    requestedModel: string;
    effectiveModel: string;
    tokenUsage?: TokenUsage;
    diagnostics: CopilotCompletionDiagnostics;
}
export interface CopilotHttpConfig {
    credential: CopilotCredentialConfig;
    endpoint?: string;
    bindings?: Readonly<Record<string, CopilotModelBinding>>;
    /** Per-client network adapter; never changes the global dispatcher. */
    fetch?: typeof fetch;
    /** Embedding/test policy. Must explicitly authorize the endpoint before credentials are read. */
    endpointPolicy?: (endpoint: URL) => boolean;
    now?: () => number;
}
export interface CopilotProviderConfig {
    transformTransport?: 'sdk' | 'direct';
    direct?: CopilotHttpConfig;
}
