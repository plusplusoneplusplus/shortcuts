/**
 * Registers HTTP routes for the Teams messaging integration:
 *   GET  /api/messaging/teams/status   — current connection status
 *   POST /api/messaging/teams/server   — configure global MCP endpoint
 *   POST /api/messaging/teams/config   — update config (botName, teamName, channelName, enabled, ic3Region)
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
import type { MessagingChatMode } from '@plusplusoneplusplus/coc-connector';
import type { MessagingCompactor, MessagingQuotaSource } from './messaging-commands';
import type { MessagingRemoteDirectory } from './remote-browse';
import { TeamsOAuthFlow } from './teams-oauth-flow';
import type { TeamsAttempt } from './teams-attempt-store';
import { TeamsAnswerRelay, teamsQuestionChatKey } from './teams-answer-relay';
import type { AskUserQuestionRelayHub } from './ask-user-relay';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import { DEFAULT_CONFIG } from '../../config';
import { TeamsOperationError } from '@plusplusoneplusplus/coc-connector/teams';

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
    enqueueChat?: (workspaceId: string, message: string, mode?: MessagingChatMode) => Promise<string>;
    enqueueRelayChat?: (workspaceId: string, message: string, taskId: string, mode?: MessagingChatMode) => Promise<string>;
    admitRelayFollowUp?: (process: AIProcess, message: string, requestId: string, mode?: MessagingChatMode) => Promise<{ taskId?: string }>;
    enqueuePendingRelayFollowUp?: (workspaceId: string, processId: string, message: string, requestId: string, mode?: MessagingChatMode) => Promise<string>;
    relayQueue?: ScheduleQueueEventBus;
    getAnswerRelayEnabled?: () => boolean;
    getMessageReactionEnabled?: () => boolean;
    onAnswerRelayConfigChanged?: (callback: () => void) => () => void;
    /** Send a follow-up message to an existing process. */
    executeFollowUp?: (processId: string, message: string, mode?: MessagingChatMode) => Promise<void>;
    /** Provider quota for the `quota` command. */
    getQuota?: MessagingQuotaSource;
    /** Compacts a chat's provider context for the `compact` command. */
    compact?: MessagingCompactor;
    /** Local + remote repo directory for read-only `list remotes` / `list topics <ref>`. */
    remotes?: MessagingRemoteDirectory;
    /** Existing manager, shared with the server lifecycle. */
    manager?: TeamsMessagingManager;
    oauthAvailable?: boolean;
    oauthManager?: McpOauthManager;
    /** Relays ask_user questions into relay-bound threads; replies there answer them. */
    questionRelay?: Pick<AskUserQuestionRelayHub, 'register' | 'tryAnswer'>;
}

