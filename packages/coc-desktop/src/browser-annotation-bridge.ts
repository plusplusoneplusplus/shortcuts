import type { BrowserAnnotationEvent } from './browser-annotation-dom';
import { isValidBrowserAnnotationId, type BrowserAnnotationEndReason } from './browser-annotation-tab';
import type { BrowserHostManager } from './browser-host-manager';
import { isValidBrowserSessionKey, isValidBrowserViewId } from './browser-view-policy';

export const BROWSER_ANNOTATION_COMMAND_CHANNEL = 'coc-desktop:browser-annotation-command';
export const BROWSER_ANNOTATION_EVENT_CHANNEL = 'coc-desktop:browser-annotation-event';

/** Generate a fresh requestId for each entry into annotation mode. */
export interface BrowserAnnotationIdentity {
    viewId: string;
    sessionKey: string;
    requestId: string;
}
export type BrowserAnnotationRequest =
    | (BrowserAnnotationIdentity & { action: 'start' | 'stop' })
    | (BrowserAnnotationIdentity & { action: 'remove'; id: string })
    | { action: 'policy'; sessionKey: string; enabled: boolean };
export type BrowserAnnotationNotification = BrowserAnnotationIdentity & (
    | { type: 'events'; events: BrowserAnnotationEvent[] }
    | { type: 'ended'; reason: BrowserAnnotationEndReason; error?: string }
);

type Manager = Pick<BrowserHostManager, 'startAnnotation' | 'stopAnnotation' | 'removeAnnotation' | 'setAnnotationEnabled'>;
type Subscription = BrowserAnnotationIdentity & { stopping: boolean };

/** Registered-main-frame callers only. Main owns transport and never accepts injected code. */
export class BrowserAnnotationBridge {
    private readonly owners = new Map<number, Map<string, Subscription>>();

    constructor(private readonly manager: Manager) {}

    async command(ownerId: number, input: unknown, send: (event: BrowserAnnotationNotification) => void): Promise<boolean | void> {
        if (!input || typeof input !== 'object') throw new TypeError('Invalid browser annotation request');
        const request = input as BrowserAnnotationRequest;
        if (!isValidBrowserSessionKey(request.sessionKey)) throw new TypeError('Invalid browser annotation session');
        if (request.action === 'policy') {
            if (typeof request.enabled !== 'boolean') throw new TypeError('Invalid browser annotation policy');
            return this.manager.setAnnotationEnabled(ownerId, request.sessionKey, request.enabled);
        }
        if ((request.action !== 'start' && request.action !== 'stop' && request.action !== 'remove') || !isValidBrowserViewId(request.viewId)
            || typeof request.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(request.requestId)) {
            throw new TypeError('Invalid browser annotation identity');
        }
        let views = this.owners.get(ownerId);
        const previous = views?.get(request.viewId);
        if (request.action === 'remove') {
            if (!isValidBrowserAnnotationId(request.id)) throw new TypeError('Invalid browser annotation pin');
            // Match before dispatch; a stopped generation cannot target a replacement or another owner.
            if (!previous || previous.stopping || previous.requestId !== request.requestId
                || previous.sessionKey !== request.sessionKey) return;
            return this.manager.removeAnnotation(ownerId, request.viewId, request.sessionKey, request.id);
        }
        if (request.action === 'stop') {
            // Old cleanup must never remove a replacement mode or another concrete workspace.
            if (!previous || previous.requestId !== request.requestId || previous.sessionKey !== request.sessionKey) return;
            previous.stopping = true;
            try { await this.manager.stopAnnotation(ownerId, request.viewId, request.sessionKey); }
            finally { this.remove(ownerId, previous); }
            return;
        }
        if (previous) throw new Error('Browser annotation is already starting or active.');
        if (!views) { views = new Map(); this.owners.set(ownerId, views); }
        const identity = { viewId: request.viewId, sessionKey: request.sessionKey, requestId: request.requestId };
        const subscription: Subscription = { ...identity, stopping: false };
        views.set(request.viewId, subscription);
        const current = () => this.owners.get(ownerId)?.get(identity.viewId) === subscription;
        try {
            const active = await this.manager.startAnnotation(ownerId, identity.viewId, identity.sessionKey, {
                events: events => {
                    if (current() && !subscription.stopping) send({ ...identity, type: 'events', events });
                },
                ended: (reason, error) => {
                    if (!current()) return;
                    this.remove(ownerId, subscription);
                    send({ ...identity, type: 'ended', reason,
                        ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }) });
                },
            });
            if (!active || !current() || subscription.stopping) {
                this.remove(ownerId, subscription);
                return false;
            }
            return true;
        } catch (error) {
            this.remove(ownerId, subscription);
            throw error;
        }
    }

    /** Revoke notification leases before owner reload/crash/closure starts native cleanup. */
    clearOwner(ownerId: number): void { this.owners.delete(ownerId); }
    dispose(): void { this.owners.clear(); }

    private remove(ownerId: number, subscription: Subscription): void {
        const views = this.owners.get(ownerId);
        if (views?.get(subscription.viewId) !== subscription) return;
        views.delete(subscription.viewId);
        if (!views.size) this.owners.delete(ownerId);
    }
}
