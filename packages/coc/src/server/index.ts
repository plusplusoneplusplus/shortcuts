/**
 * CoC Execution Server
 *
 * Creates and manages an HTTP server for the `coc serve` command.
 * Uses only Node.js built-in modules (http, fs, path, os).
 *
 * Mirrors packages/deep-wiki/src/server/index.ts pattern.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createRequestHandler } from './router';
import { registerAllRoutes } from './routes/index';
import { ProcessWebSocketServer, toProcessSummary } from './streaming/websocket';
import { generateDashboardHtml } from './spa';
import { getBundleETag } from './spa/html-template';
import { generateIconSvg } from './spa/icon-template';
import type { ExecutionServerOptions, ExecutionServer, ServerCloseOptions } from './types';
import type { Route } from './types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { ModelInfo } from '@plusplusoneplusplus/forge';
import { sdkServiceRegistry, SDK_PROVIDER_COPILOT, SDK_PROVIDER_CODEX, SDK_PROVIDER_CLAUDE, SDK_PROVIDER_OPENCODE, modelMetadataStore, registerCodexSDKService, registerClaudeSDKService, registerOpenCodeSDKService } from '@plusplusoneplusplus/forge';
import { cleanupAllStalePasteFiles } from '@plusplusoneplusplus/forge';
import { MultiRepoQueueRouter } from './queue/multi-repo-queue-router';
import { createQueueInfrastructure } from './infrastructure/queue-infrastructure';
import { sweepOrphanedRunningProcesses, collectResumableFollowUpProcessIds } from './processes/finalize-orphaned-turn';
import { reenqueuePendingAskUserResumes } from './processes/resume-pending-ask-user-answers';
import { ensureGlobalWorkspace, GLOBAL_WORKSPACE_ID } from './workspaces/global-workspace';
import { ensureMyWorkWorkspace } from './workspaces/my-work-workspace';
import { ensureMyLifeWorkspace } from './workspaces/my-life-workspace';
import { createScheduleInfrastructure } from './infrastructure/schedule-infrastructure';
import { createLoopInfrastructure } from './infrastructure/loop-infrastructure';
import { createEnqueueWakeup } from './loops/enqueue-wakeup';
import { createTriggerInfrastructure } from './infrastructure/trigger-infrastructure';
import { createCiChecksFetcher } from './triggers/ci-checks-fetcher';
import { createCiLogFetcher } from './triggers/ci-log-fetcher';
import { createMcpOauthInfrastructure } from './mcp-oauth';
import type { LoopInfrastructure } from './infrastructure/loop-infrastructure';
import type { TriggerInfrastructure } from './infrastructure/trigger-infrastructure';
import { createCleanupInfrastructure } from './infrastructure/cleanup-infrastructure';
import { createWebSocketInfrastructure } from './infrastructure/websocket-infrastructure';
import { createWatcherInfrastructure } from './infrastructure/watcher-infrastructure';
import { createTerminalInfrastructure } from './infrastructure/terminal-infrastructure';
import { HeapMonitor } from './admin/heap-monitor';
import { buildRuntimeFeatures } from './config/runtime-config-handler';
import { RuntimeConfigService } from '../config/runtime-config-service';
import { DEFAULT_AI_TIMEOUT_MS } from '@plusplusoneplusplus/forge';
import { autoUpdateBundledSkills, autoInstallDefaultSkills, autoInstallMyWorkSkills, DEFAULT_SKILLS_SETTINGS } from '@plusplusoneplusplus/forge';
import { createStubStore } from './processes/in-memory-process-store';
import { createCLIAIInvoker } from '../ai-invoker';
import { shortenHostname } from './core/hostname-utils';
import { gitInfoCache } from './git/git-info-cache';
import { NotesGitTimerManager } from './notes/git/notes-git-timer-manager';
import { migrateWorkspaceRegistryIfNeeded } from './storage/startup-workspace-migration';
import { migrateProcessHistoryIfNeeded } from './storage/startup-process-migration';
import { migrateWorkspaceIdsToV2IfNeeded } from './storage/startup-workspace-id-migration';
import { DevTunnelConnector } from './servers/devtunnel-connector';
import { SshConnector } from './servers/ssh-connector';
import { RemoteServerStore } from './servers/remote-server-store';
import { pruneAllStaleClassifications } from './repos/classification-store';
import { SyncEngine } from './sync/sync-engine';
import { ContainerLinkClient } from './container-link/container-client';
import { registerContainerLinkRoutes } from './container-link/container-link-routes';

// ============================================================================
// Close Handler Builder
// ============================================================================

function formatLocalBaseUrl(host: string, port: number): string {
    const hostForUrl = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    const needsBrackets = hostForUrl.includes(':') && !hostForUrl.startsWith('[');
    return `http://${needsBrackets ? `[${hostForUrl}]` : hostForUrl}:${port}`;
}

interface CloseHandlerDeps {
    staleDetector: { dispose(): void };
    outputPruner: { stopListening(): void };
    heapMonitor: { dispose(): void };
    taskWatcher: { closeAll(): void };
    pipelineWatcher: { closeAll(): void };
    templateWatcher: { closeAll(): void };
    notesWatcher: { closeAll(): void };
    wikiManager: { disposeAll(): void } | undefined;
    scheduleManager: { dispose(): void };
    scheduleInfraDispose: () => void;
    notesGitTimerManager: NotesGitTimerManager;
    bridge: MultiRepoQueueRouter;
    queuePersistence: { dispose(): void };
    wsServer: ProcessWebSocketServer;
    terminalWsServer?: { closeAll(): void };
    terminalSessionManager?: { destroyAll(): void };
    remoteServerConnector: { dispose(): void };
    remoteServerSshConnector: { dispose(): void };
    loopExecutor?: { shutdownAll(): void };
    loopInfraDispose?: () => void;
    triggerManager?: { shutdownAll(): void };
    triggerInfraDispose?: () => void;
    mcpOauthDispose?: () => void;
    syncEngines?: Map<string, SyncEngine>;
    workItemGitHubPullPoller?: { dispose(): void };
    workItemAzureBoardsPullPoller?: { dispose(): void };
    activeWorkspaceBackgroundRefresher?: { dispose(): void };
    dreamIdleScheduler?: { dispose(): void };
    agentProvidersQuotaCache?: { dispose(): void };
    containerLink?: { stop(): void };
    activeSockets: Set<import('net').Socket>;
    server: http.Server;
}

function buildCloseHandler(deps: CloseHandlerDeps): (opts?: ServerCloseOptions) => Promise<{ drainOutcome?: 'completed' | 'timeout' }> {
    return async (closeOptions) => {
        const { staleDetector, outputPruner, taskWatcher, pipelineWatcher, templateWatcher, notesWatcher,
                wikiManager, scheduleManager, bridge, queuePersistence, wsServer, activeSockets, server } = deps;

        staleDetector.dispose();
        outputPruner.stopListening();
        deps.heapMonitor.dispose();
        taskWatcher.closeAll();
        pipelineWatcher.closeAll();
        templateWatcher.closeAll();
        notesWatcher.closeAll();
        wikiManager?.disposeAll();
        scheduleManager.dispose();
        deps.scheduleInfraDispose();
        deps.loopExecutor?.shutdownAll();
        deps.loopInfraDispose?.();
        deps.triggerManager?.shutdownAll();
        deps.triggerInfraDispose?.();
        deps.mcpOauthDispose?.();
        deps.syncEngines?.forEach(e => e.stop());
        deps.workItemGitHubPullPoller?.dispose();
        deps.workItemAzureBoardsPullPoller?.dispose();
        deps.activeWorkspaceBackgroundRefresher?.dispose();
        deps.dreamIdleScheduler?.dispose();
        deps.agentProvidersQuotaCache?.dispose();
        deps.containerLink?.stop();
        gitInfoCache.dispose();
        deps.notesGitTimerManager.dispose();

        let drainOutcome: 'completed' | 'timeout' | undefined;
        if (closeOptions?.drain) {
            const result = await bridge.drainAll(closeOptions.drainTimeoutMs);
            drainOutcome = result.outcome;
        }

        queuePersistence.dispose();
        if (!closeOptions?.drain) {
            bridge.dispose();
        }

        deps.terminalSessionManager?.destroyAll();
        deps.terminalWsServer?.closeAll();
        deps.remoteServerConnector.dispose();
        deps.remoteServerSshConnector.dispose();
        wsServer.closeAll();
        for (const socket of activeSockets) {
            socket.destroy();
        }
        activeSockets.clear();
        await new Promise<void>((resolve, reject) => {
            server.close((err) => {
                if (err) { reject(err); } else { resolve(); }
            });
        });

        return { drainOutcome };
    };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create and start the CoC execution server.
 *
 * @param options - Server options
 * @returns A running ExecutionServer instance
 */
