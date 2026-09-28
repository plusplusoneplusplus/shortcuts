/**
 * Registers HTTP routes for the Teams messaging integration:
 *   GET  /api/messaging/teams/status   — current connection status
 *   POST /api/messaging/teams/server   — configure global MCP endpoint
 *   POST /api/messaging/teams/config   — update config (botName, teamName, channelName, enabled)
 *   POST /api/messaging/teams/reconnect — (re)connect the bot
 *
 * Also wires the {@link TeamsCommandRouter} as the inbound message handler,
 * enabling Teams users to send commands (list agents, select repo, chat, etc.).
 *
 * These routes power the normal CoC Teams connection card.
 */

import { sendJSON, sendError } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import type { ProcessStore, AIProcess } from '@plusplusoneplusplus/forge';
import type { McpOauthManager } from '../mcp-oauth/mcp-oauth-manager';
import { TeamsMessagingManager } from './teams-messaging-manager';
import { TeamsCommandRouter } from './teams-command-router';
import { TeamsOAuthFlow } from './teams-oauth-flow';
import type { TeamsAttempt } from './teams-attempt-store';
import { TeamsAnswerRelay } from './teams-answer-relay';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';

function attemptSummary(attempt: TeamsAttempt) {
    return {
        id: attempt.id,
        startedAt: attempt.startedAt,
        ...(attempt.endedAt ? { endedAt: attempt.endedAt } : {}),
        ...(attempt.result ? { result: attempt.result } : {}),
        stage: attempt.stage,
        ...(attempt.failureCategory ? { failureCategory: attempt.failureCategory } : {}),
        degraded: attempt.degraded,
    };
}

function parsePageNumber(value: string | null, fallback: number, maximum: number): number | null {
    if (value === null) return fallback;
    if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number <= maximum ? number : null;
}

export interface TeamsMessagingRoutesOptions {
    dataDir: string;
    getObservabilityEnabled?: () => boolean;
    /** ProcessStore for querying workspaces and processes. */
    store?: ProcessStore;
    /** Enqueue a new chat task. Returns the task ID. */
    enqueueChat?: (workspaceId: string, message: string) => Promise<string>;
    enqueueRelayChat?: (workspaceId: string, message: string, taskId: string) => Promise<string>;
    admitRelayFollowUp?: (process: AIProcess, message: string, requestId: string) => Promise<{ taskId?: string }>;
    enqueuePendingRelayFollowUp?: (workspaceId: string, processId: string, message: string, requestId: string) => Promise<string>;
    relayQueue?: ScheduleQueueEventBus;
    getAnswerRelayEnabled?: () => boolean;
    getMessageReactionEnabled?: () => boolean;
    onAnswerRelayConfigChanged?: (callback: () => void) => () => void;
    /** Send a follow-up message to an existing process. */
    executeFollowUp?: (processId: string, message: string) => Promise<void>;
    /** Existing manager, shared with the server lifecycle. */
    manager?: TeamsMessagingManager;
    oauthAvailable?: boolean;
    oauthManager?: McpOauthManager;
}

