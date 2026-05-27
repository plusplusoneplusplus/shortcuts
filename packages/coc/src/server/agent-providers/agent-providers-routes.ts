/**
 * Agent Providers REST API Routes
 *
 * GET /api/agent-providers
 *   Returns enabled/available status for Copilot, Codex, and Claude so the
 *   New Chat UI and Admin page can show live provider state without a
 *   server restart.
 *
 * Copilot is always enabled, available, and locked.
 * Codex status is derived from:
 *   - `codex.enabled` in live runtime config (enabled flag)
 *   - `@openai/codex-sdk` SDK availability check (available flag)
 * Claude status is derived from:
 *   - `claude.enabled` in live runtime config (enabled flag)
 *   - `@anthropic-ai/claude-agent-sdk` SDK availability check (available flag)
 */

import type { Route } from '../types';
import { sendJson, send400, send500 } from '../shared/router';
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import type { AgentProviderStatus, AgentProvidersResponse, AgentProvidersQuotaResponse, ProviderQuotaType } from '@plusplusoneplusplus/coc-client';
import type { CopilotSDKService, IAvailabilityResult, CodexSDKService, ClaudeSDKService, IAccountQuotaResult, ModelInfo, ISDKService } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory, getAllModels, modelMetadataStore, sdkServiceRegistry, SDK_PROVIDER_COPILOT, SDK_PROVIDER_CODEX, SDK_PROVIDER_CLAUDE } from '@plusplusoneplusplus/forge';
import { getResolvedInstallState } from '../providers/provider-install-routes';
import type { CLIConfig } from '../../config';

export interface AgentProvidersRouteContext {
    runtimeConfigService: RuntimeConfigService;
    /** Checks Codex SDK availability. Resolved per-request; the service caches the result. */
    getCodexAvailability: () => Promise<IAvailabilityResult>;
    /** Checks Claude SDK availability. Resolved per-request; the service caches the result. */
    getClaudeAvailability: () => Promise<IAvailabilityResult>;
    /** Optional: getter for Copilot account quota. Used by the quota endpoint. */
    getCopilotSdkService?: () => CopilotSDKService;
    /** Optional: getter for Codex account quota. Used by the quota endpoint. */
    getCodexSdkService?: () => CodexSDKService | undefined;
    /** Optional: getter for Claude account quota. Used by the quota endpoint. */
    getClaudeSdkService?: () => ClaudeSDKService | undefined;
    /** Config persistence functions for model settings. */
    configPath?: string;
    loadConfigFile: (p?: string) => CLIConfig | undefined;
    writeConfigFile: (p: string, c: CLIConfig) => void;
    getConfigFilePath: () => string;
}

function quotaResultToProviderQuotaTypes(result: IAccountQuotaResult): ProviderQuotaType[] {
    return Object.entries(result.quotaSnapshots).map(
        ([type, snap]) => ({
            type,
            isUnlimitedEntitlement: snap.isUnlimitedEntitlement,
            usedRequests: snap.usedRequests,
            entitlementRequests: snap.entitlementRequests,
            remainingPercentage: snap.remainingPercentage,
            usageAllowedWithExhaustedQuota: snap.usageAllowedWithExhaustedQuota,
            overage: snap.overage,
            resetDate: snap.resetDate,
        }),
    );
}