export async function createExecutionServer(options: ExecutionServerOptions = {}): Promise<ExecutionServer> {
    const port = options.port ?? 4000;
    const host = options.host ?? '127.0.0.1';
    const dataDir = options.dataDir ?? path.join(os.homedir(), '.coc');
    const store = options.store ?? createStubStore();
    fs.mkdirSync(dataDir, { recursive: true });

    const runtimeConfigService = new RuntimeConfigService({ configPath: options.configPath, fileConfig: options.fileConfig });

    // Startup-captured config snapshot. Consumers below that use this directly
    // are infrastructure that wires once at startup. Admin-editable fields among
    // them are classified as follows:
    //
    //   restartRequired (infrastructure wired at startup):
    //     - terminal.enabled   → terminal pty/session manager
    //     - loops.enabled      → loop executor, timer registry
    //
    //   Live but still startup-captured in queue infrastructure (future migration):
    //     - timeout            → defaultTimeoutMs passed to queue infra
    //     - chat.followUpSuggestions, chat.askUser → queue executor behavior
    //
    //   Non-admin-editable (no migration needed):
    //     - mcpOauth.enabled   → MCP OAuth infra
    //     - monitoring.heapCheck → heap monitor
    //     - skills.autoUpdate, skills.defaultSkills → startup skill install
    //     - features.autoMemoryPromotion → auto-promote scheduler
    //
    // Route handlers and SPA feature flags use runtimeConfigService for live
    // reads (see registerAllRoutes and spaHtml closure below).
    const resolvedConfig = runtimeConfigService.config;
    const defaultTimeoutMs = resolvedConfig.timeout ? resolvedConfig.timeout * 1000 : DEFAULT_AI_TIMEOUT_MS;

    // Forward declaration — bridge captures this via closure before wsServer is assigned
    let wsServer!: ProcessWebSocketServer;

    // Forward declaration — terminal infra is created after the HTTP server
    let terminalInfra: import('./infrastructure/terminal-infrastructure').TerminalInfrastructure | undefined;

    // Forward declaration — loop infra is created after queue infra
    let loopInfra: LoopInfrastructure | undefined;

    // Forward declaration — trigger infra is created after queue infra
    let triggerInfra: TriggerInfrastructure | undefined;

    // Forward declaration — the in-process enqueue capability for the opt-in
    // `send_to_conversation` tool is bound at the route layer (where the queue
    // global state + provider-default resolution live), which runs after the
    // queue infra (and its executors) are created. The late-bound getter passed
    // to createQueueInfrastructure reads this once routes finish registering.
    let enqueueChatCapability: import('./llm-tools/send-to-conversation-tool').EnqueueChatFn | undefined;

    // MCP OAuth infra — enabled by default when any MCP server may be configured.
    const mcpOauthEnabled = resolvedConfig.mcpOauth?.enabled ?? true;
    const mcpOauthInfra = mcpOauthEnabled
        ? createMcpOauthInfrastructure({
            autoRefresh: resolvedConfig.mcpOauth?.autoRefresh?.enabled
                ? { enabled: true }
                : undefined,
        })
        : undefined;

    // Register the Codex provider unconditionally so per-chat routing can resolve
    // Codex even when it was enabled after startup. Codex authentication is owned
    // by the Codex SDK/CLI rather than the CoC server.
    registerCodexSDKService();

    // Register the Claude provider unconditionally so the /api/agent-providers
    // endpoint and per-chat routing can check availability regardless of whether
    // claude.enabled was set at startup. Live config gates actual usage.
    registerClaudeSDKService();

    // Register the OpenCode provider unconditionally so per-chat routing can
    // resolve OpenCode. Live config gates actual usage.
    registerOpenCodeSDKService();

    const requestedProvider = resolvedConfig.defaultProvider === 'codex' ? 'codex'
        : resolvedConfig.defaultProvider === 'claude' ? 'claude'
        : resolvedConfig.defaultProvider === 'opencode' ? 'opencode'
        : 'copilot';
    const effectiveProvider = requestedProvider === 'codex' && sdkServiceRegistry.has(SDK_PROVIDER_CODEX)
        ? 'codex'
        : requestedProvider === 'claude' && sdkServiceRegistry.has(SDK_PROVIDER_CLAUDE)
            ? 'claude'
            : requestedProvider === 'opencode' && sdkServiceRegistry.has(SDK_PROVIDER_OPENCODE)
                ? 'opencode'
                : 'copilot';
    if (requestedProvider === 'codex' && effectiveProvider !== 'codex') {
        process.stderr.write('[ExecutionServer] defaultProvider=codex requested, but Codex provider is not registered; falling back to Copilot\n');
    }
    if (requestedProvider === 'claude' && effectiveProvider !== 'claude') {
        process.stderr.write('[ExecutionServer] defaultProvider=claude requested, but Claude provider is not registered; falling back to Copilot\n');
    }
    if (requestedProvider === 'opencode' && effectiveProvider !== 'opencode') {
        process.stderr.write('[ExecutionServer] defaultProvider=opencode requested, but OpenCode provider is not registered; falling back to Copilot\n');
    }
    const resolvedAiService = options.aiService ?? sdkServiceRegistry.getOrThrow(
        effectiveProvider === 'codex' ? SDK_PROVIDER_CODEX
            : effectiveProvider === 'claude' ? SDK_PROVIDER_CLAUDE
            : effectiveProvider === 'opencode' ? SDK_PROVIDER_OPENCODE
            : SDK_PROVIDER_COPILOT,
    );

    // Per-chat provider resolver: checks runtime enablement, then looks up the
    // SDK service. Returns the Copilot service unconditionally; blocks Codex/Claude
    // when their respective enabled flag is false in the live admin config.
    const resolveAiServiceForProvider = (provider: import('./tasks/task-types').ChatProvider): import('@plusplusoneplusplus/forge').ISDKService => {
        if (provider === 'codex') {
            const liveConfig = runtimeConfigService.config;
            if (!liveConfig.codex?.enabled) {
                throw new Error('Codex provider is currently disabled. Enable Codex in Admin settings to use it.');
            }
            const svc = sdkServiceRegistry.get(SDK_PROVIDER_CODEX);
            if (!svc) {
                throw new Error('Codex SDK service is not available. Codex may not be installed on this server.');
            }
            return svc;
        }
        if (provider === 'claude') {
            const liveConfig = runtimeConfigService.config;
            if (!liveConfig.claude?.enabled) {
                throw new Error('Claude provider is currently disabled. Enable Claude in Admin settings to use it.');
            }
            const svc = sdkServiceRegistry.get(SDK_PROVIDER_CLAUDE);
            if (!svc) {
                throw new Error('Claude SDK service is not available. Install @anthropic-ai/claude-agent-sdk and restart the server.');
            }
            return svc;
        }
        if (provider === 'opencode') {
            const liveConfig = runtimeConfigService.config;
            if (!liveConfig.opencode?.enabled) {
                throw new Error('OpenCode provider is currently disabled. Enable OpenCode in Admin settings to use it.');
            }
            const svc = sdkServiceRegistry.get(SDK_PROVIDER_OPENCODE);
            if (!svc) {
                throw new Error('OpenCode SDK service is not available. Install @opencode-ai/sdk and restart the server.');
            }
            return svc;
        }
        return options.aiService ?? sdkServiceRegistry.getOrThrow(SDK_PROVIDER_COPILOT);
    };

    const { registry, bridge, queuePersistence, queueFacade } = createQueueInfrastructure(
        store, dataDir, { ...options, aiService: resolvedAiService }, defaultTimeoutMs,
        resolvedConfig.chat.followUpSuggestions, resolvedConfig.chat.askUser, () => wsServer,
        () => {
            if (!loopInfra) return undefined;
            return {
                store: loopInfra.loopStore,
                executor: loopInfra.loopExecutor,
                emit: loopInfra.emit,
                resolveWorkspaceId: async (processId: string) => {
                    try {
                        const taskId = processId.startsWith('queue_') ? processId.slice(6) : processId;
                        const task = bridge.getTask(taskId);
                        return task?.repoId;
                    } catch { return undefined; }
                },
                enqueueWakeup: createEnqueueWakeup({
                    timerRegistry: loopInfra!.timerRegistry,
                    store,
                    executeFollowUp: (processId, message, attachments, mode, deliveryMode, images, selectedSkillNames, model, turnSource) =>
                        bridge.executeFollowUp(processId, message, attachments, mode, deliveryMode, images, selectedSkillNames, model, turnSource),
                }),
            };
        },
        () => mcpOauthInfra?.manager,
        effectiveProvider,
        resolveAiServiceForProvider,
        resolvedConfig.features.ralphMultiAgentGrill,
        // Live read of the admin global system prompt so edits apply without a
        // restart. Threaded to user-facing chat executors via the queue bridge.
        () => runtimeConfigService.config.chat.globalSystemPrompt,
        // Forward-reference accessor for the trigger manager so the queue bridge
        // can clear a trigger's in-flight guard when its fix turn completes.
        // triggerInfra is created after queue infra (like loopInfra), so read it
        // lazily through this closure.
        () => triggerInfra ? { manager: triggerInfra.triggerManager } : undefined,
        // Late-bound enqueue capability for the `send_to_conversation` tool;
        // bound at the route layer below, read here once routes register.
        () => enqueueChatCapability,
    );

    // Finalize any orphaned 'running' / 'cancelling' processes left behind by
    // an unclean shutdown, before we accept client requests. Chat follow-ups
    // re-enqueued by the queue persistence layer (restore() already ran inside
    // createQueueInfrastructure) point their payload.processId back at the
    // original conversation, so those processes are recoverable — revive them
    // to 'queued' rather than mark them failed.
    try {
        const resumableProcessIds = collectResumableFollowUpProcessIds([
            ...queueFacade.getQueued(),
            ...queueFacade.getRunning(),
        ]);
        const { finalized, revived } = await sweepOrphanedRunningProcesses(store, {
            error: 'Process orphaned by server restart',
            protectedProcessIds: resumableProcessIds,
        });
        if (finalized > 0 || revived > 0) {
            process.stderr.write(
                `[ExecutionServer] Startup recovery: finalized ${finalized} orphaned in-flight process(es), revived ${revived} to pending\n`,
            );
        }
    } catch {
        // Non-fatal — startup must not be blocked by sweep failures.
    }

    // AC-04: re-enqueue an ask_user resume for any process that still carries a
    // durable pendingAskUserAnswer but has no in-flight resume task. Covers a
    // restart that landed between the answer submit and the resume running.
    // Idempotent — resume tasks restored by the queue persistence layer are
    // detected as in-flight and skipped. Uses the router (bridge) to enqueue so
    // workspace-only processes route to the correct per-repo queue, and the
    // aggregate facade to read in-flight tasks across all repos.
    try {
        const reenqueued = await reenqueuePendingAskUserResumes(store, {
            getQueued: () => queueFacade.getQueued(),
            getRunning: () => queueFacade.getRunning(),
            enqueue: (input) => bridge.enqueue(input),
        });
        if (reenqueued > 0) {
            process.stderr.write(
                `[ExecutionServer] Startup recovery: re-enqueued ${reenqueued} pending ask_user resume(s)\n`,
            );
        }
    } catch {
        // Non-fatal — startup must not be blocked by resume re-enqueue failures.
    }

    const { scheduleManager, dispose: scheduleInfraDispose } = createScheduleInfrastructure(dataDir, queueFacade, store);

    const loopsEnabled = resolvedConfig.loops?.enabled ?? false;

    // Loop infrastructure — separate from schedules. Gated by loops.enabled feature flag (default false).
    if (loopsEnabled) {
        loopInfra = await createLoopInfrastructure({
            dataDir,
            queueFacade,
            store,
            emit: (event) => {
                try {
                    wsServer?.broadcastProcessEvent({
                        type: event.type,
                        loopId: event.loop.id,
                        processId: event.loop.processId,
                        status: event.loop.status,
                        workspaceId: event.loop.workspaceId,
                        timestamp: Date.now(),
                    });
                } catch { /* best-effort broadcast */ }
            },
            resolveWorkspaceId: async (processId: string) => {
                try {
                    const taskId = processId.startsWith('queue_') ? processId.slice(6) : processId;
                    const task = bridge.getTask(taskId);
                    return task?.repoId;
                } catch {
                    return undefined;
                }
            },
        });
    }

    const triggersEnabled = resolvedConfig.triggers?.enabled ?? false;

    // Trigger infrastructure — generic event → action framework (CI auto-fix
    // monitor this iteration). Gated by triggers.enabled feature flag (default
    // false). Mirrors the loop infra wiring; re-arms active triggers on startup.
    if (triggersEnabled) {
        triggerInfra = await createTriggerInfrastructure({
            dataDir,
            queueFacade,
            store,
            emit: (event) => {
                try {
                    wsServer?.broadcastProcessEvent({
                        type: event.type,
                        triggerId: event.trigger.id,
                        processId: event.trigger.processId,
                        status: event.trigger.status,
                        workspaceId: event.trigger.workspaceId,
                        timestamp: Date.now(),
                    });
                } catch { /* best-effort broadcast */ }
            },
            resolveWorkspaceId: async (processId: string) => {
                try {
                    const taskId = processId.startsWith('queue_') ? processId.slice(6) : processId;
                    const task = bridge.getTask(taskId);
                    return task?.repoId;
                } catch {
                    return undefined;
                }
            },
            ciChecksFetcher: createCiChecksFetcher({ dataDir, store }),
            ciLogFetcher: createCiLogFetcher({ store }),
        });
    }

    // Cleanup infra is created after the store is ready
    let cleanupInfra: ReturnType<typeof createCleanupInfrastructure>;

    const heapMonitor = new HeapMonitor(resolvedConfig.monitoring.heapCheck);
    heapMonitor.start();

    // Auto-migrate legacy workspace/wiki registries from JSON to SQLite
    await migrateWorkspaceRegistryIfNeeded(dataDir, store);

    // Auto-migrate legacy file-based process histories to SQLite
    await migrateProcessHistoryIfNeeded(dataDir, store);

    // Auto-migrate legacy path-only workspace IDs to the machine-scoped
    // (ws-v2-) scheme so colliding clones on different machines stay distinct.
    // Uses the RAW OS hostname as the machine identity.
    await migrateWorkspaceIdsToV2IfNeeded(dataDir, store, os.hostname());

    // Auto-update stale globally-installed bundled skills (non-blocking on errors)
    if (resolvedConfig.skills.autoUpdate) {
        const globalSkillsDir = path.join(dataDir, 'skills');
        autoUpdateBundledSkills(globalSkillsDir).then(result => {
            if (result.updated.length > 0) {
                for (const u of result.updated) {
                    process.stderr.write(`[skills] Auto-updated "${u.name}" ${u.previousVersion} → ${u.newVersion}\n`);
                }
            }
            for (const e of result.errors) {
                process.stderr.write(`[skills] Failed to update "${e.name}": ${e.error}\n`);
            }
        }).catch(() => { /* best-effort — never block startup */ });
    }

    // Auto-install default bundled skills into the global skills dir (non-blocking on errors).
    // When loops feature is disabled, strip the `loop` skill so its prompt suffix doesn't
    // leak into sessions where the underlying tools aren't wired.
    const defaultSkillsToInstall = loopsEnabled
        ? resolvedConfig.skills.defaultSkills
        : resolvedConfig.skills.defaultSkills.filter(name => name !== 'loop');
    if (defaultSkillsToInstall.length > 0) {
        const globalSkillsDir = path.join(dataDir, 'skills');
        autoInstallDefaultSkills(globalSkillsDir, defaultSkillsToInstall).then(result => {
            for (const name of result.installed) {
                process.stderr.write(`[skills] Auto-installed default skill "${name}"\n`);
            }
            for (const e of result.errors) {
                process.stderr.write(`[skills] Failed to install default skill "${e.name}": ${e.error}\n`);
            }
        }).catch(() => { /* best-effort — never block startup */ });
    }

    // Mirror installed bundled skills to Codex when Codex is enabled (non-blocking on errors).
    // This happens once on server startup to ensure Codex has access to all globally installed
    // bundled skills without needing to read from ~/.coc/skills directly.
    if (resolvedConfig.codex?.enabled) {
        const globalSkillsDir = path.join(dataDir, 'skills');
        import('./skills/codex-skill-mirror').then(({ syncInstalledSkillsToCodex }) => {
            return syncInstalledSkillsToCodex(globalSkillsDir);
        }).then(result => {
            if (result.synced.length > 0) {
                process.stderr.write(`[skills] Synced ${result.synced.length} skill(s) to Codex\n`);
            }
            for (const e of result.errors) {
                process.stderr.write(`[skills] Failed to sync "${e.name}" to Codex: ${e.error}\n`);
            }
        }).catch(() => { /* best-effort — never block startup */ });
    }

    // Mirror installed bundled skills to Claude Code when the Claude provider is enabled
    // (non-blocking on errors). Copies each skill's SKILL.md to ~/.claude/commands/<name>.md
    // so Claude Code discovers them as slash commands on next startup.
    if (resolvedConfig.claude?.enabled) {
        const globalSkillsDir = path.join(dataDir, 'skills');
        import('./skills/claude-skill-mirror').then(({ syncInstalledSkillsToClaude }) => {
            return syncInstalledSkillsToClaude(globalSkillsDir);
        }).then(result => {
            if (result.synced.length > 0) {
                process.stderr.write(`[skills] Synced ${result.synced.length} skill(s) to Claude\n`);
            }
            for (const e of result.errors) {
                process.stderr.write(`[skills] Failed to sync "${e.name}" to Claude: ${e.error}\n`);
            }
        }).catch(() => { /* best-effort — never block startup */ });
    }

    const globalWorkspace = await ensureGlobalWorkspace(dataDir, store);
    bridge.registerRepoId(globalWorkspace.id, globalWorkspace.rootPath);

    const myWorkWorkspace = await ensureMyWorkWorkspace(dataDir, store);
    const myWorkSkillsDir = path.join(myWorkWorkspace.rootPath, DEFAULT_SKILLS_SETTINGS.installPath);
    autoInstallMyWorkSkills(myWorkSkillsDir).then(result => {
        for (const name of result.installed) {
            process.stderr.write(`[skills] Auto-installed My Work skill "${name}"\n`);
        }
        for (const e of result.errors) {
            process.stderr.write(`[skills] Failed to install My Work skill "${e.name}": ${e.error}\n`);
        }
    }).catch(() => { /* best-effort — never block startup */ });
    bridge.registerRepoId(myWorkWorkspace.id, myWorkWorkspace.rootPath);

    const myLifeWorkspace = await ensureMyLifeWorkspace(dataDir, store);
    bridge.registerRepoId(myLifeWorkspace.id, myLifeWorkspace.rootPath);

    // Eagerly register all known workspaces with the schedule manager so repo
    // schedules start timers immediately — not lazily on first HTTP request.
    const allWorkspaces = await store.getWorkspaces();
    for (const ws of allWorkspaces) {
        scheduleManager.registerWorkspacePath(ws.id, ws.rootPath);
    }

    const aiInvoker = createCLIAIInvoker({ approvePermissions: true, aiService: resolvedAiService });
    cleanupInfra = createCleanupInfrastructure(store, dataDir, queueFacade);
    const { outputPruner, staleDetector } = cleanupInfra;
    const notesGitTimerManager = new NotesGitTimerManager();
    const remoteServerStore = new RemoteServerStore(dataDir);
    const remoteServerConnector = new DevTunnelConnector();
    const remoteServerSshConnector = new SshConnector();

    // Sync engines — one per virtual workspace, only active when gitRemote is configured.
    const syncEngines = new Map<string, SyncEngine>();
    for (const workspaceId of ['my_work', 'my_life']) {
        syncEngines.set(workspaceId, new SyncEngine({
            dataDir,
            workspaceId,
            aiInvoker,
        }));
    }

    let localBaseUrl = formatLocalBaseUrl(host, port);
    const routes: Route[] = [];
    const { wikiManager, workItemGitHubPullPoller, workItemAzureBoardsPullPoller, agentProvidersQuotaCache, activeWorkspaceBackgroundRefresher, dreamIdleScheduler } = registerAllRoutes(routes, {
        store, bridge, queueFacade, scheduleManager,
        notesGitTimerManager,
        dataDir, configPath: options.configPath,
        tokenTtlMs: options.tokenTtlMs,
        globalWorkspaceRootPath: globalWorkspace.rootPath,
        resolvedAiService, getWsServer: () => wsServer,
        queuePersistence, wikiOptions: options.wiki,
        aiInvoker,
        getTerminalSessionManager: () => terminalInfra?.terminalSessionManager,
        resolvedConfig,
        runtimeConfigService,
        remoteServerStore,
        remoteServerConnector,
        remoteServerSshConnector,
        getLocalBaseUrl: () => localBaseUrl,
        loopStore: loopInfra?.loopStore,
        loopExecutor: loopInfra?.loopExecutor,
        triggerStore: triggerInfra?.triggerStore,
        triggerManager: triggerInfra?.triggerManager,
        triggerEmit: triggerInfra?.emit,
        mcpOauthManager: mcpOauthInfra?.manager,
        resolveAiServiceForProvider,
        loopEmit: loopInfra?.emit,
        hostname: os.hostname(),
        bindAddress: host,
        syncEngines,
        nativeCopilotSessionDbPath: options.nativeCopilotSessionDbPath,
        nativeCopilotSessionStateDir: options.nativeCopilotSessionStateDir,
        setEnqueueChat: (fn) => { enqueueChatCapability = fn; },
    });
    // Restore auto-commit timers for all workspaces that had it enabled
    notesGitTimerManager.startAll(store, dataDir).catch(() => { /* best-effort */ });

    // Container link persistence helpers
    const containerLinkConfigPath = path.join(dataDir, 'container-link.json');
    function saveContainerLinkConfig(url: string | undefined, agentName: string | undefined): void {
        try {
            if (url) {
                fs.writeFileSync(containerLinkConfigPath, JSON.stringify({ containerUrl: url, agentName: agentName ?? null }));
            } else {
                if (fs.existsSync(containerLinkConfigPath)) fs.unlinkSync(containerLinkConfigPath);
            }
        } catch { /* best-effort */ }
    }
    function loadContainerLinkConfig(): { containerUrl: string; agentName?: string } | null {
        try {
            if (fs.existsSync(containerLinkConfigPath)) {
                const raw = JSON.parse(fs.readFileSync(containerLinkConfigPath, 'utf8'));
                if (raw?.containerUrl) return raw;
            }
        } catch { /* ignore corrupt file */ }
        return null;
    }

    // Container link state (mutable — can be set/cleared via API)
    let containerLink: ContainerLinkClient | undefined;
    let containerLinkBroadcastUnsub: (() => void) | undefined;
    // CLI flag takes priority; otherwise load persisted config
    const savedLinkConfig = !options.containerUrl ? loadContainerLinkConfig() : null;
    let containerLinkUrl: string | undefined = options.containerUrl ?? savedLinkConfig?.containerUrl;
    let containerLinkAgentName: string | undefined = options.containerAgentName ?? savedLinkConfig?.agentName;

    registerContainerLinkRoutes(routes, {
        getContainerLink: () => containerLink,
        getContainerUrl: () => containerLinkUrl,
        getAgentName: () => containerLinkAgentName,
        setContainerLink: (url: string, agentName?: string) => {
            containerLink?.stop();
            containerLinkBroadcastUnsub?.();
            containerLinkUrl = url;
            containerLinkAgentName = agentName ?? containerLinkAgentName;
            saveContainerLinkConfig(containerLinkUrl, containerLinkAgentName);
            containerLink = new ContainerLinkClient({
                containerUrl: url,
                agentName: containerLinkAgentName,
                localPort: port,
                getWorkspaces: async () => {
                    const ws = await store.getWorkspaces();
                    return ws.map(w => ({ id: w.id, name: w.name, rootPath: w.rootPath }));
                },
            });
            containerLink.start();
            containerLinkBroadcastUnsub = wsServer.onBroadcast(data => containerLink?.forwardEvent(data));
            process.stderr.write(`[container-link] Connecting to container at ${url}\n`);
        },
        clearContainerLink: () => {
            containerLink?.stop();
            containerLinkBroadcastUnsub?.();
            containerLink = undefined;
            containerLinkBroadcastUnsub = undefined;
            containerLinkUrl = undefined;
            saveContainerLinkConfig(undefined, undefined);
            process.stderr.write(`[container-link] Disconnected\n`);
        },
    });

    const rawHostname = os.hostname();
    const handler = createRequestHandler({
        routes, spaHtml: () => {
            // Use RuntimeConfigService snapshot for feature flags so admin
            // config updates are reflected without re-reading disk on every
            // page load. The SPA also fetches /api/config/runtime for fresh
            // feature flags, making the embedded values bootstrap-only.
            const liveConfig = runtimeConfigService.config;
            return generateDashboardHtml({
                enableWiki: true,
                hostname: liveConfig.serve?.serverName || shortenHostname(rawHostname),
                features: buildRuntimeFeatures(liveConfig),
                bindAddress: host,
            });
        },
        store, spaETag: () => getBundleETag(runtimeConfigService.revision),
        staticDir: path.join(__dirname, 'spa', 'client', 'dist'),
        getIconSvg: () => generateIconSvg(rawHostname),
    });
    const server = http.createServer(handler);

    // Terminal infrastructure (optional — gated by config + node-pty availability)
    terminalInfra = createTerminalInfrastructure(store, resolvedConfig);

    wsServer = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager, terminalInfra?.terminalWsServer);
    const { taskWatcher, pipelineWatcher, templateWatcher, notesWatcher } =
        await createWatcherInfrastructure(store, dataDir, wsServer, bridge);

    try {
        await modelMetadataStore.initialize(resolvedAiService as unknown as { listModels(): Promise<ModelInfo[]> });
    } catch (err) {
        process.stderr.write(`[ModelMetadataStore] warm-up failed: ${(err as Error)?.message ?? err}\n`);
    }

    await new Promise<void>((resolve, reject) => { server.on('error', reject); server.listen(port, host, resolve); });
    try {
        void remoteServerConnector.connectConfigured(remoteServerStore.list());
        void remoteServerSshConnector.connectConfigured(remoteServerStore.list());
    } catch (error) {
        process.stderr.write(`[servers] Failed to start remote server connectors: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    cleanupAllStalePasteFiles(dataDir).catch(() => { /* best-effort */ });
    try {
        pruneAllStaleClassifications(dataDir);
    } catch {
        /* best-effort */
    }

    // Start sync engines after server is listening (fire-and-forget — never blocks startup)
    for (const [workspaceId, engine] of syncEngines) {
        try {
            const prefsPath = path.join(dataDir, 'repos', workspaceId, 'preferences.json');
            if (fs.existsSync(prefsPath)) {
                const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
                if (prefs?.sync?.gitRemote) {
                    engine.start(prefs.sync.gitRemote, prefs.sync.intervalMinutes ?? 5).catch(() => {});
                }
            }
        } catch { /* best-effort */ }
    }
    workItemGitHubPullPoller.start().catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[work-items/github-poll] Failed to start background polling: ${message}\n`);
    });
    workItemAzureBoardsPullPoller.start().catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[work-items/azure-boards-poll] Failed to start background polling: ${message}\n`);
    });
    activeWorkspaceBackgroundRefresher.start();
    dreamIdleScheduler.start();

    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    localBaseUrl = formatLocalBaseUrl(host, actualPort);
    const displayHost = host === '0.0.0.0' || host === '::' || host === '127.0.0.1' ? 'localhost' : host;
    const url = `http://${displayHost}:${actualPort}`;

    const activeSockets = new Set<import('net').Socket>();
    server.on('connection', (socket) => { activeSockets.add(socket); socket.on('close', () => activeSockets.delete(socket)); });

    // Start container link if configured via CLI or persisted config (call-home mode)
    if (containerLinkUrl) {
        containerLink = new ContainerLinkClient({
            containerUrl: containerLinkUrl,
            agentName: containerLinkAgentName,
            localPort: actualPort,
            getWorkspaces: async () => {
                const ws = await store.getWorkspaces();
                return ws.map(w => ({ id: w.id, name: w.name, rootPath: w.rootPath }));
            },
        });
        containerLink.start();
        containerLinkBroadcastUnsub = wsServer.onBroadcast(data => containerLink?.forwardEvent(data));
        process.stderr.write(`[container-link] Connecting to container at ${containerLinkUrl}\n`);
    }

    return {
        server, store, wsServer, port: actualPort, host, url,
        close: buildCloseHandler({
            staleDetector, outputPruner, heapMonitor, taskWatcher, pipelineWatcher, templateWatcher, notesWatcher,
            wikiManager, scheduleManager, scheduleInfraDispose, notesGitTimerManager, bridge, queuePersistence, wsServer,
            terminalWsServer: terminalInfra?.terminalWsServer,
            terminalSessionManager: terminalInfra?.terminalSessionManager,
            remoteServerConnector,
            remoteServerSshConnector,
            loopExecutor: loopInfra?.loopExecutor,
            loopInfraDispose: loopInfra?.dispose,
            triggerManager: triggerInfra?.triggerManager,
            triggerInfraDispose: triggerInfra?.dispose,
            mcpOauthDispose: mcpOauthInfra?.dispose,
            syncEngines,
            workItemGitHubPullPoller,
            workItemAzureBoardsPullPoller,
            activeWorkspaceBackgroundRefresher,
            dreamIdleScheduler,
            agentProvidersQuotaCache,
            containerLink,
            activeSockets, server,
        }),
    };
}