export function registerTeamsMessagingRoutes(
    routes: Route[],
    opts: TeamsMessagingRoutesOptions,
): TeamsMessagingManager {
    const manager = opts.manager ?? new TeamsMessagingManager(opts.dataDir, { getObservabilityEnabled: opts.getObservabilityEnabled });
    const oauthFlow = opts.oauthManager ? new TeamsOAuthFlow(opts.oauthManager) : null;
    if (oauthFlow) manager.setOAuthFlow(oauthFlow);

    // Wire the command router if store + queue deps are provided
    if (opts.store && opts.enqueueChat && opts.executeFollowUp) {
        const relay = opts.relayQueue && opts.enqueueRelayChat && opts.getAnswerRelayEnabled
            ? new TeamsAnswerRelay({
                dataDir: opts.dataDir,
                store: opts.store,
                queue: opts.relayQueue,
                isEnabled: opts.getAnswerRelayEnabled,
                target: () => {
                    const status = manager.getStatus();
                    return { connected: status.enabled && status.status === 'connected', teamId: status.teamId, channelId: status.channelId };
                },
                send: (text, rootId) => manager.sendMessage(text, rootId, 'html'),
            })
            : undefined;
        const ready = relay?.restore();
        ready?.catch(() => console.error('[teams-answer-relay] Failed to restore bindings'));
        if (relay) {
            const unsubscribe = opts.onAnswerRelayConfigChanged?.(() => {
                if (opts.getAnswerRelayEnabled?.() === true) {
                    void ready?.then(() => relay.reconnected())
                        .catch(() => console.error('[teams-answer-relay] Config reconciliation failed'));
                }
            });
            manager.setAnswerRelay(relay, unsubscribe, opts.getAnswerRelayEnabled);
        }
        const router = new TeamsCommandRouter({
            store: opts.store,
            enqueueChat: opts.enqueueChat,
            isAnswerRelayEnabled: opts.getAnswerRelayEnabled,
            ...(relay ? { resolveThreadReply: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage) =>
                relay.resolveThread(msg),
                selectThreadTarget: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage, workspaceId: string, processId: string | null) =>
                    relay.selectThreadTarget(msg, workspaceId, processId) } : {}),
            ...(relay && opts.enqueueRelayChat ? {
                admitNewChat: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage, workspaceId: string, message: string) =>
                    opts.getAnswerRelayEnabled?.() === true
                        ? relay.admitNew(msg, workspaceId, taskId => opts.enqueueRelayChat!(workspaceId, message, taskId))
                        : opts.enqueueChat!(workspaceId, message).then(taskId => ({ taskId, duplicate: false })),
                acknowledgeNewChat: (taskId: string) => opts.getAnswerRelayEnabled?.() === true
                    ? relay.acknowledged(taskId) : Promise.resolve(),
            } : {}),
            ...(relay && opts.admitRelayFollowUp ? {
                admitFollowUp: async (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage, proc: AIProcess, message: string) => {
                    if (opts.getAnswerRelayEnabled?.() !== true) {
                        await opts.executeFollowUp!(proc.id, message);
                        return { duplicate: false };
                    }
                    return relay.admitFollowUp(msg, proc, requestId => opts.admitRelayFollowUp!(proc, message, requestId));
                },
                acknowledgeFollowUp: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage) => opts.getAnswerRelayEnabled?.() === true
                    ? relay.acknowledgedMessage(msg) : Promise.resolve(),
            } : {}),
            ...(relay && opts.enqueuePendingRelayFollowUp ? {
                admitPendingFollowUp: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage, taskId: string, message: string) =>
                    opts.getAnswerRelayEnabled?.() === true
                        ? relay.admitPendingFollowUp(msg, taskId, (workspaceId, processId, requestId) =>
                            opts.enqueuePendingRelayFollowUp!(workspaceId, processId, message, requestId))
                        : Promise.resolve(null),
            } : {}),
            executeFollowUp: opts.executeFollowUp,
            sendReply: async (text, replyToId) => {
                manager.recordEvent('reply-attempt');
                try {
                    await manager.sendMessage(text, replyToId);
                } catch (err) {
                    console.error('[teams-messaging] Failed to send reply:', err);
                }
            },
            dataDir: opts.dataDir,
        });

        manager.setMessageHandler(async (msg, observe) => {
            await ready;
            if (opts.getAnswerRelayEnabled?.() === true && relay?.hasInbound(msg)) return;
            const boundReply = !!msg.replyToMessageId && opts.getAnswerRelayEnabled?.() === true
                && !!relay?.threadRoots(manager.getStatus().teamId ?? '', msg.channelId).includes(msg.replyToMessageId);
            if (opts.getMessageReactionEnabled?.() === true && msg.text.trim() && !msg.botAuthored
                && !msg.initializationReplay
                && (!msg.replyToMessageId || boundReply)) {
                try {
                    await manager.reactToChannelMessage(msg);
                } catch (err) {
                    console.error('[teams-messaging] Teams Like reaction unavailable or failed:',
                        err instanceof Error && err.message.startsWith('Teams channel Like ')
                            ? err.message : err instanceof Error
                                ? `${err.name}${'status' in err && typeof err.status === 'number' ? ` (HTTP ${err.status})` : ''}`
                                : 'unknown error');
                }
            }
            await router.handle(msg, observe);
        });
    }

    routes.push({
        method: 'GET',
        pattern: /^\/api\/messaging\/teams\/status$/,
        handler: (_req, res) => {
            sendJSON(res, 200, {
                ...manager.getStatus(), oauthAvailable: opts.oauthAvailable ?? false,
                teamsOAuthAvailable: !!oauthFlow,
                teamsBridgeObservabilityEnabled: opts.getObservabilityEnabled?.() === true,
            });
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/messaging\/teams\/attempts$/,
        handler: (req, res) => {
            if (opts.getObservabilityEnabled?.() !== true) {
                sendError(res, 404, 'Teams connection history is unavailable');
                return;
            }
            const query = new URL(req.url ?? '', 'http://localhost').searchParams;
            const offset = parsePageNumber(query.get('offset'), 0, Number.MAX_SAFE_INTEGER);
            const limit = parsePageNumber(query.get('limit'), 20, 100);
            if (offset === null || limit === null || limit === 0
                || query.getAll('offset').length > 1 || query.getAll('limit').length > 1
                || [...query.keys()].some(key => key !== 'offset' && key !== 'limit')) {
                sendError(res, 400, 'Invalid Teams history pagination');
                return;
            }
            try {
                const attempts = manager.getAttemptHistory();
                if (!attempts) {
                    sendError(res, 503, 'Teams connection history is unavailable');
                    return;
                }
                const page = attempts.slice(offset, offset + limit);
                sendJSON(res, 200, {
                    attempts: page.map(attemptSummary),
                    total: attempts.length,
                    nextOffset: offset + limit < attempts.length ? offset + limit : null,
                });
            } catch (err) {
                console.error('[teams-history] Failed to read attempt history:', err);
                sendError(res, 500, 'Teams connection history is unavailable');
            }
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/messaging\/teams\/attempts\/([^/]+)$/,
        handler: (_req, res, match) => {
            if (opts.getObservabilityEnabled?.() !== true) {
                sendError(res, 404, 'Teams connection history is unavailable');
                return;
            }
            if (!match) {
                sendError(res, 400, 'Invalid Teams attempt ID');
                return;
            }
            const id = match[1];
            if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
                sendError(res, 400, 'Invalid Teams attempt ID');
                return;
            }
            try {
                const history = manager.getAttemptHistory();
                if (!history) {
                    sendError(res, 503, 'Teams connection history is unavailable');
                    return;
                }
                const attempt = history.find(item => item.id === id);
                if (!attempt) {
                    sendError(res, 404, 'Teams attempt not found');
                    return;
                }
                sendJSON(res, 200, {
                    attempt: {
                        ...attemptSummary(attempt),
                        phases: attempt.phases.map(phase => ({ stage: phase.stage, at: phase.at })),
                        events: attempt.events.map(event => ({
                            type: event.type, at: event.at,
                            ...(event.category ? { category: event.category } : {}),
                        })),
                        totals: { ...attempt.totals },
                        pollSuccessCount: attempt.pollSuccessCount,
                        ...(attempt.lastPollSuccessAt ? { lastPollSuccessAt: attempt.lastPollSuccessAt } : {}),
                        ...(attempt.lastSendSuccessAt ? { lastSendSuccessAt: attempt.lastSendSuccessAt } : {}),
                        pollDegraded: attempt.pollDegraded,
                        sendDegraded: attempt.sendDegraded,
                    },
                });
            } catch (err) {
                console.error('[teams-history] Failed to read attempt history:', err);
                sendError(res, 500, 'Teams connection history is unavailable');
            }
        },
    });

    if (oauthFlow) {
        routes.push({
            method: 'POST',
            pattern: /^\/api\/messaging\/teams\/auth\/start$/,
            handler: async (_req, res) => {
                const serverUrl = manager.getStatus().serverUrl;
                if (!serverUrl) {
                    sendError(res, 400, 'Configure a global HTTP Microsoft Teams MCP server before authenticating');
                    return;
                }
                try {
                    sendJSON(res, 200, await oauthFlow.start(serverUrl));
                } catch (err) {
                    sendError(res, 500, err instanceof Error ? err.message : String(err));
                }
            },
        });
    }

    routes.push({
        method: 'POST',
        pattern: /^\/api\/messaging\/teams\/server$/,
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (!body) return;
            if (typeof body.url !== 'string' || !body.url.trim()) {
                sendError(res, 400, 'Provide a Teams MCP server URL');
                return;
            }
            try {
                await manager.configureServer(body.url.trim());
                sendJSON(res, 200, manager.getStatus());
            } catch (err) {
                sendError(res, err instanceof TypeError || err instanceof RangeError ? 400 : 500, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/messaging\/teams\/config$/,
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (!body) return;

            const patch: Record<string, unknown> = {};
            if (typeof body.botName === 'string') patch.botName = body.botName;
            if (typeof body.teamName === 'string') patch.teamName = body.teamName;
            if (typeof body.channelName === 'string') patch.channelName = body.channelName;
            if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;

            try {
                if (Object.keys(patch).length === 0) {
                    sendError(res, 400, 'Provide a Teams configuration field');
                    return;
                }
                await manager.updateConfig(patch);
                sendJSON(res, 200, manager.getStatus());
            } catch (err) {
                sendError(res, 500, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/messaging\/teams\/reconnect$/,
        handler: async (_req, res) => {
            try {
                await manager.connect();
                sendJSON(res, 200, { ok: true, status: manager.getStatus() });
            } catch (err: any) {
                sendError(res, 500, err.message ?? 'Failed to connect');
            }
        },
    });

    return manager;
}
