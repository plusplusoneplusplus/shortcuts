export type CopilotDirectErrorCode =
    | 'DIRECT_CONFIG_INVALID' | 'DIRECT_NOT_ELIGIBLE' | 'DIRECT_CREDENTIAL_UNAVAILABLE'
    | 'DIRECT_UNSUPPORTED_HOST' | 'DIRECT_UNSUPPORTED_MODEL' | 'DIRECT_AUTH_FAILED'
    | 'DIRECT_POLICY_DENIED' | 'DIRECT_RATE_LIMITED' | 'DIRECT_TIMEOUT' | 'DIRECT_CANCELLED'
    | 'DIRECT_UPSTREAM_FAILED' | 'DIRECT_INVALID_RESPONSE' | 'DIRECT_MODEL_MISMATCH';

export class CopilotDirectError extends Error {
    constructor(
        public readonly code: CopilotDirectErrorCode,
        message: string,
        public inferenceDispatched = false,
        public requestId?: string,
    ) {
        super(message);
        this.name = 'CopilotDirectError';
    }
}

/** Never expose third-party exception text (it may contain a token or prompt). */
export function directError(error: unknown): CopilotDirectError {
    return error instanceof CopilotDirectError ? error
        : new CopilotDirectError('DIRECT_UPSTREAM_FAILED', 'Copilot HTTP request failed.');
}
export function safeRequestId(value: string | null): string | undefined {
    return value && /^[a-zA-Z0-9:_-]{1,128}$/.test(value) && !/^(gho_|ghu_|github_pat_|ghp_)/.test(value) ? value : undefined;
}