// ============================================================================
// Public API
// ============================================================================

export type { ExecutionServerOptions, ExecutionServer, Route, WikiServerOptions, ServerCloseOptions, ServeCommandOptions } from './types';
export type { ProcessStore } from '@plusplusoneplusplus/forge';

// Runtime Config Service
export { RuntimeConfigService } from '../config/runtime-config-service';
export type { RuntimeConfigSnapshot, RuntimeConfigUpdateResult, ConfigChangeEffect, ConfigFieldRuntime, ConfigChangeListener } from '../config/runtime-config-service';

// HTTP helpers (canonical source: shared/router.ts)
export { sendJson, send404, send400, send500, sendError, readJsonBody } from './shared/router';
export { createRequestHandler } from './router';
export type { RouterOptions } from './router';

// CORS / cross-origin policy (loopback-only allowance for REST + WS)
export { applyCorsHeaders, getDefaultCorsPolicy, isLoopbackOrigin } from './shared/cors';
export type { CorsPolicy } from './shared/cors';

// Deprecated compat wrapper — use sendJson(res, data, statusCode) instead
export { sendJSON, parseBody, parseQueryParams, stripExcludedFields } from './core/api-handler';
export { detectRemoteUrl, normalizeRemoteUrl } from './core/api-handler';

// WebSocket
export { ProcessWebSocketServer, toProcessSummary, toCommentSummary, attachWebSocketUpgradeHandler, isWebSocketOriginAllowed } from './streaming/websocket';
export type { WSClient, ProcessSummary, MarkdownCommentSummary, QueueTaskSummary, ServerMessage, ClientMessage, QueueSnapshot } from './streaming/websocket';

