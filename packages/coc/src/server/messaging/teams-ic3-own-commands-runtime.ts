import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { getLogger, LogCategory, toQueueProcessId, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import { NativeTeamsError, TeamsIc3Session, type TeamsIc3Account, type TeamsIc3Cursor } from '@plusplusoneplusplus/coc-native';
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import { admitTeamsIc3OwnCommand } from './teams-ic3-own-command-admission';
import type { createTeamsIc3OwnCommandLaunch } from './teams-ic3-own-command-launch';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import { onTaskTerminal } from './chat-target';
import { findRequestAnswer, findRequestTurn, isTerminalStatus, RELAY_ANSWER_TEXT } from './relay-answer';
import { sendTeamsIc3OwnCommandReply, type TeamsIc3OwnCommandSource } from './teams-ic3-own-command-reply';
import { getTeamsOutboundComplianceFailure, type TeamsOutboundCompliance, type TeamsOutboundComplianceFailure } from './teams-outbound-compliance';
import type { Route } from '../types';
import type { TeamsMessagingManager } from './teams-messaging-manager';
import { sendJSON } from '../core/api-handler';
import { isRepoGroupWorkspaceId } from '../workspaces/repo-group-workspace';
import { Ic3ReactionClient, TeamsOperationError, TrouterClient, type Ic3DirectMessageOptions, type TrouterStatus, type TrouterWake } from '@plusplusoneplusplus/coc-connector/teams';

function isCommandChat(chatId: string): boolean {
    return chatId === '48:notes' || /^19:[^\s/\\?#]+@(?:thread\.v2|unq\.gbl\.spaces)$/.test(chatId);
}

export interface TeamsIc3ConnectivityStatus {
    state: 'disabled' | 'connecting' | 'connected' | 'degraded' | 'error' | 'stopped';
    lastCheckedAt?: string;
    lastConnectedAt?: string;
    error?: string;
    outboundCompliance?: TeamsOutboundComplianceFailure;
    trouter: TrouterStatus;
}

interface Options {
    teams: Pick<TeamsMessagingManager, 'getIc3Region' | 'onIc3RegionChange'>;
    config: Pick<RuntimeConfigService, 'config' | 'onChange'>;
    store: Pick<ProcessStore, 'getWorkspaces' | 'getProcess'>;
    queue: ScheduleQueueEventBus;
    routes: Route[];
    launch: ReturnType<typeof createTeamsIc3OwnCommandLaunch>;
    decisionService?: TeamsOutboundCompliance['decisionService'];
    sendReply?: typeof sendTeamsIc3OwnCommandReply;
    createReactions?: (options: Ic3DirectMessageOptions) => Pick<Ic3ReactionClient, 'acknowledgeSourceMessage' | 'dispose'>;
    createSession?: (region: 'amer' | 'emea' | 'apac') => Pick<TeamsIc3Session, 'connect' | 'readChats' | 'readHistory' | 'dispose'>;
    createTrouter?: (options: ConstructorParameters<typeof TrouterClient>[0]) => Pick<TrouterClient, 'start' | 'stop' | 'getStatus'>;
}

/** Notification-driven IC3 reads with one Ask conversation per account, workspace and Teams chat. */
export function createTeamsIc3OwnCommandsRuntime(options: Options) {
    let signature: string | undefined;
    let controller: AbortController;
    let session: ReturnType<NonNullable<Options['createSession']>> | undefined;
    let reactions: ReturnType<NonNullable<Options['createReactions']>> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = Promise.resolve();
    const replyQueues = new Map<string, Promise<void>>();
    const replies = new Set<Promise<void>>();
    let trouter: ReturnType<NonNullable<Options['createTrouter']>> | undefined;
    let stoppingTrouter = Promise.resolve();
    const pending = new Map<string, { workspaceId: string; conversationId: string; source: TeamsIc3OwnCommandSource;
        signal: AbortSignal; detectedAt: number }>();
    let stopped = false;
    let status: Omit<TeamsIc3ConnectivityStatus, 'trouter'> = { state: 'disabled' };
    let outboundCompliance: TeamsOutboundComplianceFailure | undefined;
    options.routes.push({
        method: 'GET', pattern: '/api/messaging/teams/ic3-own-commands/status',
        handler: async (_req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            sendJSON(res, 200, snapshot());
        },
    });

    function snapshot(): TeamsIc3ConnectivityStatus {
        return { ...status, ...(outboundCompliance ? { outboundCompliance: { ...outboundCompliance } } : {}),
            trouter: trouter?.getStatus() ?? {
            state: stopped ? 'stopped' : options.config.config.features?.teamsIc3OwnCommands ? 'connecting' : 'disabled',
            error: null,
        } };
    }

    function stopTrouter() {
        if (trouter) {
            const stopping = trouter.stop();
            stoppingTrouter = Promise.all([stoppingTrouter, stopping]).then(() => {});
            trouter = undefined;
        }
    }

    function failure(error: unknown): string {
        return error instanceof NativeTeamsError ? error.code : 'ConfigurationOrConnection';
    }

    function timing(requestId: string, stage: string, measurements: Record<string, number>) {
        getLogger().info(LogCategory.AI, `[IC3 commands] timing ${JSON.stringify({ requestId, stage, ...measurements })}`);
    }

    function completed(task: QueuedTask) {
        const requestId = task.payload.relayRequestId;
        if (typeof requestId !== 'string') return;
        const request = pending.get(requestId);
        if (!request || request.signal.aborted || !isTerminalStatus(task.status)) return;
        pending.delete(requestId);
        const completedAt = Date.now();
        timing(requestId, 'completed', { sinceDetectionMs: completedAt - request.detectedAt,
            ...(task.startedAt === undefined ? {} : { queueMs: task.startedAt - task.createdAt,
                executionMs: (task.completedAt ?? completedAt) - task.startedAt }) });
        const previous = replyQueues.get(request.conversationId) ?? Promise.resolve();
        const reply = previous.then(async () => {
            if (request.signal.aborted) return;
            const replyStartedAt = Date.now();
            timing(requestId, 'reply-start', { replyWaitMs: replyStartedAt - completedAt });
            try {
                const processId = toQueueProcessId(request.conversationId);
                const proc = await options.store.getProcess(processId, request.workspaceId);
                request.signal.throwIfAborted();
                if (task.repoId !== request.workspaceId || task.payload.mode !== 'ask'
                    || (task.payload.processId ?? toQueueProcessId(task.id)) !== processId
                    || (task.processId && task.processId !== processId)
                    || (proc && (proc.id !== processId || proc.metadata?.workspaceId !== request.workspaceId
                        || proc.metadata.queueTaskId !== request.conversationId || proc.type !== 'chat'))) {
                    throw new Error('IC3 reply ownership mismatch.');
                }
                let text: string;
                if (task.status === 'failed') text = RELAY_ANSWER_TEXT.failed;
                else if (task.status === 'cancelled') text = RELAY_ANSWER_TEXT.cancelled;
                else {
                    const turns = proc?.conversationTurns ?? [];
                    const userIndex = findRequestTurn(turns, requestId);
                    const user = turns[userIndex];
                    if (user?.role !== 'user' || user.historical || user.displayOnly) {
                        throw new Error('IC3 answer is unavailable.');
                    }
                    const { answer } = findRequestAnswer(turns, userIndex);
                    if (!answer || answer.historical || answer.interruptionReason || answer.content?.startsWith('Error: ')) {
                        text = RELAY_ANSWER_TEXT.empty;
                    } else text = answer.content?.trim() ? answer.content : RELAY_ANSWER_TEXT.empty;
                }
                await (options.sendReply ?? sendTeamsIc3OwnCommandReply)(
                    request.source, requestId, text, request.signal);
                request.signal.throwIfAborted();
                timing(requestId, 'delivered', { replyMs: Date.now() - replyStartedAt,
                    sinceDetectionMs: Date.now() - request.detectedAt });
            } catch (error) {
                const complianceFailure = getTeamsOutboundComplianceFailure(error);
                if (complianceFailure) {
                    outboundCompliance = complianceFailure;
                    timing(requestId, `compliance-${complianceFailure.state}`, { replyMs: Date.now() - replyStartedAt });
                    getLogger().warn(LogCategory.AI, `[IC3 commands] Outbound compliance ${JSON.stringify({
                        requestId, ...complianceFailure,
                    })}`);
                } else if (!request.signal.aborted) {
                    timing(requestId, 'reply-failed', { replyMs: Date.now() - replyStartedAt });
                    report(error);
                }
            }
        }).finally(() => {
            replies.delete(reply);
            if (replyQueues.get(request.conversationId) === reply) replyQueues.delete(request.conversationId);
        });
        replyQueues.set(request.conversationId, reply);
        replies.add(reply);
    }
    const unsubscribeQueue = onTaskTerminal(options.queue, completed);

    function restart() {
        const config = options.config.config;
        const configuredRegion = options.teams.getIc3Region();
        const next = JSON.stringify([config.features?.teamsIc3OwnCommands, config.teamsIc3OwnCommands, configuredRegion]);
        if (stopped || next === signature) return;
        signature = next;
        controller?.abort();
        stopTrouter();
        pending.clear();
        replyQueues.clear();
        reactions?.dispose();
        reactions = undefined;
        session?.dispose();
        session = undefined;
        clearTimeout(timer);
        controller = new AbortController();
        const { signal } = controller;
        status = { state: config.features?.teamsIc3OwnCommands ? 'connecting' : 'disabled' };
        const cutoff = Date.now();
        const commands = new Set<string>();
        let account: TeamsIc3Account | undefined;
        const wakes = new Set<string>();
        let reconcile = true;
        let polling = false;
        let retryAt = 0;
        let nextFallbackAt = 0;

        function schedule(delay: number, fullScan: boolean) {
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (fullScan) reconcile = true;
                running = running.then(poll);
            }, Math.min(2_147_483_647, Math.max(delay, retryAt - Date.now(), 0)));
            timer.unref();
        }

        function rememberChat(chatId: string) {
            wakes.add(chatId);
            if (wakes.size > 64) { wakes.clear(); reconcile = true; }
        }

        function wake(event: TrouterWake) {
            if (signal.aborted) return;
            if (event.cause === 'message') {
                if (!event.conversationId || !isCommandChat(event.conversationId)) return;
                rememberChat(event.conversationId);
            } else reconcile = true;
            if (!polling) schedule(0, false);
        }

        async function poll() {
            if (signal.aborted || !config.features?.teamsIc3OwnCommands) return;
            polling = true;
            const fullScan = reconcile || Date.now() >= nextFallbackAt;
            reconcile = false;
            let delay = 60_000;
            let readError: string | undefined;
            function checked(error?: string) {
                if (signal.aborted) return;
                if (error) readError = error;
                const now = new Date().toISOString();
                status = { state: readError ? 'degraded' : 'connected', lastCheckedAt: now,
                    lastConnectedAt: error ? status.lastConnectedAt : now,
                    ...(readError ? { error: readError } : {}) };
            }
            try {
                const workspaces = await options.store.getWorkspaces();
                signal.throwIfAborted();
                const target = config.teamsIc3OwnCommands;
                const workspace = workspaces.find(workspace => workspace.id === target.workspaceId
                    && (!workspace.virtual || isRepoGroupWorkspaceId(workspace.id)) && isAbsolute(workspace.rootPath));
                if (!configuredRegion || !workspace) {
                    throw new Error('Configure a local IC3 workspace or repo group and region.');
                }
                const region = configuredRegion;
                const { rootPath: workingDirectory } = workspace;
                if (!session || !account) {
                    session?.dispose();
                    session = options.createSession?.(region) ?? new TeamsIc3Session({ region });
                    account = await session.connect(signal);
                }
                signal.throwIfAborted();
                const reader = session;
                const owner = account;
                if (!trouter) {
                    const notificationOptions: ConstructorParameters<typeof TrouterClient>[0] = {
                        expectedAccount: { tenantId: owner.tenantId, objectId: owner.userId },
                        target: () => signal.aborted ? null : isCommandChat,
                        onWake: wake,
                        onError: error => {
                            if (!signal.aborted) getLogger().warn(LogCategory.AI, `[IC3 commands] Trouter failed (${error.code}); fallback scans remain active.`);
                        },
                    };
                    trouter = options.createTrouter?.(notificationOptions) ?? new TrouterClient(notificationOptions);
                    trouter.start();
                }
                async function readChat(chat: { chatId: string; kind: string }, notification = false) {
                    try {
                        const readStartedAt = Date.now();
                        const page = await reader.readHistory(chat.chatId, { signal });
                        signal.throwIfAborted();
                        checked();
                        for (const message of page.items.slice(0, 30).reverse()) {
                            if (Date.parse(message.createdAt) <= cutoff) continue;
                            const kind = chat.chatId === '48:notes' ? 'self' : message.chatKind;
                            if (!kind || !['self', 'oneOnOne', 'group', 'meeting'].includes(kind)) {
                                throw new Error('IC3 source chat kind is unavailable; rebuild the native Teams reader.');
                            }
                            const admission = admitTeamsIc3OwnCommand({ account: owner, chat: { ...chat, kind } }, message);
                            if (admission.kind !== 'command') continue;
                            const id = 'ic3-command-' + createHash('sha256').update(JSON.stringify([
                                owner.tenantId, owner.userId, chat.chatId, message.messageId,
                            ])).digest('hex');
                            const conversationId = 'ic3-chat-' + createHash('sha256').update(JSON.stringify([
                                owner.tenantId, owner.userId, target.workspaceId, chat.chatId,
                            ])).digest('hex');
                            if (commands.has(id)) continue;
                            commands.add(id);
                            const detectedAt = Date.now();
                            timing(id, 'detected', { detectionLagMs: Math.max(0, detectedAt - Date.parse(message.createdAt)),
                                readMs: detectedAt - readStartedAt });
                            // Mark before admission: uncertain queue outcomes must not be retried.
                            try {
                                const acknowledgementStartedAt = Date.now();
                                try {
                                    const reactionOptions = { region, expectedAccount: {
                                        tenantId: owner.tenantId, objectId: owner.userId,
                                    } };
                                    reactions ??= options.createReactions?.(reactionOptions) ?? new Ic3ReactionClient(reactionOptions);
                                    await reactions.acknowledgeSourceMessage(chat.chatId, message.messageId, signal);
                                    signal.throwIfAborted();
                                    timing(id, 'acknowledged', { acknowledgementMs: Date.now() - acknowledgementStartedAt });
                                } catch (error) {
                                    signal.throwIfAborted();
                                    timing(id, 'acknowledgement-failed', { acknowledgementMs: Date.now() - acknowledgementStartedAt });
                                    const code = error instanceof TeamsOperationError ? `${error.code}/${error.outcome}` : 'unavailable';
                                    getLogger().warn(LogCategory.AI, `[IC3 commands] Eyes acknowledgement failed (${code}); continuing admission. `
                                        + 'Verify IC3 region and account access.');
                                }
                                pending.set(id, { workspaceId: target.workspaceId, conversationId,
                                    source: { account: owner, chatId: chat.chatId, region,
                                        replyTo: { kind: kind === 'self' || kind === 'meeting' ? 'quote' : 'thread',
                                            messageId: message.messageId, text: message.text,
                                            ...(message.rootMessageId ? { rootMessageId: message.rootMessageId } : {}) },
                                        compliance: {
                                            decisionService: options.decisionService,
                                            workspaceId: target.workspaceId, workingDirectory,
                                            trigger: { type: 'mention', messageId: message.messageId,
                                                text: message.text, untrustedHtml: message.untrustedHtml },
                                            getPolicy: () => ({
                                                enabled: options.config.config.features?.teamsOutboundCompliance === true,
                                                prompt: options.config.config.teamsOutboundCompliance?.prompt ?? '',
                                            }),
                                        },
                                        verifyAccess: async signal => { await reader.readHistory(chat.chatId, { signal }); } },
                                    signal, detectedAt });
                                await options.launch(target.workspaceId, id, admission.prompt, signal, conversationId);
                                signal.throwIfAborted();
                                timing(id, 'admitted', { admissionMs: Date.now() - detectedAt });
                                const task = options.queue.getTask(id) ?? options.queue.getTask(conversationId);
                                if (task) completed(task);
                            } catch (error) {
                                pending.delete(id);
                                if (signal.aborted) return false;
                                timing(id, 'admission-failed', { admissionMs: Date.now() - detectedAt });
                                report(error);
                            }
                        }
                    } catch (error) {
                        if (signal.aborted) return false;
                        // Matching IDs alone do not prove a supported native conversation type.
                        if (notification && chat.chatId !== '48:notes'
                            && error instanceof NativeTeamsError && error.code === 'Unsupported') {
                            getLogger().debug(LogCategory.AI, '[IC3 commands] Ignoring notification for an unsupported conversation.');
                            return true;
                        }
                        if (error instanceof NativeTeamsError && error.code === 'RateLimited') throw error;
                        checked(failure(error));
                        report(error);
                        return false;
                    }
                    return true;
                }
                async function drainWakes() {
                    signal.throwIfAborted();
                    if (Date.now() < retryAt) return;
                    const batch = [...wakes];
                    for (const chatId of batch) {
                        wakes.delete(chatId);
                        let success: boolean;
                        try {
                            success = await readChat({ chatId, kind: chatId === '48:notes' ? 'self' : 'group' }, true);
                        } catch (error) {
                            rememberChat(chatId);
                            throw error;
                        }
                        signal.throwIfAborted();
                        if (!success) { rememberChat(chatId); retryAt = Date.now() + 30_000; return; }
                    }
                }
                await drainWakes();
                if (!fullScan) return;
                await readChat({ chatId: '48:notes', kind: 'self' });
                signal.throwIfAborted();
                const chats = new Set(['48:notes']);
                let cursor: TeamsIc3Cursor | undefined;
                const cursors = new Set<TeamsIc3Cursor>();
                do {
                    const page = await reader.readChats({ cursor, signal });
                    signal.throwIfAborted();
                    checked();
                    await drainWakes();
                    for (const chat of page.items) {
                        if (['oneOnOne', 'group', 'meeting'].includes(chat.kind) && !chats.has(chat.chatId)) {
                            chats.add(chat.chatId);
                            await readChat(chat);
                            await drainWakes();
                        }
                    }
                    cursor = page.next;
                    if (cursor && cursors.has(cursor)) throw new Error('Repeated IC3 discovery cursor.');
                    if (cursor) cursors.add(cursor);
                } while (cursor);
                nextFallbackAt = Date.now() + 60_000;
            } catch (error) {
                if (!signal.aborted) {
                    reconcile ||= fullScan;
                    status = { ...status, state: 'error', lastCheckedAt: new Date().toISOString(), error: failure(error) };
                    if (error instanceof NativeTeamsError) delay = Math.max(delay, error.retryAfterMs ?? 0);
                    retryAt = Date.now() + delay;
                    report(error);
                }
            } finally {
                polling = false;
                if (!signal.aborted && config.features?.teamsIc3OwnCommands) {
                    if (!fullScan) delay = Math.max(0, nextFallbackAt - Date.now());
                    schedule(wakes.size || reconcile ? 0 : delay, !wakes.size && !reconcile);
                }
            }
        }
        running = running.then(poll);
    }

    function report(error: unknown) {
        getLogger().warn(LogCategory.AI, `[IC3 commands] Poll, chat launch or reply failed (${error instanceof NativeTeamsError
            ? error.code : error instanceof TeamsOperationError ? `${error.code}/${error.outcome}` : 'configuration-or-admission'}). Check the configured workspace and native Azure CLI access. `
            + 'Replies use IC3 with bounded safe retries. Permanent failures and uncertain sends are not retried.');
    }

    const unsubscribe = options.config.onChange(restart);
    const unsubscribeRegion = options.teams.onIc3RegionChange(restart);
    restart();
    return {
        getStatus(): TeamsIc3ConnectivityStatus { return snapshot(); },
        async dispose() {
            stopped = true;
            status = { ...status, state: 'stopped' };
            unsubscribe();
            unsubscribeRegion();
            unsubscribeQueue();
            pending.clear();
            controller.abort();
            stopTrouter();
            clearTimeout(timer);
            session?.dispose();
            reactions?.dispose();
            await running;
            await Promise.all(replies);
            await stoppingTrouter;
        },
    };
}
