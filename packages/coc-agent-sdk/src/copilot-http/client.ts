import { createHash } from 'node:crypto';
import { getAIServiceLogger } from '../logger';
import { DEFAULT_AI_TIMEOUT_MS } from '../timeout-defaults';
import { CopilotDirectError, directError } from './errors';
import { readCopilotCredential, validateCredentialConfig } from './credentials';
import { COPILOT_HTTP_BINDINGS } from './config';
import { allowedCopilotEndpoint, MAX_DIRECT_REQUEST_BYTES, requestJson, withAbort } from './transport';
import { serializeCompletion, parseCompletion } from './wire-adapters';
import { validateCatalog } from './catalog';
import type { CopilotCompletionInput, CopilotCompletionResult, CopilotHttpConfig, CopilotModelBinding } from './types';

interface CatalogEntry { data?: unknown; expires: number; pending?: Promise<unknown> }

/** Buffered HTTP inference; automatic credentials use the CLI without an agent session. */
export class CopilotHttpClient {
    private readonly config: CopilotHttpConfig;
    private readonly active = new Set<AbortController>();
    private readonly catalogs = new Map<string, CatalogEntry>();
    private identity?: string;
    private disposed = false;

    constructor(config: CopilotHttpConfig = { credential: { source: 'copilot-cli' } }) {
        this.config = config ? { ...config, credential: config.credential ? { ...config.credential,
                ...(config.credential.source === 'cli-config' && typeof config.credential.account === 'object'
                    ? { account: Object.freeze({ ...config.credential.account }) } : {}) } : config.credential,
            bindings: Object.fromEntries(Object.entries(config.bindings ?? COPILOT_HTTP_BINDINGS).map(([id, b]) =>
                [id, Object.freeze({ ...b, reportedModels: Object.freeze(b?.reportedModels ? [...b.reportedModels] : []),
                    reasoningEfforts: b?.reasoningEfforts ? Object.freeze([...b.reasoningEfforts]) : undefined })])) } : config;
    }
    private endpoint(): URL {
        validateCredentialConfig(this.config?.credential);
        let endpoint: URL;
        try { endpoint = new URL(this.config.endpoint ?? 'https://api.githubcopilot.com'); }
        catch { throw new CopilotDirectError('DIRECT_UNSUPPORTED_HOST', 'Invalid Copilot HTTP endpoint.'); }
        if (!(this.config.endpointPolicy ?? allowedCopilotEndpoint)(endpoint))
            throw new CopilotDirectError('DIRECT_UNSUPPORTED_HOST', 'Unsupported Copilot HTTP endpoint.');
        return endpoint;
    }
    public binding(model: string): CopilotModelBinding {
        if (typeof model !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(model))
            throw new CopilotDirectError('DIRECT_UNSUPPORTED_MODEL', 'Select an explicit supported Copilot model.');
        const binding = Object.prototype.hasOwnProperty.call(this.config?.bindings ?? {}, model) ? this.config.bindings![model] : undefined;
        if (!binding || !['responses', 'chat-completions'].includes(binding.api)
            || !binding.reportedModels.length || binding.reportedModels.some(id => typeof id !== 'string' || !id)
            || (binding.api === 'responses' ? binding.outputLimitField !== 'max_output_tokens'
                : !['max_tokens', 'max_completion_tokens'].includes(binding.outputLimitField)))
            throw new CopilotDirectError('DIRECT_UNSUPPORTED_MODEL', 'Select an explicit supported Copilot model/protocol binding.');
        return binding;
    }
    public async isAvailable(model?: string): Promise<{ available: boolean; error?: string; errorCode?: string }> {
        try {
            if (!model) throw new CopilotDirectError('DIRECT_NOT_ELIGIBLE', 'Direct transforms require an explicit model.');
            this.binding(model);
            // Readiness uses the same credential path without catalog or inference requests.
            await this.run(10_000, undefined, async signal => {
                this.endpoint();
                const credential = await withAbort(readCopilotCredential(this.config.credential, signal), signal);
                this.checkCredentialHost(credential.host);
            });
            return { available: true };
        } catch (error) {
            const failure = directError(error);
            return { available: false, error: failure.message, errorCode: failure.code };
        }
    }
    private checkCredentialHost(host: string): void {
        if (!this.config.endpointPolicy && host !== 'github.com')
            throw new CopilotDirectError('DIRECT_UNSUPPORTED_HOST', 'Selected credential host has no verified direct endpoint binding.');
    }
    private async run<T>(timeoutMs: number, caller: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
        if (this.disposed) throw new CopilotDirectError('DIRECT_CANCELLED', 'Copilot HTTP client has been disposed.');
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
            throw new CopilotDirectError('DIRECT_CONFIG_INVALID', 'Direct timeout must be a positive bounded integer.');
        const controller = new AbortController();
        const cancel = () => controller.abort(new CopilotDirectError('DIRECT_CANCELLED', 'Copilot completion was cancelled.'));
        if (caller?.aborted) cancel();
        else caller?.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(() => controller.abort(new CopilotDirectError('DIRECT_TIMEOUT', 'Copilot completion deadline expired.')), timeoutMs);
        this.active.add(controller);
        try {
            controller.signal.throwIfAborted();
            return await withAbort(action(controller.signal), controller.signal);
        } catch (error) { throw directError(controller.signal.aborted ? controller.signal.reason : error); }
        finally { clearTimeout(timer); caller?.removeEventListener('abort', cancel); this.active.delete(controller); }
    }
    public async complete(input: CopilotCompletionInput): Promise<CopilotCompletionResult> {
        input = { ...input, messages: Array.isArray(input.messages) ? input.messages.map(m => ({ ...m })) : input.messages };
        const now = this.config?.now ?? Date.now;
        const start = now();
        let dispatched = false;
        let requestId: string | undefined;
        let cacheHit = false;
        let outcome = 'success';
        let reportedModel: string | undefined;
        try {
            return await this.run(input.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS, input.signal, async signal => {
                const endpoint = this.endpoint().origin;
                const binding = this.binding(input.model);
                if (input.api !== binding.api) throw new CopilotDirectError('DIRECT_UNSUPPORTED_MODEL', 'Wire API contradicts the selected model binding.');
                const body = JSON.stringify(serializeCompletion(input, binding));
                if (Buffer.byteLength(body) > MAX_DIRECT_REQUEST_BYTES)
                    throw new CopilotDirectError('DIRECT_NOT_ELIGIBLE', 'Copilot completion request exceeds the text limit.');
                const credential = await withAbort(readCopilotCredential(this.config.credential, signal), signal);
                this.checkCredentialHost(credential.host);
                const credentialEnd = now();
                // Fingerprints stay private and are never included in diagnostics or logs.
                const identity = createHash('sha256').update(JSON.stringify([endpoint, this.config.credential.source, credential.host, credential.login, credential.token])).digest('hex');
                if (this.identity !== identity) { this.catalogs.clear(); this.identity = identity; }
                const key = `${identity}:${input.model}`;
                let entry = this.catalogs.get(key);
                cacheHit = !!entry?.data && entry.expires > now();
                if (!entry || (!entry.pending && !cacheHit)) {
                    this.catalogs.delete(key);
                    if (this.catalogs.size >= 32) this.catalogs.delete(this.catalogs.keys().next().value!);
                    // A shared catalog request owns a separate bounded lifecycle. A waiter never aborts a peer.
                    const controller = new AbortController();
                    entry = { expires: 0 };
                    const current = entry;
                    const timer = setTimeout(() => controller.abort(new CopilotDirectError('DIRECT_TIMEOUT', 'Copilot catalog deadline expired.')), 30_000);
                    this.active.add(controller);
                    current.pending = withAbort(requestJson(this.config.fetch ?? fetch, `${endpoint}/models`, credential.token, controller.signal), controller.signal)
                        .then(({ data }) => {
                            validateCatalog(data, input.model, binding);
                            current.data = data; current.expires = now() + 300_000;
                            return data;
                        }).catch(error => {
                            if (this.catalogs.get(key) === current) this.catalogs.delete(key);
                            throw controller.signal.aborted ? controller.signal.reason : error;
                        }).finally(() => {
                            clearTimeout(timer); this.active.delete(controller); current.pending = undefined;
                        });
                    this.catalogs.set(key, current);
                }
                const catalog = entry.pending ? await withAbort(entry.pending, signal) : entry.data;
                validateCatalog(catalog, input.model, binding, input);
                const catalogEnd = now();
                signal.throwIfAborted();
                dispatched = true;
                const response = await withAbort(requestJson(this.config.fetch ?? fetch,
                    `${endpoint}/${input.api === 'responses' ? 'responses' : 'chat/completions'}`, credential.token, signal, body), signal);
                requestId = response.requestId;
                const parsed = parseCompletion(response.data, input, binding);
                reportedModel = parsed.reportedModel;
                return {
                    text: parsed.text, requestedModel: input.model, effectiveModel: parsed.effectiveModel, tokenUsage: parsed.tokenUsage,
                    diagnostics: { transport: 'direct', api: input.api, reportedModel: parsed.reportedModel,
                        durationMs: now() - start, requestId, usageUnavailableReason: parsed.usageUnavailableReason,
                        totalNanoAiu: parsed.totalNanoAiu, tokenCounts: parsed.tokenCounts, cacheHit,
                        catalogEndpointMetadata: (catalog as any).data.find((entry: any) => entry.id === input.model).supported_endpoints ? 'advertised' : 'unknown',
                        timings: { credentialMs: credentialEnd - start, catalogMs: catalogEnd - credentialEnd, inferenceMs: now() - catalogEnd } },
                };
            });
        } catch (error) {
            const failure = directError(error);
            failure.inferenceDispatched = dispatched;
            failure.requestId ??= requestId;
            outcome = failure.code;
            requestId = failure.requestId;
            if (failure.code === 'DIRECT_AUTH_FAILED') this.catalogs.clear();
            throw failure;
        } finally {
            // Allow-listed fields only: no exception object, text, secrets, URL, or private cache key.
            getAIServiceLogger().debug({ provider: 'copilot', transport: 'direct', api: ['responses', 'chat-completions'].includes(input.api) ? input.api : undefined,
                model: Object.prototype.hasOwnProperty.call(this.config?.bindings ?? {}, input.model) ? input.model : undefined,
                reportedModel, durationMs: now() - start, outcome, cacheHit, requestId }, 'Copilot completion');
        }
    }
    public cleanup(): void {
        for (const controller of this.active) controller.abort(new CopilotDirectError('DIRECT_CANCELLED', 'Copilot HTTP work was stopped.'));
        this.active.clear(); this.catalogs.clear(); this.identity = undefined;
    }
    public dispose(): void { this.disposed = true; this.cleanup(); }
}
