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
import { sendJson, send400, send500, setStaticConfigCacheHeaders } from '../shared/router';
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import type { AgentProviderStatus, AgentProvidersResponse } from '@plusplusoneplusplus/coc-client';
import type { CopilotSDKService, IAvailabilityResult, CodexSDKService, ClaudeSDKService, ModelInfo, ISDKService } from '@plusplusoneplusplus/forge';
import { getAllModels, modelMetadataStore, sdkServiceRegistry, SDK_PROVIDER_COPILOT, SDK_PROVIDER_CODEX, SDK_PROVIDER_CLAUDE, SDK_PROVIDER_OPENCODE, mergeEffortTiersWithDefaults, getDefaultEffortTiers, type MergedEffortTiersMap, type EffortTierDefaultsMap } from '@plusplusoneplusplus/forge';
import { getResolvedInstallState } from '../providers/provider-install-routes';
import type { CLIConfig } from '../../config';
import { AgentProvidersQuotaCache, type AgentProvidersQuotaContext } from './quota-cache';

export interface AgentProvidersRouteContext extends AgentProvidersQuotaContext {
    runtimeConfigService: RuntimeConfigService;
    /** Checks Codex SDK availability. Resolved per-request; the service caches the result. */
    getCodexAvailability: () => Promise<IAvailabilityResult>;
    /** Checks Claude SDK availability. Resolved per-request; the service caches the result. */
    getClaudeAvailability: () => Promise<IAvailabilityResult>;
    /** Checks OpenCode SDK availability. Resolved per-request; the service caches the result. */
    getOpenCodeAvailability: () => Promise<IAvailabilityResult>;
    /** Optional: getter for Copilot account quota. Used by the quota endpoint. */
    getCopilotSdkService?: () => CopilotSDKService;
    /** Optional: getter for Codex account quota. Used by the quota endpoint. */
    getCodexSdkService?: () => CodexSDKService | undefined;
    /** Optional: getter for Claude account quota. Used by the quota endpoint. */
    getClaudeSdkService?: () => ClaudeSDKService | undefined;
    /** Optional: getter for OpenCode SDK service. Used for model queries. OpenCode has no quota API. */
    getOpenCodeSdkService?: () => ISDKService | undefined;
    /** Config persistence functions for model settings. */
    configPath?: string;
    loadConfigFile: (p?: string) => CLIConfig | undefined;
    writeConfigFile: (p: string, c: CLIConfig) => void;
    getConfigFilePath: () => string;
    quotaCache?: AgentProvidersQuotaCache;
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

    const opencodeEnabled = config.opencode?.enabled ?? false;
    const opencodeInstallState = getResolvedInstallState('opencode');

    let opencodeProvider: AgentProviderStatus;
    if (!opencodeEnabled) {
        opencodeProvider = {
            id: 'opencode',
            label: 'OpenCode',
            enabled: false,
            available: false,
            installStatus: opencodeInstallState.status,
        };
    } else {
        const availability = await ctx.getOpenCodeAvailability();
        if (availability.available) {
            opencodeProvider = {
                id: 'opencode',
                label: 'OpenCode',
                enabled: true,
                available: true,
                installStatus: opencodeInstallState.status,
            };
        } else {
            opencodeProvider = {
                id: 'opencode',
                label: 'OpenCode',
                enabled: true,
                available: false,
                reason: availability.error ?? 'OpenCode SDK is not available.',
                installStatus: opencodeInstallState.status,
            };
        }
    }

    return { providers: [copilot, codexProvider, claudeProvider, opencodeProvider] };
}

// ── Effort-tier types ────────────────────────────────────────────────────────

export interface EffortTierEntry {
    model: string;
    reasoningEffort?: string | null;
}

export type EffortTiersMap = Partial<Record<'very-low' | 'low' | 'medium' | 'high', EffortTierEntry>>;

const VALID_TIER_KEYS = new Set<string>(['very-low', 'low', 'medium', 'high']);
const VALID_TIER_KEYS_LABEL = 'very-low, low, medium, high';

// ── Provider-scoped model helpers ────────────────────────────────────────────

