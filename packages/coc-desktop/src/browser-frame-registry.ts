import { randomUUID } from 'node:crypto';
import type { BrowserControlFrame } from '@plusplusoneplusplus/coc-client';
import type { BrowserCdpSender } from './browser-control-page';

export type BrowserCdpListener = (method: string, params: Record<string, unknown>, sessionId?: string) => void;

interface Frame extends BrowserControlFrame {
    rawId: string;
    session?: string;
    context?: number;
    loader?: string;
    parentRaw?: string;
}

interface FrameTree {
    frame: { id: string; parentId?: string; name?: string; securityOrigin?: string; loaderId?: string };
    childFrames?: FrameTree[];
}

/** Private view-owned identities. Protocol identifiers never leave the main process. */
export class BrowserFrameRegistry {
    private readonly entries = new Map<string, Frame>();
    private readonly sessions = new Map<string, { frameId: string; initialized: boolean; parentSession?: string }>();
    private readonly contexts = new Map<string, { frame: string; id: number }>();
    private unsubscribe?: () => void;
    private started = false;
    private failure?: Error;
    private sequence = 0;
    private readonly epoch = randomUUID();
    revision = 0;
    truncated?: string;

    constructor(private readonly send: BrowserCdpSender, private readonly invalidate: () => void) {}

    private changed(): void {
        this.revision++;
        this.invalidate();
    }

    private update(info: FrameTree['frame'], session?: string): Frame {
        let frame = this.entries.get(info.id);
        if (!frame) {
            if (this.entries.size >= 256) throw new Error('Browser frame registry limit exceeded');
            frame = { id: `f${randomUUID()}`, rawId: info.id, name: '', origin: 'opaque',
                document: `${this.epoch}:${++this.sequence}`, status: 'loading', depth: 0 };
            this.entries.set(info.id, frame);
        }
        if (frame.loader !== undefined && info.loaderId !== undefined && frame.loader !== info.loaderId) {
            this.retire(info.id, false);
            frame.id = `f${randomUUID()}`;
            frame.document = `${this.epoch}:${++this.sequence}`;
            frame.context = undefined;
            frame.status = 'loading';
            this.changed();
        }
        frame.loader = info.loaderId ?? frame.loader;
        frame.parentRaw = info.parentId ?? frame.parentRaw;
        frame.name = (info.name ?? frame.name).replace(/[\r\n\t]/g, ' ').slice(0, 160);
        frame.origin = (info.securityOrigin ?? frame.origin).slice(0, 256) || 'opaque';
        frame.session = session;
        return frame;
    }

    private retire(rawId: string, remove = true): void {
        for (const child of [...this.entries.values()]) if (child.parentRaw === rawId) this.retire(child.rawId);
        const frame = this.entries.get(rawId);
        if (frame) {
            if (remove) this.entries.delete(rawId);
            else { frame.context = undefined; frame.document = `${this.epoch}:${++this.sequence}`; }
        }
        for (const [key, context] of this.contexts) if (context.frame === rawId) this.contexts.delete(key);
    }