// Terminal
export { TerminalWebSocketServer } from './terminal/index';
export { TerminalSessionManager, toSessionInfo } from './terminal/index';
export type { TerminalSessionManagerOptions, IPty, TerminalSession, TerminalSessionInfo, TerminalClientMessage, TerminalServerMessage } from './terminal/index';
export { registerTerminalRoutes } from './terminal/terminal-routes';
export { createTerminalInfrastructure } from './infrastructure/terminal-infrastructure';
export type { TerminalInfrastructure } from './infrastructure/terminal-infrastructure';

// SSE
export { handleProcessStream } from './streaming/sse-handler';

// SPA
export { generateDashboardHtml } from './spa';
export type { DashboardOptions } from './spa';

// Global workspace
export { ensureGlobalWorkspace, GLOBAL_WORKSPACE_ID, GLOBAL_WORKSPACE_NAME } from './workspaces/global-workspace';

// Queue
export { CLITaskExecutor, createQueueExecutorBridge, defaultIsExclusive, DEFAULT_FOLLOW_UP_SUGGESTIONS } from './queue/queue-executor-bridge';
export type { QueueExecutorBridgeOptions, QueueExecutorBridge } from './queue/queue-executor-bridge';
export { ExecutorRegistry } from './executors/executor-registry';
export type { ExecutorRegistryOptions } from './executors/executor-registry';
export type { ITaskExecutor } from './executors/executor-types';
export { MultiRepoQueueRouter } from './queue/multi-repo-queue-router';
export { SqliteQueuePersistence } from './queue/sqlite-queue-persistence';
export type { RestartPolicy } from './queue/sqlite-queue-persistence';
export { ImageBlobStore } from './queue/image-blob-store';