/** Build the providers array from live config + SDK state. Exported for unit testing. */
export async function buildAgentProvidersResponse(ctx: AgentProvidersRouteContext): Promise<AgentProvidersResponse> {
    const config = ctx.runtimeConfigService.config;
    const codexEnabled = config.codex?.enabled ?? false;
    const claudeEnabled = config.claude?.enabled ?? false;

    const copilot: AgentProviderStatus = {
        id: 'copilot',
        label: 'Copilot',
        enabled: true,
        available: true,
        locked: true,
    };

    // Resolve SDK install status for optional providers.
    const codexInstallState = getResolvedInstallState('codex');
    const claudeInstallState = getResolvedInstallState('claude');

    let codexProvider: AgentProviderStatus;
    if (!codexEnabled) {
        codexProvider = {
            id: 'codex',
            label: 'Codex',
            enabled: false,
            available: false,
            installStatus: codexInstallState.status,
        };
    } else {
        const availability = await ctx.getCodexAvailability();
        if (availability.available) {
            codexProvider = {
                id: 'codex',
                label: 'Codex',
                enabled: true,
                available: true,
                installStatus: codexInstallState.status,
            };
        } else {
            codexProvider = {
                id: 'codex',
                label: 'Codex',
                enabled: true,
                available: false,
                reason: availability.error ?? 'Codex SDK is not available.',
                installStatus: codexInstallState.status,
            };
        }
    }

    let claudeProvider: AgentProviderStatus;
    if (!claudeEnabled) {
        claudeProvider = {
            id: 'claude',
            label: 'Claude',
            enabled: false,
            available: false,
            installStatus: claudeInstallState.status,
        };
    } else {
        const availability = await ctx.getClaudeAvailability();
        if (availability.available) {
            claudeProvider = {
                id: 'claude',
                label: 'Claude',
                enabled: true,
                available: true,
                installStatus: claudeInstallState.status,
            };
        } else {
            claudeProvider = {
                id: 'claude',
                label: 'Claude',
                enabled: true,
                available: false,
                reason: availability.error ?? 'Claude Code SDK is not available.',
                installStatus: claudeInstallState.status,
            };
        }
    }

    return { providers: [copilot, codexProvider, claudeProvider] };
}

// ── Provider-scoped model helpers ────────────────────────────────────────────

const VALID_PROVIDERS = new Set(['copilot', 'codex', 'claude']);
const PROVIDER_SDK_KEYS: Record<string, string> = {
    copilot: SDK_PROVIDER_COPILOT,
    codex: SDK_PROVIDER_CODEX,
    claude: SDK_PROVIDER_CLAUDE,
};

function getProviderModelSettings(cfg: CLIConfig | undefined, provider: string): { enabled: string[]; reasoningEfforts: Record<string, string> } {
    const providerSettings = cfg?.models?.providers?.[provider];
    if (providerSettings) {
        return {
            enabled: providerSettings.enabled ?? [],
            reasoningEfforts: providerSettings.reasoningEfforts ?? {},
        };
    }
    // Legacy migration: treat global models.enabled/reasoningEfforts as Copilot defaults
    if (provider === 'copilot') {
        return {
            enabled: cfg?.models?.enabled ?? [],
            reasoningEfforts: cfg?.models?.reasoningEfforts ?? {},
        };
    }
    return { enabled: [], reasoningEfforts: {} };
}

function writeProviderModelSettings(
    cfg: CLIConfig,
    provider: string,
    update: Partial<{ enabled: string[]; reasoningEfforts: Record<string, string> }>,
): CLIConfig {
    const existing = cfg.models?.providers?.[provider] ?? {};
    const updated = { ...existing, ...update };
    return {
        ...cfg,
        models: {
            ...cfg.models,
            providers: {
                ...cfg.models?.providers,
                [provider]: updated,
            },
        },
    };
}

function getProviderSdkService(ctx: AgentProvidersRouteContext, provider: string): ISDKService | undefined {
    const sdkKey = PROVIDER_SDK_KEYS[provider];
    if (!sdkKey) return undefined;
    if (provider === 'copilot') {
        return ctx.getCopilotSdkService?.() as unknown as ISDKService | undefined;
    }
    if (provider === 'codex') {
        return ctx.getCodexSdkService?.() as unknown as ISDKService | undefined;
    }
    if (provider === 'claude') {
        return ctx.getClaudeSdkService?.() as unknown as ISDKService | undefined;
    }
    return undefined;
}

function getStaticFallbackModels(): ModelInfo[] {
    return getAllModels().map(m => ({
        id: m.id,
        name: m.label,
        capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: m.contextWindow ?? 128_000 },
        },
    }));
}