    private readonly event: BrowserCdpListener = (method, params, session) => {
        if (!this.started || this.failure) return;
        try {
            if (method === 'Target.attachedToTarget') {
                const info = params.targetInfo as { type?: string; targetId?: string } | undefined;
                if (info?.type !== 'iframe' || typeof params.sessionId !== 'string' || !info.targetId) return;
                if (this.sessions.size >= 256) throw new Error('Browser frame session limit exceeded');
                this.sessions.set(params.sessionId, { frameId: info.targetId, initialized: false, parentSession: session });
            } else if (method === 'Target.detachedFromTarget') {
                const id = String(params.sessionId);
                if (this.sessions.has(id)) {
                    const removed = new Set([id]);
                    for (const [child, info] of this.sessions) if (info.parentSession && removed.has(info.parentSession)) removed.add(child);
                    for (const removedId of removed) {
                        const owned = this.sessions.get(removedId)!;
                        if (this.entries.get(owned.frameId)?.session === removedId) this.retire(owned.frameId);
                        for (const key of this.contexts.keys()) if (key.startsWith(`${removedId}:`)) this.contexts.delete(key);
                        this.sessions.delete(removedId);
                    }
                    this.changed();
                }
            } else if (method === 'Page.frameAttached') {
                if (typeof params.frameId === 'string') this.update({ id: params.frameId, parentId: String(params.parentFrameId) }, session);
            } else if (method === 'Page.frameNavigated') {
                const info = params.frame as FrameTree['frame'] | undefined;
                if (info?.id) { this.update(info, session); this.changed(); }
            } else if (method === 'Page.navigatedWithinDocument') {
                if (typeof params.frameId === 'string') {
                    const frame = this.entries.get(params.frameId);
                    if (frame) {
                        frame.id = `f${randomUUID()}`;
                        frame.document = `${this.epoch}:${++this.sequence}`;
                    }
                    this.changed();
                }
            } else if (method === 'Page.frameDetached' && params.reason !== 'swap') {
                if (typeof params.frameId === 'string') { this.retire(params.frameId); this.changed(); }
            } else if (method === 'Runtime.executionContextCreated') {
                const context = params.context as { id: number; origin?: string; auxData?: { frameId?: string; isDefault?: boolean } } | undefined;
                if (!context?.auxData?.isDefault || !context.auxData.frameId) return;
                if (this.contexts.size >= 256 && !this.contexts.has(`${session ?? ''}:${context.id}`)) throw new Error('Browser frame context limit exceeded');
                const frameId = context.auxData.frameId;
                this.contexts.set(`${session ?? ''}:${context.id}`, { frame: frameId, id: context.id });
                const frame = this.entries.get(frameId);
                if (frame) {
                    if (frame.context !== undefined && (frame.context !== context.id || frame.session !== session)) {
                        frame.id = `f${randomUUID()}`;
                        frame.document = `${this.epoch}:${++this.sequence}`;
                        this.changed();
                    }
                    frame.context = context.id;
                    frame.session = session;
                    frame.origin = (context.origin || frame.origin).slice(0, 256);
                    frame.status = 'ready';
                }
            } else if (method === 'Runtime.executionContextDestroyed' || method === 'Runtime.executionContextsCleared') {
                for (const [key, context] of [...this.contexts]) {
                    if (!key.startsWith(`${session ?? ''}:`)) continue;
                    if (method.endsWith('Destroyed') && context.id !== params.executionContextId) continue;
                    const frame = this.entries.get(context.frame);
                    if (frame?.context === context.id && frame.session === session) {
                        frame.context = undefined;
                        frame.id = `f${randomUUID()}`;
                        frame.status = 'loading';
                        frame.document = `${this.epoch}:${++this.sequence}`;
                    }
                    this.contexts.delete(key);
                    this.changed();
                }
            } else if (method === 'Inspector.detached' || method === 'Inspector.targetCrashed') {
                throw new Error('Browser frame debugger unavailable');
            }
        } catch (error) {
            this.failure = error instanceof Error ? error : new Error(String(error));
            this.changed();
        }
    };

    async start(subscribe: (listener: BrowserCdpListener) => () => void, ready?: () => Promise<void>): Promise<void> {
        if (this.started) return this.refresh();
        this.started = true;
        this.unsubscribe = subscribe(this.event);
        try {
            await ready?.();
            await this.initialize();
            await this.refresh();
        } catch (error) {
            this.failure = error instanceof Error ? error : new Error(String(error));
            try { await this.stop(); }
            catch (cleanup) { throw new AggregateError([this.failure, cleanup], 'unsupported-runtime: browser frame initialization and cleanup failed'); }
            throw new Error(`unsupported-runtime: browser frame control unavailable: ${this.failure.message}`);
        }
    }