// Data management
export { DataWiper } from './storage/data-wiper';
export type { WipeOptions, WipeResult } from './storage/data-wiper';
export { exportAllData } from './storage/data-exporter';
export { importData } from './storage/data-importer';
export type { CoCExportPayload, ImportOptions } from './storage/export-import-types';
export { EXPORT_SCHEMA_VERSION, validateExportPayload } from './storage/export-import-types';

// Admin & tokens
export { registerAdminRoutes, resetWipeToken, resetMigrateToken, resetDirectoryImportToken, getBuiltInPrompts } from './admin/admin-handler';
export type { AdminRouteOptions, BuiltInPrompt } from './admin/admin-handler';
export { generateImportToken, generateWipeToken, generateMigrateToken, importTokenManager, resetImportToken, wipeTokenManager, migrateTokenManager, directoryImportTokenManager, validateImportToken, validateMigrateToken, validateWipeToken, TOKEN_EXPIRY_MS, TokenManager } from './admin/admin-handler';

// Scheduling
export { ScheduleYamlPersistence } from './schedule/schedule-yaml-persistence';
export { SqliteScheduleRunPersistence } from './schedule/sqlite-schedule-run-persistence';
export { ScheduleManager, parseCron, nextCronTime, describeCron } from './schedule/schedule-manager';
export type { ScheduleEntry, ScheduleRunRecord, ScheduleStatus, ScheduleOnFailure, ScheduleChangeEvent } from './schedule/schedule-manager';