function getModelQueryError(error: string | undefined): string {
    if (!error) return 'Model query failed';
    try {
        const parsed = JSON.parse(error) as unknown;
        if (parsed && typeof parsed === 'object') {
            const record = parsed as Record<string, unknown>;
            const nested = record.error;
            if (nested && typeof nested === 'object') {
                const message = (nested as Record<string, unknown>).message;
                if (typeof message === 'string' && message.trim()) return message;
            }
            const message = record.message;
            if (typeof message === 'string' && message.trim()) return message;
        }
    } catch {
        // Non-JSON provider errors are already displayable.
    }
    return error;
}

export function registerAgentProvidersRoutes(routes: Route[], ctx: AgentProvidersRouteContext): void {
    routes.push({
        method: 'GET',
        pattern: '/api/agent-providers',
        handler: async (_req, res) => {
            const body = await buildAgentProvidersResponse(ctx);
            sendJson(res, body);
        },
    });

    routes.push({
        method: 'GET',
        pattern: '/api/agent-providers/quota',
        handler: async (_req, res) => {
            const config = ctx.runtimeConfigService.config;
            const codexEnabled = config.codex?.enabled ?? false;
            const claudeEnabled = config.claude?.enabled ?? false;

            const providers: AgentProvidersQuotaResponse['providers'] = [];

            // Copilot quota
            try {
                const sdkService = ctx.getCopilotSdkService?.();
                if (!sdkService) {
                    providers.push({ id: 'copilot', quotaTypes: [], error: 'Copilot SDK service not available' });
                } else {
                    const result = await sdkService.getAccountQuota();
                    const quotaTypes = quotaResultToProviderQuotaTypes(result);
                    providers.push({ id: 'copilot', quotaTypes });
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                providers.push({ id: 'copilot', quotaTypes: [], error: msg });
            }

            // Codex quota via app-server RPC
            if (codexEnabled) {
                try {
                    const codexService = ctx.getCodexSdkService?.();
                    if (!codexService) {
                        providers.push({ id: 'codex', quotaTypes: [] });
                    } else {
                        const result = await codexService.getAccountQuota();
                        const quotaTypes = quotaResultToProviderQuotaTypes(result);
                        providers.push({ id: 'codex', quotaTypes });
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    providers.push({ id: 'codex', quotaTypes: [], error: msg });
                }
            }

            // Claude quota uses cached `rate_limit_event` and `accountInfo()`
            // signals — see `ClaudeSDKService.getAccountQuota()` for the full
            // priority order. We always emit a `claude` entry when Claude is
            // enabled so the UI consistently shows the provider; only a real
            // SDK error pushes an entry with an `error` field.
            if (claudeEnabled) {
                try {
                    const claudeService = ctx.getClaudeSdkService?.();
                    if (claudeService) {
                        const result = await claudeService.getAccountQuota();
                        const quotaTypes = quotaResultToProviderQuotaTypes(result);
                        providers.push({ id: 'claude', quotaTypes });
                        if (quotaTypes.length === 0) {
                            getLogger().debug(LogCategory.AI, '[ClaudeQuota] No quota snapshots to report — emitting claude entry with empty quotaTypes');
                        }
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    getLogger().warn(LogCategory.AI, `[ClaudeQuota] quota lookup failed: ${msg}`);
                    providers.push({ id: 'claude', quotaTypes: [], error: msg });
                }
            }

            const body: AgentProvidersQuotaResponse = { providers };
            sendJson(res, body);
        },
    });

    // ── Provider-scoped model routes ─────────────────────────────────────────

    // GET /api/agent-providers/:provider/models
    routes.push({
        method: 'GET',
        pattern: /^\/api\/agent-providers\/([^/]+)\/models$/,
        handler: async (_req, res, match) => {
            const provider = match ? decodeURIComponent(match[1] ?? '') : '';
            if (!VALID_PROVIDERS.has(provider)) {
                send400(res, `Invalid provider: ${provider}. Valid providers: ${[...VALID_PROVIDERS].join(', ')}`);
                return;
            }
            try {
                let models: ModelInfo[];
                if (provider === 'copilot') {
                    const storeModels = modelMetadataStore.getAll();
                    models = storeModels.length > 0 ? storeModels : getStaticFallbackModels();
                } else {
                    const sdkService = getProviderSdkService(ctx, provider);
                    if (!sdkService) {
                        sendJson(res, { provider, models: [] });
                        return;
                    }
                    try {
                        models = await sdkService.listModels() as unknown as ModelInfo[];
                    } catch {
                        models = [];
                    }
                }

                const cfg = ctx.loadConfigFile(ctx.configPath);
                const settings = getProviderModelSettings(cfg, provider);
                const enabledSet = new Set(settings.enabled);
                const withEnabled = models.map(m => ({ ...m, enabled: enabledSet.has(m.id) }));
                sendJson(res, { provider, models: withEnabled });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : 'Failed to retrieve models');
            }
        },
    });

    // GET /api/agent-providers/:provider/models/enabled
    routes.push({
        method: 'GET',
        pattern: /^\/api\/agent-providers\/([^/]+)\/models\/enabled$/,
        handler: (_req, res, match) => {
            const provider = match ? decodeURIComponent(match[1] ?? '') : '';
            if (!VALID_PROVIDERS.has(provider)) {
                send400(res, `Invalid provider: ${provider}. Valid providers: ${[...VALID_PROVIDERS].join(', ')}`);
                return;
            }
            try {
                const cfg = ctx.loadConfigFile(ctx.configPath);
                const settings = getProviderModelSettings(cfg, provider);
                sendJson(res, { provider, enabledModels: settings.enabled });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : 'Failed to retrieve enabled models');
            }
        },
    });

    // PUT /api/agent-providers/:provider/models/enabled
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/agent-providers\/([^/]+)\/models\/enabled$/,
        handler: (req, res, match) => {
            const provider = match ? decodeURIComponent(match[1] ?? '') : '';
            if (!VALID_PROVIDERS.has(provider)) {
                send400(res, `Invalid provider: ${provider}. Valid providers: ${[...VALID_PROVIDERS].join(', ')}`);
                return;
            }
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
                try {
                    const parsed = JSON.parse(body || '{}');
                    if (!Array.isArray(parsed.enabledModels) || !parsed.enabledModels.every((x: unknown) => typeof x === 'string')) {
                        send400(res, 'enabledModels must be an array of strings');
                        return;
                    }
                    const enabledModels: string[] = parsed.enabledModels;
                    const filePath = ctx.getConfigFilePath();
                    const cfg = ctx.loadConfigFile(ctx.configPath) ?? {};
                    const updated = writeProviderModelSettings(cfg, provider, { enabled: enabledModels });
                    ctx.writeConfigFile(filePath, updated);
                    sendJson(res, { provider, enabledModels });
                } catch (err) {
                    send500(res, err instanceof Error ? err.message : 'Failed to update enabled models');
                }
            });
        },
    });

    // GET /api/agent-providers/:provider/models/reasoning-efforts
    routes.push({
        method: 'GET',
        pattern: /^\/api\/agent-providers\/([^/]+)\/models\/reasoning-efforts$/,
        handler: (_req, res, match) => {
            const provider = match ? decodeURIComponent(match[1] ?? '') : '';
            if (!VALID_PROVIDERS.has(provider)) {
                send400(res, `Invalid provider: ${provider}. Valid providers: ${[...VALID_PROVIDERS].join(', ')}`);
                return;
            }
            try {
                const cfg = ctx.loadConfigFile(ctx.configPath);
                const settings = getProviderModelSettings(cfg, provider);
                sendJson(res, { provider, reasoningEfforts: settings.reasoningEfforts });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : 'Failed to retrieve reasoning efforts');
            }
        },
    });

    // PUT /api/agent-providers/:provider/models/reasoning-efforts
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/agent-providers\/([^/]+)\/models\/reasoning-efforts$/,
        handler: (req, res, match) => {
            const provider = match ? decodeURIComponent(match[1] ?? '') : '';
            if (!VALID_PROVIDERS.has(provider)) {
                send400(res, `Invalid provider: ${provider}. Valid providers: ${[...VALID_PROVIDERS].join(', ')}`);
                return;
            }
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
                try {
                    const parsed = JSON.parse(body || '{}');
                    if (typeof parsed.modelId !== 'string' || !parsed.modelId) {
                        send400(res, 'modelId is required');
                        return;
                    }
                    if (typeof parsed.effort !== 'string') {
                        send400(res, 'effort must be a string (or empty string to clear)');
                        return;
                    }
                    const { modelId, effort } = parsed as { modelId: string; effort: string };
                    const filePath = ctx.getConfigFilePath();
                    const cfg = ctx.loadConfigFile(ctx.configPath) ?? {};
                    const currentSettings = getProviderModelSettings(cfg, provider);
                    const existing = { ...currentSettings.reasoningEfforts };
                    if (effort === '') {
                        delete existing[modelId];
                    } else {
                        existing[modelId] = effort;
                    }
                    const updated = writeProviderModelSettings(cfg, provider, { reasoningEfforts: existing });
                    ctx.writeConfigFile(filePath, updated);
                    sendJson(res, { provider, reasoningEfforts: existing });
                } catch (err) {
                    send500(res, err instanceof Error ? err.message : 'Failed to update reasoning effort');
                }
            });
        },
    });

    // POST /api/agent-providers/:provider/models/query
    routes.push({
        method: 'POST',
        pattern: /^\/api\/agent-providers\/([^/]+)\/models\/query$/,
        handler: (req, res, match) => {
            const provider = match ? decodeURIComponent(match[1] ?? '') : '';
            if (!VALID_PROVIDERS.has(provider)) {
                send400(res, `Invalid provider: ${provider}. Valid providers: ${[...VALID_PROVIDERS].join(', ')}`);
                return;
            }

            const config = ctx.runtimeConfigService.config;
            if (provider === 'codex' && !(config.codex?.enabled ?? false)) {
                sendJson(res, { success: false, provider, error: 'Codex provider is not enabled' }, 400);
                return;
            }
            if (provider === 'claude' && !(config.claude?.enabled ?? false)) {
                sendJson(res, { success: false, provider, error: 'Claude provider is not enabled' }, 400);
                return;
            }

            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const sdkService = getProviderSdkService(ctx, provider);
                    if (!sdkService) {
                        res.writeHead(503, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, provider, error: `${provider} AI service is not available` }));
                        return;
                    }
                    const parsed = JSON.parse(body || '{}') as Record<string, unknown>;
                    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
                    const model = typeof parsed.model === 'string' && parsed.model.trim()
                        ? parsed.model.trim()
                        : undefined;
                    const timeoutMs = typeof parsed.timeoutMs === 'number' && Number.isFinite(parsed.timeoutMs)
                        ? Math.max(1_000, Math.min(parsed.timeoutMs, 120_000))
                        : 60_000;

                    if (!prompt) {
                        send400(res, 'prompt is required');
                        return;
                    }

                    const startedAt = Date.now();
                    const result = await sdkService.sendMessage({
                        prompt,
                        ...(model ? { model } : {}),
                        timeoutMs,
                        mode: 'interactive',
                    });
                    const durationMs = Date.now() - startedAt;
                    if (!result.success) {
                        res.writeHead(502, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: false,
                            provider,
                            error: getModelQueryError(result.error),
                            model,
                            sessionId: result.sessionId,
                            durationMs,
                        }));
                        return;
                    }
                    sendJson(res, {
                        success: true,
                        provider,
                        response: result.response ?? '',
                        model,
                        sessionId: result.sessionId,
                        durationMs,
                    });
                } catch (err) {
                    send500(res, err instanceof Error ? err.message : 'Failed to query model');
                }
            });
        },
    });
}