export function registerTeamsMessagingRoutes(
    routes: Route[],
    opts: TeamsMessagingRoutesOptions,
): TeamsMessagingManager {
    const manager = opts.manager ?? new TeamsMessagingManager(opts.dataDir, { getObservabilityEnabled: opts.getObservabilityEnabled });
    const getAnswerRelayEnabled = opts.getAnswerRelayEnabled ?? (() => DEFAULT_CONFIG.features.teamsAiAnswerRelay);
    const oauthFlow = opts.oauthManager ? new TeamsOAuthFlow(opts.oauthManager) : null;
    if (oauthFlow) manager.setOAuthFlow(oauthFlow);

    // Wire the command router if store + queue deps are provided
    if (opts.store && opts.enqueueChat && opts.executeFollowUp) {
        const relay = opts.relayQueue && opts.enqueueRelayChat
            ? new TeamsAnswerRelay({
                dataDir: opts.dataDir,
                store: opts.store,
                queue: opts.relayQueue,
                isEnabled: getAnswerRelayEnabled,
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
                if (getAnswerRelayEnabled()) {
                    void ready?.then(() => relay.reconnected())
                        .catch(() => console.error('[teams-answer-relay] Config reconciliation failed'));
                }
            });
            manager.setAnswerRelay(relay, unsubscribe, getAnswerRelayEnabled);
            opts.questionRelay?.register(relay.questionTransport());
        }
        const router = new TeamsCommandRouter({
            store: opts.store,
            enqueueChat: opts.enqueueChat,
            isAnswerRelayEnabled: () => !!relay && getAnswerRelayEnabled(),
            ...(relay ? { resolveThreadReply: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage) =>
                relay.resolveThread(msg),
                getThreadSelection: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage) =>
                    relay.getThreadSelection(msg),
                hasThreadCommand: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage) =>
                    relay.hasCommand(msg),
                recordThreadCommand: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage) =>
                    relay.recordCommand(msg),
                selectThreadTarget: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage, workspaceId: string, processId: string | null) =>
                    relay.selectThreadTarget(msg, workspaceId, processId) } : {}),
            ...(relay && opts.enqueueRelayChat ? {
                admitThreadNew: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage, workspaceId: string, message: string, mode?: MessagingChatMode) =>
                    relay.admitThreadNew(msg, workspaceId, taskId => opts.enqueueRelayChat!(workspaceId, message, taskId, mode)),
                admitNewChat: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage, workspaceId: string, message: string, mode?: MessagingChatMode) =>
                    getAnswerRelayEnabled()
                        ? relay.admitNew(msg, workspaceId, taskId => opts.enqueueRelayChat!(workspaceId, message, taskId, mode))
                        : opts.enqueueChat!(workspaceId, message, mode).then(taskId => ({ taskId, duplicate: false })),
                acknowledgeNewChat: (taskId: string) => getAnswerRelayEnabled()
                    ? relay.acknowledged(taskId) : Promise.resolve(),
            } : {}),
            ...(relay && opts.admitRelayFollowUp ? {
                admitFollowUp: async (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage, proc: AIProcess, message: string, mode?: MessagingChatMode) => {
                    if (!getAnswerRelayEnabled()) {
                        await opts.executeFollowUp!(proc.id, message, mode);
                        return { duplicate: false };
                    }
                    return relay.admitFollowUp(msg, proc, requestId => opts.admitRelayFollowUp!(proc, message, requestId, mode));
                },
                acknowledgeFollowUp: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage) => getAnswerRelayEnabled()
                    ? relay.acknowledgedMessage(msg) : Promise.resolve(),
            } : {}),
            ...(relay && opts.enqueuePendingRelayFollowUp ? {
                admitPendingFollowUp: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage, taskId: string, message: string, mode?: MessagingChatMode) =>
                    getAnswerRelayEnabled()
                        ? relay.admitPendingFollowUp(msg, taskId, (workspaceId, processId, requestId) =>
                            opts.enqueuePendingRelayFollowUp!(workspaceId, processId, message, requestId, mode))
                        : Promise.resolve(null),
            } : {}),
            executeFollowUp: opts.executeFollowUp,
            getQuota: opts.getQuota,
            compact: opts.compact,
            remotes: opts.remotes,
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
            if (getAnswerRelayEnabled() && relay?.hasInbound(msg)) return;
            const boundReply = !!msg.replyToMessageId && getAnswerRelayEnabled()
                && !!relay?.threadRoots(manager.getStatus().teamId ?? '', msg.channelId).includes(msg.replyToMessageId);
            if (opts.getMessageReactionEnabled?.() === true && msg.text.trim() && !msg.botAuthored
                && !msg.initializationReplay
                && (!msg.replyToMessageId || boundReply)) {
                void manager.reactToChannelMessage(msg).catch(err => {
                    console.error('[teams-messaging] Teams Like reaction unavailable or failed:',
                        err instanceof Error && err.message.startsWith('Teams channel Like ')
                            ? err.message : err instanceof Error
                                ? `${err.name}${'status' in err && typeof err.status === 'number' ? ` (HTTP ${err.status})` : ''}`
                                : 'unknown error');
                });
            }
            if (relay && opts.questionRelay && getAnswerRelayEnabled() && msg.text.trim()
                && !msg.botAuthored && !msg.initializationReplay && !msg.historicalSelectionReplay) {
                const teamId = manager.getStatus().teamId ?? '';
                const replyTo = msg.replyToMessageId || msg.messageId;
                const answered = await opts.questionRelay.tryAnswer('teams', {
                    chatKey: teamsQuestionChatKey(teamId, msg.channelId),
                    messageId: msg.messageId,
                    replyToId: msg.replyToMessageId,
                    text: msg.text,
                    reply: async text => { await manager.sendMessage(text, replyTo); },
                    // A reaction-enabled bridge already Liked the message above.
                    acknowledge: async () => {
                        if (opts.getMessageReactionEnabled?.() !== true) await manager.reactToChannelMessage(msg);
                    },
                });
                if (answered) {
                    if (msg.replyToMessageId) relay.recordSeenReply(teamId, msg);
                    return;
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
            if ('ic3Region' in body) patch.ic3Region = body.ic3Region;
            if ('enableTrouter' in body) patch.enableTrouter = body.enableTrouter;
            if ('outboundBackend' in body) patch.outboundBackend = body.outboundBackend;

            try {
                if (Object.keys(patch).length === 0) {
                    sendError(res, 400, 'Provide a Teams configuration field');
                    return;
                }
                await manager.updateConfig(patch);
                sendJSON(res, 200, manager.getStatus());
            } catch (err) {
                sendError(res, err instanceof RangeError ? 400 : 500, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/messaging\/teams\/direct-message$/,
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (!body) return;
            const fields = ['chatId', 'recipientId', 'connectionId', 'content', 'contentType'];
            if (Object.keys(body).some(key => !fields.includes(key))
                || fields.some(key => typeof body[key] !== 'string' || !body[key].trim())
                || (body.contentType !== 'text' && body.contentType !== 'html')) {
                sendError(res, 400, 'Provide chatId, recipientId, current connectionId, content and contentType (text or html); replies and mentions are unsupported');
                return;
            }
            const cancellation = new AbortController();
            const abort = () => cancellation.abort();
            const closed = () => { if (!res.writableEnded) abort(); };
            req.once('aborted', abort);
            res.once('close', closed);
            if (req.aborted || res.destroyed) abort();
            try {
                const receipt = await manager.sendDirectMessage({
                    kind: 'chat', chatId: body.chatId, recipientId: body.recipientId, connectionId: body.connectionId,
                }, { content: body.content, contentType: body.contentType }, { signal: cancellation.signal });
                sendJSON(res, 201, receipt);
            } catch (error) {
                if (error instanceof TeamsOperationError) {
                    sendJSON(res, error.outcome === 'unknown' ? 502 : error.code === 'invalid-target'
                        || error.code === 'unsupported' ? 400 : 409, {
                        error: error.message, backend: error.backend, code: error.code, outcome: error.outcome,
                    });
                } else {
                    sendJSON(res, 502, { error: 'Teams direct send failed; delivery is unknown. Do not replay.',
                        outcome: 'unknown' });
                }
            } finally {
                req.removeListener('aborted', abort);
                res.removeListener('close', closed);
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
