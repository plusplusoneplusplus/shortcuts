import { randomUUID } from 'node:crypto';
import { CopilotDirectError, safeRequestId } from './errors';

export const COPILOT_HTTP_PROFILE = Object.freeze({
    'Accept': 'application/json', 'Content-Type': 'application/json',
    'Copilot-Integration-Id': 'copilot-developer-cli',
    'Editor-Version': 'copilot/1.0.78', 'User-Agent': 'copilot/1.0.78',
    'Openai-Intent': 'conversation-agent', 'X-GitHub-Api-Version': '2026-07-01',
    // Initial compatibility profile matches the verified CLI user-initiated experiment.
    'X-Initiator': 'user', 'X-Interaction-Type': 'conversation-user',
});
export const MAX_DIRECT_REQUEST_BYTES = 2 * 1024 * 1024;
export const MAX_DIRECT_RESPONSE_BYTES = 8 * 1024 * 1024;
export function allowedCopilotEndpoint(url: URL): boolean {
    return url.protocol === 'https:' && !url.port && !url.username && !url.password
        && !url.search && !url.hash && url.pathname === '/'
        && ['api.githubcopilot.com', 'api.enterprise.githubcopilot.com'].includes(url.hostname);
}
/** Race non-cooperative readers too; the underlying HTTP uses the same signal. */
export async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try { return await Promise.race([promise, aborted]); }
    finally { signal.removeEventListener('abort', onAbort); }
}
export async function requestJson(fetcher: typeof fetch, url: string, token: string, signal: AbortSignal, body?: string) {
    signal.throwIfAborted();
    const response = await fetcher(url, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
        headers: { ...COPILOT_HTTP_PROFILE, Authorization: `Bearer ${token}`, 'X-Interaction-Id': randomUUID() }, body,
    });
    const requestId = safeRequestId(response.headers.get('x-github-request-id') ?? response.headers.get('x-request-id'));
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
        if (!response.body) throw new CopilotDirectError('DIRECT_INVALID_RESPONSE', 'Copilot returned no response body.');
        const reader = response.body.getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > MAX_DIRECT_RESPONSE_BYTES) {
                    await reader.cancel();
                    throw new CopilotDirectError('DIRECT_INVALID_RESPONSE', 'Copilot response exceeds the buffer limit.');
                }
                chunks.push(value);
            }
        } finally { reader.releaseLock(); }
        let data: any;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* HTTP status is authoritative even when error JSON is malformed. */ }
        if (!response.ok) {
            const upstreamCode = data?.error?.code;
            const code = response.status === 401 ? 'DIRECT_AUTH_FAILED'
                : upstreamCode === 'unsupported_api_for_model' || upstreamCode === 'model_not_found' ? 'DIRECT_UNSUPPORTED_MODEL'
                : response.status === 403 || upstreamCode === 'model_policy_denied' ? 'DIRECT_POLICY_DENIED'
                : response.status === 429 || ['quota_exceeded', 'rate_limit_exceeded'].includes(upstreamCode) ? 'DIRECT_RATE_LIMITED' : 'DIRECT_UPSTREAM_FAILED';
            const retry = response.headers.get('retry-after');
            const guidance = code === 'DIRECT_RATE_LIMITED' && retry && /^\d{1,8}$/.test(retry) ? ` Retry after ${retry} seconds.` : '';
            throw new CopilotDirectError(code, `Copilot HTTP request failed (${response.status}).${guidance}`);
        }
        if (data === undefined) throw new CopilotDirectError('DIRECT_INVALID_RESPONSE', 'Copilot returned invalid JSON.');
        return { data, requestId };
    } catch (error) {
        if (error instanceof CopilotDirectError) error.requestId = requestId;
        throw error;
    }
}