const VALID_PROVIDERS = new Set(['copilot', 'codex', 'claude', 'opencode']);
const PROVIDER_SDK_KEYS: Record<string, string> = {
    copilot: SDK_PROVIDER_COPILOT,
    codex: SDK_PROVIDER_CODEX,
    claude: SDK_PROVIDER_CLAUDE,
    opencode: SDK_PROVIDER_OPENCODE,
};

function getProviderModelSettings(cfg: CLIConfig | undefined, provider: string): { enabled: string[]; reasoningEfforts: Record<string, string>; effortTiers: EffortTiersMap } {
    const providerSettings = cfg?.models?.providers?.[provider];
    if (providerSettings) {
        return {
            enabled: providerSettings.enabled ?? [],
            reasoningEfforts: providerSettings.reasoningEfforts ?? {},
            effortTiers: (providerSettings.effortTiers ?? {}) as EffortTiersMap,
        };
    }
    // Legacy migration: treat global models.enabled/reasoningEfforts as Copilot defaults
    if (provider === 'copilot') {
        return {
            enabled: cfg?.models?.enabled ?? [],
            reasoningEfforts: cfg?.models?.reasoningEfforts ?? {},
            effortTiers: {},
        };
    }
    return { enabled: [], reasoningEfforts: {}, effortTiers: {} };
}