// Loops
export { LoopStore, LoopExecutor, registerLoopRoutes } from './loops';
export type { LoopEntry, LoopStatus, LoopChangeEvent, LoopEventEmit, LoopExecutorDeps, LoopRouteContext } from './loops';
export { createLoopInfrastructure } from './infrastructure/loop-infrastructure';
export type { LoopInfrastructure, LoopInfrastructureOptions } from './infrastructure/loop-infrastructure';

// Tasks
export type { ChatPayload } from './tasks/task-types';
export { isChatPayload, hasTaskGenerationContext } from './tasks/task-types';
export { resolveTaskRoot, ensureTaskRoot, resolveAllTaskRoots } from './tasks/task-root-resolver';
export type { TaskRootInfo, TaskRootOptions } from './tasks/task-root-resolver';
export { registerTaskCommentsRoutes, TaskCommentsManager } from './tasks/comments/task-comments-handler';
export type { TaskComment, CommentAnchor, CommentsStorage } from './tasks/comments/task-comments-handler';
export { registerDiffCommentsRoutes, DiffCommentsManager } from './tasks/comments/diff-comments-handler';
export type { DiffCommentsStorage } from './tasks/comments/diff-comments-handler';

// Preferences
export { registerPreferencesRoutes, readPreferences, writePreferences, validatePreferences } from './preferences-handler';
export type { UserPreferences } from './preferences-handler';

