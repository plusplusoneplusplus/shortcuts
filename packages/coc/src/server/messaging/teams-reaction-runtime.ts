import { createHash } from 'node:crypto';
import { getLogger, LogCategory, type ProcessStore } from '@plusplusoneplusplus/forge';
import { TeamsIc3Session } from '@plusplusoneplusplus/coc-native';
import {
    Ic3ReactionClient, TrouterClient,
    type Ic3DirectMessageOptions, type TrouterStatus,
} from '@plusplusoneplusplus/coc-connector/teams';
import type { RuntimeConfigService } from '../../config/runtime-config-service';
import type { TeamsMessagingManager } from './teams-messaging-manager';
import type { TeamsIc3CommandSource } from './teams-ic3-own-command-reply';
import type { createTeamsReactionExecution } from './teams-reaction-execution';
import { resolveTeamsReactionDispatcher } from './teams-reaction-dispatcher';
import { normalizeTeamsRobotReaction } from './teams-reaction-evidence';
import { createTeamsReactionPickup } from './teams-reaction-pickup';
import { safeErrorDiagnostics } from './safe-error-diagnostics';
import type { TeamsOutboundCompliance } from './teams-outbound-compliance';

type Pickup = ReturnType<typeof createTeamsReactionPickup>;
type Result = Extract<Awaited<ReturnType<Pickup['handle']>>, { admitted: true }>;
type Failure = 'configuration' | 'connection' | 'notification' | 'pickup' | 'delivery' | 'capacity';

interface Options {
    teams: Pick<TeamsMessagingManager, 'getIc3Region' | 'onIc3RegionChange'>;
    config: Pick<RuntimeConfigService, 'config' | 'onChange'>;
    store: ProcessStore;
    dataDir: string;
    execution: Pick<ReturnType<typeof createTeamsReactionExecution>, 'run'>;
    decisionService?: TeamsOutboundCompliance['decisionService'];
    onResult(result: Result, source: TeamsIc3CommandSource & { messageId: string }, signal: AbortSignal): Promise<void>;
    createSession?: (region: 'amer' | 'emea' | 'apac') => Pick<TeamsIc3Session, 'connect' | 'readHistory' | 'dispose'>;
    createReactions?: (options: Ic3DirectMessageOptions) => Pick<Ic3ReactionClient, 'acknowledgeSourceMessage' | 'dispose'>;
    createTrouter?: (options: ConstructorParameters<typeof TrouterClient>[0]) => Pick<TrouterClient, 'start' | 'stop' | 'getStatus'>;
}