function writeProviderModelSettings(
    cfg: CLIConfig,
    provider: string,
    update: Partial<{ enabled: string[]; reasoningEfforts: Record<string, string>; effortTiers: EffortTiersMap }>,
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
    if (provider === 'opencode') {
        return ctx.getOpenCodeSdkService?.();
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

/** Resolve the model catalog for a provider for write-time validation. Returns [] when unavailable — callers must skip validation when empty. */
async function getProviderCatalog(ctx: AgentProvidersRouteContext, provider: string): Promise<ModelInfo[]> {
    if (provider === 'copilot') {
        // Only use the live metadata store; if it hasn't been populated yet, return [] to skip validation.
        return modelMetadataStore.getAll();
    }
    const sdkService = getProviderSdkService(ctx, provider);
    if (!sdkService) return [];
    try {
        return await sdkService.listModels() as unknown as ModelInfo[];
    } catch {
        return [];
    }
}

export function registerAgentProvidersRoutes(routes: Route[], ctx: AgentProvidersRouteContext): void {
    const quotaCache = ctx.quotaCache ?? new AgentProvidersQuotaCache(ctx);

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
        handler: async (req, res) => {
            const url = new URL(req.url ?? '/api/agent-providers/quota', 'http://localhost');
            const force = url.searchParams.get('force') === '1';
            const body = await quotaCache.get({ force });
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
                setStaticConfigCacheHeaders(res);
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

    // GET /api/agent-providers/:provider/effort-tiers
    routes.push({
        method: 'GET',
        pattern: /^\/api\/agent-providers\/([^/]+)\/effort-tiers$/,
        handler: (_req, res, match) => {
            const provider = match ? decodeURIComponent(match[1] ?? '') : '';
            if (!VALID_PROVIDERS.has(provider)) {
                send400(res, `Invalid provider: ${provider}. Valid providers: ${[...VALID_PROVIDERS].join(', ')}`);
                return;
            }
            try {
                const cfg = ctx.loadConfigFile(ctx.configPath);
                const settings = getProviderModelSettings(cfg, provider);
                const effortTiers: MergedEffortTiersMap = mergeEffortTiersWithDefaults(provider, settings.effortTiers);
                const defaults: EffortTierDefaultsMap | Record<string, never> = getDefaultEffortTiers(provider) ?? {};
                setStaticConfigCacheHeaders(res);
                sendJson(res, { provider, effortTiers, defaults });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : 'Failed to retrieve effort tiers');
            }
        },
    });

    // PUT /api/agent-providers/:provider/effort-tiers
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/agent-providers\/([^/]+)\/effort-tiers$/,
        handler: (req, res, match) => {
            const provider = match ? decodeURIComponent(match[1] ?? '') : '';
            if (!VALID_PROVIDERS.has(provider)) {
                send400(res, `Invalid provider: ${provider}. Valid providers: ${[...VALID_PROVIDERS].join(', ')}`);
                return;
            }
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const parsed = JSON.parse(body || '{}') as Record<string, unknown>;
                    // Build the update map from either single-tier or full-map body
                    let updateMap: EffortTiersMap;
                    if (typeof parsed.tier === 'string') {
                        // Single-tier upsert: { tier, model, reasoningEffort? }
                        const tier = parsed.tier as string;
                        if (!VALID_TIER_KEYS.has(tier)) {
                            send400(res, `Invalid tier: ${tier}. Valid tiers: ${VALID_TIER_KEYS_LABEL}`);
                            return;
                        }
                        if (typeof parsed.model !== 'string' || !parsed.model) {
                            send400(res, 'model is required');
                            return;
                        }
                        const reasoningEffort = parsed.reasoningEffort !== undefined
                            ? (parsed.reasoningEffort === null || typeof parsed.reasoningEffort === 'string' ? parsed.reasoningEffort : undefined)
                            : undefined;
                        updateMap = { [tier]: { model: parsed.model, reasoningEffort } } as EffortTiersMap;
                    } else if (parsed.effortTiers !== null && typeof parsed.effortTiers === 'object') {
                        // Full-map replace
                        const raw = parsed.effortTiers as Record<string, unknown>;
                        const validated: EffortTiersMap = {};
                        for (const key of Object.keys(raw)) {
                            if (!VALID_TIER_KEYS.has(key)) {
                                send400(res, `Invalid tier key: ${key}. Valid tiers: ${VALID_TIER_KEYS_LABEL}`);
                                return;
                            }
                            const entry = raw[key] as Record<string, unknown>;
                            if (typeof entry?.model !== 'string' || !entry.model) {
                                send400(res, `model is required for tier: ${key}`);
                                return;
                            }
                            const effort = entry.reasoningEffort !== undefined
                                ? (entry.reasoningEffort === null || typeof entry.reasoningEffort === 'string' ? entry.reasoningEffort as string | null : undefined)
                                : undefined;
                            validated[key as 'very-low' | 'low' | 'medium' | 'high'] = { model: entry.model as string, reasoningEffort: effort };
                        }
                        updateMap = validated;
                    } else {
                        send400(res, 'Request must include either "tier" (single upsert) or "effortTiers" (full map)');
                        return;
                    }

                    // Validate model(s) against the provider catalog
                    const catalog = await getProviderCatalog(ctx, provider);
                    if (catalog.length > 0) {
                        const catalogMap = new Map(catalog.map(m => [m.id, m]));
                        for (const [tier, entry] of Object.entries(updateMap)) {
                            if (!entry) continue;
                            const modelInfo = catalogMap.get(entry.model);
                            if (!modelInfo) {
                                send400(res, `Model "${entry.model}" is not in the ${provider} catalog`);
                                return;
                            }
                            if (entry.reasoningEffort != null) {
                                const supported = modelInfo.supportedReasoningEfforts;
                                if (Array.isArray(supported) && supported.length > 0 && !supported.includes(entry.reasoningEffort)) {
                                    send400(res, `Reasoning effort "${entry.reasoningEffort}" is not supported by model "${entry.model}" for tier "${tier}". Supported: ${supported.join(', ')}`);
                                    return;
                                }
                            }
                        }
                    }

                    const filePath = ctx.getConfigFilePath();
                    const cfg = ctx.loadConfigFile(ctx.configPath) ?? {};
                    const currentSettings = getProviderModelSettings(cfg, provider);
                    // Merge: full-map body replaces, single-tier upsert merges into existing
                    const mergedTiers: EffortTiersMap = typeof parsed.tier === 'string'
                        ? { ...currentSettings.effortTiers, ...updateMap }
                        : updateMap;
                    const updated = writeProviderModelSettings(cfg, provider, { effortTiers: mergedTiers });
                    ctx.writeConfigFile(filePath, updated);
                    const responseTiers: MergedEffortTiersMap = mergeEffortTiersWithDefaults(provider, mergedTiers);
                    const defaults: EffortTierDefaultsMap | Record<string, never> = getDefaultEffortTiers(provider) ?? {};
                    sendJson(res, { provider, effortTiers: responseTiers, defaults });
                } catch (err) {
                    send500(res, err instanceof Error ? err.message : 'Failed to update effort tiers');
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
            if (provider === 'opencode' && !(config.opencode?.enabled ?? false)) {
                sendJson(res, { success: false, provider, error: 'OpenCode provider is not enabled' }, 400);
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