// Prompts
export { discoverPromptFiles, readPromptFileContent } from './prompts/prompt-utils';
export type { PromptFileInfo } from './prompts/prompt-utils';

// Wiki
export { registerWikiRoutes } from './wiki';
export type { WikiRouteOptions } from './wiki';
export { FileWatcher } from './wiki/file-watcher';
export { WikiData } from './wiki/wiki-data';
export type { ComponentAnalysis, ComponentGraph } from './wiki/types';

// Logging
export { captureEntry, clearLogBuffer } from './logging/server-log-capture';

// Paths
export { getRepoDataPath } from './paths';

// Heap monitoring
export { HeapMonitor, getHeapSnapshot, registerHeapRoutes } from './admin/heap-monitor';
export type { HeapSnapshot, HeapMonitorConfig } from './admin/heap-monitor';

// ============================================================================
// @internal — Infrastructure used by createExecutionServer; avoid in new code
// ============================================================================

/** @internal */ export { OutputPruner } from './processes/output-pruner';
/** @internal */ export { StaleTaskDetector } from './processes/stale-task-detector';
/** @internal */ export type { StaleTaskDetectorOptions } from './processes/stale-task-detector';
/** @internal */ export { TaskWatcher } from './tasks/task-watcher';
/** @internal */ export type { TasksChangedCallback } from './tasks/task-watcher';
/** @internal */ export { WorkflowWatcher } from './workflows/workflow-watcher';
/** @internal */ export type { WorkflowsChangedCallback } from './workflows/workflow-watcher';
/** @internal */ export { TemplateWatcher } from './templates/template-watcher';
/** @internal */ export type { TemplatesChangedCallback } from './templates/template-watcher';

// ============================================================================
// @internal — Route registration (called by registerAllRoutes only)
// ============================================================================

/** @internal */ export { registerApiRoutes } from './core/api-handler';
/** @internal */ export { registerProcessResumeRoutes, registerFreshChatTerminalRoutes } from './processes/process-resume-handler';
/** @internal */ export { registerQueueRoutes } from './queue/queue-handler';
/** @internal */ export { registerTaskRoutes, registerTaskWriteRoutes } from './tasks/tasks-handler';
/** @internal */ export { registerTaskGenerationRoutes } from './tasks/task-generation-handler';
/** @internal */ export { registerTemplateRoutes, registerTemplateWriteRoutes } from './templates/templates-handler';
/** @internal */ export { registerWorkflowRoutes, registerWorkflowWriteRoutes } from './workflows/workflows-handler';
/** @internal */ export { registerScheduleRoutes } from './schedule/schedule-handler';
/** @internal */ export { registerNotesGitAutoCommitRoutes } from './notes/git/notes-git-autocommit-handler';
/** @internal */ export { registerNotesEditsRoutes } from './notes/notes-edits-handler';
/** @internal */ export { registerNotesRootsRoutes } from './notes/notes-roots-handler';