    private async initialize(session?: string): Promise<void> {
        await this.send('Page.enable', {}, session);
        const tree = await this.send('Page.getFrameTree', {}, session) as { frameTree?: FrameTree };
        if (!tree.frameTree) throw new Error('Browser frame tree unavailable');
        const walk = (node: FrameTree, parent?: string, depth = 0) => {
            if (depth > 8 || this.entries.size >= 256) { this.truncated = 'frame-registry-limit'; return; }
            const retainedSession = session ?? this.entries.get(node.frame.id)?.session;
            this.update({ ...node.frame, parentId: node.frame.parentId ?? parent }, retainedSession);
            for (const child of node.childFrames ?? []) walk(child, node.frame.id, depth + 1);
        };
        walk(tree.frameTree);
        await this.send('Runtime.enable', {}, session);
        // Auto-attach is scoped to related iframe targets, never browser-wide discovery.
        await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
            filter: [{ type: 'iframe', exclude: false }, { exclude: true }] }, session);
    }

    async refresh(): Promise<void> {
        if (this.failure) throw this.failure;
        this.truncated = undefined;
        for (let count = 0; count < 256; count++) {
            const pending = [...this.sessions].find(([, value]) => !value.initialized);
            if (!pending) break;
            const [session, value] = pending;
            // Related attachment is insufficient: a frame must be in this view's tree.
            if (!this.entries.has(value.frameId)) {
                // OOPIFs need not appear in the root target's frame tree.
                const tree = await this.send('Page.getFrameTree', {}, session) as { frameTree?: FrameTree };
                const info = tree.frameTree?.frame;
                if (!info || info.id !== value.frameId) throw new Error('Browser iframe target ancestry unavailable');
                const parents = info.parentId ? [this.entries.get(info.parentId)].filter((frame): frame is Frame => !!frame) : [...this.entries.values()];
                for (const parent of parents) {
                    if (parent.context === undefined) continue;
                    if (await this.ownsFrame(parent, info.id)) {
                        this.update({ ...info, parentId: parent.rawId }, session);
                        break;
                    }
                }
            }
            if (!this.entries.has(value.frameId)) throw new Error('Browser iframe target ancestry unavailable');
            value.initialized = true;
            await this.initialize(session);
        }
        for (const frame of this.entries.values()) {
            const context = [...this.contexts].find(([key, value]) => value.frame === frame.rawId && key.startsWith(`${frame.session ?? ''}:`));
            if (context) { frame.context = context[1].id; frame.status = 'ready'; }
        }
        for (const frame of this.list()) if (frame.context !== undefined) {
            frame.status = await this.evaluate<boolean>('!!document.body && document.readyState !== "loading"', frame.id) ? 'ready' : 'loading';
        }
        if (this.failure) throw this.failure;
    }

    private async ownsFrame(parent: Frame, rawId: string): Promise<boolean> {
        let objectId: string | undefined;
        try {
            const owner = await this.send('DOM.getFrameOwner', { frameId: rawId }, parent.session) as { backendNodeId?: number };
            if (!owner.backendNodeId) return false;
            const object = await this.send('DOM.resolveNode', { backendNodeId: owner.backendNodeId, executionContextId: parent.context }, parent.session) as { object?: { objectId?: string } };
            objectId = object.object?.objectId;
            if (!objectId) return false;
            const result = await this.send('Runtime.callFunctionOn', { objectId,
                functionDeclaration: 'function(){return this.ownerDocument === document}', returnByValue: true }, parent.session) as { result?: { value?: boolean } };
            return result.result?.value === true;
        } catch (error) {
            // A parent target may not own this backend node; other protocol failures remain visible.
            if (error instanceof Error && /frame.*(not found|not belong)|no frame|could not find.*(frame|node)|node.*not found|cannot find context/i.test(error.message)) return false;
            throw error;
        } finally {
            if (objectId) await this.send('Runtime.releaseObject', { objectId }, parent.session);
        }
    }

    list(offset = 0): Frame[] {
        const result: Frame[] = [];
        let skipped = 0;
        const visit = (parent: Frame | undefined, depth: number) => {
            for (const frame of this.entries.values()) if (frame.parentRaw === parent?.rawId) {
                if (depth > 8) { this.truncated = 'frame-depth-limit'; continue; }
                frame.parent = parent?.id; frame.depth = depth;
                if (skipped++ < offset) { visit(frame, depth + 1); continue; }
                if (result.length >= 32) { this.truncated = 'frame-limit'; continue; }
                result.push(frame);
                visit(frame, depth + 1);
            }
        };
        visit(undefined, 0);
        return result;
    }

    metadata(offset = 0): BrowserControlFrame[] {
        return this.list(offset).map(({ id, parent, name, origin, document, status, depth }) => ({ id, parent, name, origin, document, status, depth }));
    }

    resolve(handle?: string): Frame {
        const frame = handle ? [...this.entries.values()].find(value => value.id === handle) : this.list()[0];
        if (!frame) throw new Error('stale frame, re-snapshot');
        if (frame.context === undefined) throw new Error('Browser frame execution context unavailable');
        return frame;
    }

    assert(revision: number): void {
        if (this.failure) throw this.failure;
        if (this.revision !== revision) throw new Error('stale browser frame context, re-snapshot');
    }

    async evaluate<T>(expression: string, handle?: string, awaitPromise = false): Promise<T> {
        const frame = this.resolve(handle);
        const { document, context, session, rawId, id } = frame;
        const reply = await this.send('Runtime.evaluate', { expression, contextId: frame.context, returnByValue: true, awaitPromise }, frame.session) as {
            result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } };
        };
        if (this.failure) throw this.failure;
        const current = this.entries.get(rawId);
        if (!current || current.id !== id || current.document !== document || current.context !== context || current.session !== session) {
            throw new Error('stale browser frame context, re-snapshot');
        }
        if (reply.exceptionDetails) throw new Error((reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text ?? 'Frame evaluation failed').slice(0, 4000));
        if (!reply.result || !('value' in reply.result)) throw new Error('Browser frame returned no result');
        return reply.result.value as T;
    }

    async stop(): Promise<void> {
        this.started = false;
        try {
            const results: PromiseSettledResult<unknown>[] = [];
            for (const [session, info] of [...this.sessions].reverse()) {
                results.push(...await Promise.allSettled([this.send('Target.detachFromTarget', { sessionId: session }, info.parentSession)]));
            }
            results.push(...await Promise.allSettled([
                this.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }),
                this.send('Runtime.disable'), this.send('Page.disable')]));
            const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
            if (failed) throw failed.reason;
        } finally {
            this.unsubscribe?.();
            this.unsubscribe = undefined;
            this.entries.clear(); this.sessions.clear(); this.contexts.clear();
            this.changed();
        }
    }

    dispose(): void {
        this.started = false;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.failure = new Error('Browser frame view closed');
        this.entries.clear(); this.sessions.clear(); this.contexts.clear();
        this.changed();
    }
}