/** Explicit composition only: the server supplies its shared coordinator and verified-result handler. */
export function createTeamsReactionRuntime(options: Options) {
    let signature: string | undefined;
    let stopped = false;
    let current: { close(): void } | undefined;
    let trouter: ReturnType<NonNullable<Options['createTrouter']>> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let state: 'disabled' | 'connecting' | 'connected' | 'degraded' | 'error' | 'stopped' = 'disabled';
    let lastError: Failure | undefined;
    const work = new Set<Promise<void>>();
    const deliveries = new Set<Promise<void>>();

    function report(failure: Failure, error?: unknown, trace?: string) {
        lastError = failure;
        state = failure === 'configuration' || failure === 'connection' ? 'error' : 'degraded';
        getLogger().warn(LogCategory.AI, `[Teams reactions] ${failure} failed; check reaction delegation configuration, `
            + 'native account access and dashboard jobs. Notifications and uncertain writes are not replayed. '
            + JSON.stringify({ failure, ...(trace ? { trace } : {}),
                ...(error === undefined ? {} : safeErrorDiagnostics(error)) }));
    }

    function track(promise: Promise<void>, set = work) {
        set.add(promise);
        void promise.then(() => set.delete(promise), () => set.delete(promise));
    }

    function restart(force = false) {
        const config = options.config.config;
        const region = options.teams.getIc3Region();
        const next = JSON.stringify([config.features?.teamsReactionDelegation, config.teamsReactionDelegation, config.skills, region]);
        if (stopped || (!force && signature === next)) return;
        signature = next;
        clearTimeout(retry);
        current?.close();
        current = undefined;
        lastError = undefined;
        state = config.features?.teamsReactionDelegation === true ? 'connecting' : 'disabled';
        if (state === 'disabled') return;

        const controller = new AbortController();
        const { signal } = controller;
        let session: ReturnType<NonNullable<Options['createSession']>> | undefined;
        let notification: ReturnType<NonNullable<Options['createTrouter']>> | undefined;
        let registered: { controller: AbortController; pickup: Pickup;
            reactions: ReturnType<NonNullable<Options['createReactions']>> } | undefined;
        let closed = false;
        const active = () => !stopped && !signal.aborted;

        function retireRegistration() {
            const previous = registered;
            registered = undefined;
            previous?.controller.abort(new Error('Teams reaction registration ended.'));
            previous?.pickup.dispose();
            previous?.reactions.dispose();
        }

        function close() {
            if (closed) return;
            closed = true;
            controller.abort(new Error('Teams reaction connection ended.'));
            retireRegistration();
            session?.dispose();
            if (notification) {
                const previous = notification;
                notification = undefined;
                if (trouter === previous) trouter = undefined;
                track(previous.stop().catch(() => {
                    getLogger().warn(LogCategory.AI, '[Teams reactions] Notification shutdown failed.');
                }));
            }
        }
        current = { close };

        function reconnect() {
            if (!active()) return;
            close();
            clearTimeout(retry);
            retry = setTimeout(() => restart(true), 60_000);
            retry.unref();
        }

        async function connect() {
            let stage: Failure = 'configuration';
            try {
                if (!region) throw new Error('Teams reaction delegation requires an IC3 region.');
                const connectionRegion = region;
                await resolveTeamsReactionDispatcher(options.store, options.dataDir, options.config.config, signal);
                signal.throwIfAborted();
                stage = 'connection';
                session = options.createSession?.(region) ?? new TeamsIc3Session({ region });
                const reader = session;
                const readHistory = reader.readHistory.bind(reader);
                const connectedAccount = await reader.connect(signal);
                signal.throwIfAborted();
                const account = { tenantId: connectedAccount.tenantId, userId: connectedAccount.userId };

                function register() {
                    retireRegistration();
                    if (!active()) return;
                    const registration = new AbortController();
                    const registrationSignal = AbortSignal.any([signal, registration.signal]);
                    const reactions = options.createReactions?.({ region: connectionRegion, expectedAccount: {
                        tenantId: account.tenantId, objectId: account.userId,
                    } }) ?? new Ic3ReactionClient({ region: connectionRegion, expectedAccount: {
                        tenantId: account.tenantId, objectId: account.userId,
                    } });
                    try {
                        const pickup = createTeamsReactionPickup({
                            account, startedAt: Date.now(), reader, reactions, execution: options.execution,
                            store: options.store, dataDir: options.dataDir, getConfig: () => options.config.config,
                            signal: registrationSignal, executionSignal: signal,
                        });
                        registered = { controller: registration, pickup, reactions };
                    } catch (error) {
                        registration.abort(error);
                        reactions.dispose();
                        throw error;
                    }
                }

                const notificationOptions: ConstructorParameters<typeof TrouterClient>[0] = {
                    expectedAccount: { tenantId: account.tenantId, objectId: account.userId },
                    target: () => active() ? chatId => chatId === '48:notes'
                        || /^19:[^\s/\\?#]+@(?:thread\.v2|unq\.gbl\.spaces)$/.test(chatId) : null,
                    onState: value => {
                        if (!active()) return;
                        getLogger().info(LogCategory.AI, `[Teams reactions] Notification state: ${value}.`);
                        try {
                            if (value === 'registered') {
                                register();
                                state = 'connected';
                                lastError = undefined;
                            } else {
                                retireRegistration();
                                state = 'connecting';
                            }
                        } catch (error) {
                            report('connection', error);
                            reconnect();
                        }
                    },
                    onWake: wake => {
                        if (!active() || wake.cause === 'message' || !registered) return;
                        getLogger().info(LogCategory.AI, `[Teams reactions] Registration boundary: ${wake.cause}.`);
                        if (wake.cause === 'disconnect') {
                            retireRegistration();
                            state = 'connecting';
                            return;
                        }
                        // A loss boundary revokes old observers; it never scans or replays reactions.
                        try { register(); }
                        catch (error) { report('connection', error); reconnect(); }
                    },
                    onError: error => {
                        if (!active()) return;
                        retireRegistration();
                        report('notification', error);
                        if (error.code === 'credentials' || error.code === 'authentication') reconnect();
                    },
                    onMessageUpdate: update => {
                        if (!active() || !registered) return;
                        const normalized = normalizeTeamsRobotReaction(update);
                        if (normalized.kind === 'ignored') {
                            getLogger().debug(LogCategory.AI, `[Teams reactions] Ignored update (${normalized.reason}).`);
                            return;
                        }
                        if (deliveries.size >= 256) { report('capacity'); return; }
                        const owner = registered;
                        const deliverySignal = signal;
                        const trace = createHash('sha256').update(JSON.stringify([
                            account.tenantId, account.userId, update.conversationId, update.messageId,
                            normalized.evidence.eventAt,
                        ])).digest('hex').slice(0, 16);
                        const startedAt = Date.now();
                        const log = (event: string, details: Record<string, unknown> = {}) =>
                            getLogger().info(LogCategory.AI, `[Teams reactions] ${event}. `
                                + JSON.stringify({ trace, elapsedMs: Date.now() - startedAt, ...details }));
                        let stage: Failure = 'pickup';
                        const aborted = () => log('Observer cancelled', {
                            stage, connectionEnded: signal.aborted, registrationEnded: owner.controller.signal.aborted,
                        });
                        deliverySignal.addEventListener('abort', aborted, { once: true });
                        log('Pickup started');
                        const delivery = owner.pickup.handle(normalized.evidence).then(async result => {
                            deliverySignal.throwIfAborted();
                            if (!result.admitted) {
                                log('Pickup rejected', { reason: result.reason });
                                return;
                            }
                            stage = 'delivery';
                            log('Job terminal; delivery started', { status: result.status });
                            const chatId = result.conversationId;
                            await options.onResult(result, {
                                account: { ...account }, chatId, messageId: result.messageId, region: connectionRegion,
                                compliance: {
                                    decisionService: options.decisionService,
                                    workspaceId: result.workspaceId, workingDirectory: result.workingDirectory,
                                    trigger: { type: 'reaction', messageId: result.messageId,
                                        text: result.sourceText, untrustedHtml: result.sourceHtml },
                                    getPolicy: () => ({
                                        enabled: options.config.config.features?.teamsOutboundCompliance === true,
                                        prompt: options.config.config.teamsOutboundCompliance?.prompt ?? '',
                                    }),
                                },
                                verifyAccess: async accessSignal => {
                                    deliverySignal.throwIfAborted();
                                    accessSignal.throwIfAborted();
                                    await readHistory(chatId, {
                                        signal: AbortSignal.any([deliverySignal, accessSignal]),
                                    });
                                    deliverySignal.throwIfAborted();
                                    accessSignal.throwIfAborted();
                                },
                            }, deliverySignal);
                            deliverySignal.throwIfAborted();
                            log('Delivery completed');
                        }).catch(error => {
                            if (!deliverySignal.aborted) {
                                if (stage === 'pickup' && owner.controller.signal.aborted
                                    && error === owner.controller.signal.reason) {
                                    log('Pickup cancelled by registration loss');
                                } else report(stage, error, trace);
                            }
                        }).finally(() => deliverySignal.removeEventListener('abort', aborted));
                        track(delivery, deliveries);
                    },
                };
                notification = options.createTrouter?.(notificationOptions) ?? new TrouterClient(notificationOptions);
                trouter = notification;
                notification.start();
            } catch (error) {
                if (!active()) return;
                report(stage, error);
                reconnect();
            }
        }
        track(connect());
    }

    const unsubscribe = options.config.onChange(() => restart());
    const unsubscribeRegion = options.teams.onIc3RegionChange(() => restart());
    restart();
    return {
        getStatus(): { state: typeof state; error?: Failure; trouter: TrouterStatus } {
            return { state, ...(lastError ? { error: lastError } : {}),
                trouter: trouter?.getStatus() ?? { state: stopped ? 'stopped' : state === 'disabled' ? 'disabled' : 'connecting', error: null } };
        },
        async dispose() {
            if (stopped) return;
            stopped = true;
            unsubscribe();
            unsubscribeRegion();
            clearTimeout(retry);
            current?.close();
            current = undefined;
            state = 'stopped';
            await Promise.all(work);
            await Promise.all(deliveries);
        },
    };
}
