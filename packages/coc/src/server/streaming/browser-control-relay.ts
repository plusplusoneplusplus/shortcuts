import { randomUUID } from 'node:crypto';
import type { BrowserCommand, BrowserCommandResult, BrowserControlRuntime } from '@plusplusoneplusplus/coc-client';

export interface BrowserRelayClient {
    id: string;
    send(data: string): void;
}

/** One socket serves its selected workspace plus, with background control on, workspaces it retains for active turns. */
interface Capability {
    client: BrowserRelayClient;
    workspaceId: string | null;
    background: Set<string>;
    focused: number;
}

interface Pending {
    client: BrowserRelayClient;
    workspaceId: string;
    framesEnabled: boolean;
    richPasteEnabled: boolean;
    cancel(): void;
    finish(error?: unknown, result?: BrowserCommandResult): void;
}

/** Targeted messages never enter the global broadcast/container event channel. */
export class BrowserControlRelay implements BrowserControlRuntime {
    private enabled = () => false;
    private framesEnabled = () => false;
    private richPasteEnabled = () => false;
    private backgroundEnabled = () => false;
    private sequence = 0;
    private readonly clients = new Map<string, Capability>();
    private readonly pending = new Map<string, Pending>();
    private readonly turns = new WeakMap<AbortSignal, string>();
    private readonly activeTurns = new Map<string, { workspaceId: string; turnId: string; clients: Set<BrowserRelayClient> }>();

    finishProcess(workspaceId: string, processId: string): void {
        const key = JSON.stringify([workspaceId, processId]);
        const turn = this.activeTurns.get(key);
        if (!turn) return;
        this.activeTurns.delete(key);
        for (const client of turn.clients) {
            try { client.send(JSON.stringify({ type: 'browser-turn-finished', workspaceId, processId, turnId: turn.turnId })); }
            catch { /* disconnected */ }
        }
    }

    setEnabledGetter(getEnabled: () => boolean): void { this.enabled = getEnabled; }
    getEnabled(): boolean { return this.enabled(); }
    getFramesEnabled(): boolean { return this.getEnabled() && this.framesEnabled() === true; }
    getRichPasteEnabled(): boolean { return this.getFramesEnabled() && this.richPasteEnabled() === true; }
    getBackgroundEnabled(): boolean { return this.getEnabled() && this.backgroundEnabled() === true; }
    setBackgroundEnabledGetter(getEnabled: () => boolean): void {
        this.backgroundEnabled = getEnabled;
        this.syncBackgroundPolicy();
    }
    /** Re-applies every live policy; call on runtime config change. */
    syncPolicies(): void {
        this.syncBackgroundPolicy();
        this.syncFramesPolicy();
    }
    /** With background control off, sockets serve only their selected workspace. */
    syncBackgroundPolicy(): void {
        if (this.getBackgroundEnabled()) return;
        for (const capability of [...this.clients.values()]) {
            if (!capability.background.size) continue;
            const dropped = capability.background;
            capability.background = new Set();
            if (!capability.workspaceId) this.clients.delete(capability.client.id);
            this.drop(capability.client, dropped);
        }
    }
    setRichPasteEnabledGetter(getEnabled: () => boolean): void {
        this.richPasteEnabled = getEnabled;
        this.syncFramesPolicy();
    }
    setFramesEnabledGetter(getEnabled: () => boolean): void {
        this.framesEnabled = getEnabled;
        this.syncFramesPolicy();
    }
    syncFramesPolicy(): void {
        const enabled = this.getFramesEnabled();
        for (const pending of [...this.pending.values()]) if (pending.framesEnabled !== enabled) {
            pending.cancel();
            pending.finish(new Error('Browser frame policy changed during command'));
        }
        for (const pending of [...this.pending.values()]) if (pending.richPasteEnabled && !this.getRichPasteEnabled()) {
            pending.cancel();
            pending.finish(new Error('Browser rich paste disabled during command'));
        }
    }

    advertise(client: BrowserRelayClient, workspaceId: unknown, focused: unknown, background?: unknown): void {
        if (typeof workspaceId !== 'string' || !workspaceId || typeof focused !== 'boolean') return;
        const old = this.clients.get(client.id);
        this.serve(client, workspaceId, this.retained(background, workspaceId), focused ? ++this.sequence : old?.focused ?? 0);
    }

    /** Clears the selected workspace; background control may keep retained workspaces served. */
    clear(client: BrowserRelayClient, background?: unknown): void {
        const retained = this.retained(background, null);
        if (!retained.size) return this.disconnect(client);
        this.serve(client, null, retained, this.clients.get(client.id)?.focused ?? 0);
    }

    disconnect(client: BrowserRelayClient): void {
        const old = this.clients.get(client.id);
        this.clients.delete(client.id);
        this.drop(client, old ? served(old) : null);
    }

    private retained(background: unknown, workspaceId: string | null): Set<string> {
        if (!this.getBackgroundEnabled() || !Array.isArray(background)) return new Set();
        return new Set(background.filter((id): id is string => typeof id === 'string' && !!id && id.length <= 512 && id !== workspaceId).slice(0, 64));
    }

    private serve(client: BrowserRelayClient, workspaceId: string | null, background: Set<string>, focused: number): void {
        const old = this.clients.get(client.id);
        this.clients.set(client.id, { client, workspaceId, background, focused });
        if (!old) return;
        const dropped = new Set([...served(old)].filter(id => id !== workspaceId && !background.has(id)));
        if (dropped.size) this.drop(client, dropped);
    }

    /** Rejects the socket's pending calls and turn routes for the given workspaces (all when null). */
    private drop(client: BrowserRelayClient, workspaces: Set<string> | null): void {
        for (const [key, turn] of this.activeTurns) {
            if (workspaces && !workspaces.has(turn.workspaceId)) continue;
            turn.clients.delete(client);
            if (!turn.clients.size) this.activeTurns.delete(key);
        }
        for (const pending of [...this.pending.values()]) {
            if (pending.client === client && (!workspaces || workspaces.has(pending.workspaceId))) {
                pending.finish(new Error('CoC desktop window disconnected during browser command'));
            }
        }
    }

    reply(client: BrowserRelayClient, reply: unknown): void {
        this.syncPolicies();
        if (!reply || typeof reply !== 'object') return;
        const value = reply as { id?: unknown; ok?: unknown; result?: unknown; error?: unknown };
        if (typeof value.id !== 'string') return;
        const pending = this.pending.get(value.id);
        if (!pending || pending.client !== client) return;
        if (value.ok === false && typeof value.error === 'string') {
            pending.finish(new Error(value.error));
        } else if (value.ok === true && isResult(value.result)) {
            pending.finish(undefined, value.result);
        } else if (value.ok === true && pending.framesEnabled) {
            pending.finish(new Error('Browser returned an invalid frame result'));
        }
    }

    execute(workspaceId: string, processId: string, command: BrowserCommand, selectedTab?: string, signal?: AbortSignal, controllingTurnId?: string): Promise<BrowserCommandResult> {
        if (!this.getEnabled()) return Promise.reject(new Error('Browser control is disabled'));
        this.syncPolicies();
        const framesEnabled = this.getFramesEnabled();
        const richPasteEnabled = command.action === 'paste_html' && this.getRichPasteEnabled();
        if (command.action === 'paste_html' && !richPasteEnabled) return Promise.reject(new Error('Browser rich paste is disabled'));
        if (!framesEnabled && (command.action === 'frames' || command.frame !== undefined)) {
            return Promise.reject(new Error('Browser frame control is disabled'));
        }
        if (signal?.aborted) return Promise.reject(signal.reason);
        // A window showing the workspace wins over one keeping it in the background.
        const selected = [...this.clients.values()].filter(client => client.workspaceId === workspaceId || client.background.has(workspaceId))
            .sort((a, b) => Number(b.workspaceId === workspaceId) - Number(a.workspaceId === workspaceId) || b.focused - a.focused)[0];
        if (!selected) return Promise.reject(new Error('No CoC desktop window is open for this workspace'));
        const client = selected.client;
        const id = randomUUID();
        let turnId = controllingTurnId ?? (signal && this.turns.get(signal));
        if (!turnId) {
            turnId = randomUUID();
            if (signal) this.turns.set(signal, turnId);
        }
        const turnKey = JSON.stringify([workspaceId, processId]);
        const previous = this.activeTurns.get(turnKey);
        if (previous && previous.turnId !== turnId) this.finishProcess(workspaceId, processId);
        const turn = this.activeTurns.get(turnKey) ?? { workspaceId, turnId, clients: new Set<BrowserRelayClient>() };
        turn.clients.add(client);
        this.activeTurns.set(turnKey, turn);
        return new Promise((resolve, reject) => {
            const cancel = () => {
                try { client.send(JSON.stringify({ type: 'browser-command-cancel', id })); } catch { /* disconnected */ }
            };
            const abort = () => {
                if (this.activeTurns.get(turnKey)?.turnId === turnId) this.finishProcess(workspaceId, processId);
                cancel();
                finish(signal?.reason ?? new Error('Browser command cancelled'));
            };
            const timer = setTimeout(() => {
                cancel();
                finish(new Error('Browser command timed out after 60s'));
            }, 60_000);
            timer.unref();
            const finish = (error?: unknown, result?: BrowserCommandResult) => {
                if (!this.pending.delete(id)) return;
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                if (error !== undefined) reject(error);
                else if (framesEnabled && command.action !== 'tabs' && (!result?.frame || !result.document
                    || (command.action === 'frames' && !result.frames))) {
                    reject(new Error('Unsupported desktop capability: browser frame control requires frame-aware results'));
                } else resolve(result!);
            };
            this.pending.set(id, { client, workspaceId, framesEnabled, richPasteEnabled, cancel, finish });
            signal?.addEventListener('abort', abort, { once: true });
            try { client.send(JSON.stringify({ type: 'browser-command', request: { id, turnId, workspaceId, processId, command, selectedTab, framesEnabled, ...(richPasteEnabled ? { richPasteEnabled: true } : {}) } })); }
            catch (error) { finish(error); }
        });
    }
}

function served(capability: Capability): Set<string> {
    return new Set([...(capability.workspaceId ? [capability.workspaceId] : []), ...capability.background]);
}

function isResult(value: unknown): value is BrowserCommandResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const result = value as Record<string, unknown>;
    if (Object.keys(result).some(key => !['tab', 'title', 'url', 'tabs', 'elements', 'interactiveElements', 'frames', 'frame', 'document', 'truncated', 'text', 'textTotal', 'value', 'valueJson', 'valueTruncated', 'image'].includes(key))) return false;
    if ('valueJson' in result && typeof result.valueJson !== 'string') return false;
    if ('valueTruncated' in result && typeof result.valueTruncated !== 'boolean') return false;
    for (const key of ['tab', 'title', 'url', 'text']) if (key in result && typeof result[key] !== 'string') return false;
    for (const key of ['frame', 'document']) if (key in result && !handle(result[key])) return false;
    if ('truncated' in result && (typeof result.truncated !== 'string' || !result.truncated.trim() || result.truncated.length > 1024)) return false;
    if ('frames' in result) {
        if (!Array.isArray(result.frames) || result.frames.length > 32) return false;
        const ids = new Set<string>();
        for (const frame of result.frames) {
            if (!frame || typeof frame !== 'object' || Array.isArray(frame)
                || Object.keys(frame).some(key => !['id', 'parent', 'origin', 'name', 'document', 'status', 'depth'].includes(key))
                || !handle(frame.id) || ids.has(frame.id) || !handle(frame.document)
                || ('parent' in frame && (!handle(frame.parent) || frame.parent === frame.id))
                || typeof frame.name !== 'string' || frame.name.length > 160
                || typeof frame.origin !== 'string' || frame.origin.length > 256
                || !['ready', 'loading', 'unavailable'].includes(frame.status)
                || !Number.isSafeInteger(frame.depth) || frame.depth < 0 || frame.depth > 8) return false;
            ids.add(frame.id);
        }
    }
    if ('tabs' in result && (!Array.isArray(result.tabs) || result.tabs.some(tab => !tab || typeof tab !== 'object' || Array.isArray(tab) || typeof tab.id !== 'string'
        || typeof tab.title !== 'string' || typeof tab.url !== 'string' || !['electron', 'webview2'].includes(tab.engine)))) return false;
    for (const key of ['elements', 'interactiveElements']) {
        if (key in result && (!Array.isArray(result[key]) || result[key].some(element => !element
            || typeof element !== 'object' || Array.isArray(element)
            || Object.keys(element).some(key => !['ref', 'role', 'name', 'depth', 'checked', 'frame'].includes(key))
            || typeof element.ref !== 'string' || typeof element.role !== 'string' || typeof element.name !== 'string'
            || !Number.isSafeInteger(element.depth) || element.depth < 0
            || ('checked' in element && typeof element.checked !== 'boolean')
            || ('frame' in element && !handle(element.frame))))) return false;
        if (Array.isArray(result[key]) && new Set(result[key].map(element => element.ref)).size !== result[key].length) return false;
    }
    if (Array.isArray(result.frames)) {
        const frames = new Map(result.frames.map(frame => [frame.id, frame]));
        if ('frame' in result && frames.has(result.frame) && frames.get(result.frame).document !== result.document) return false;
        for (const frame of result.frames) {
            const ancestors = new Set<string>([frame.id]);
            let parent = frame.parent;
            while (parent && frames.has(parent)) {
                if (ancestors.has(parent)) return false;
                ancestors.add(parent);
                const ancestor = frames.get(parent);
                if (ancestor.depth >= frame.depth) return false;
                parent = ancestor.parent;
            }
        }
        const refs = new Map<string, string>();
        for (const element of [...(result.elements as BrowserCommandResult['elements'] ?? []),
            ...(result.interactiveElements as BrowserCommandResult['interactiveElements'] ?? [])]) {
            if (!/^e[1-9]\d*$/.test(element.ref) || !element.frame || !frames.has(element.frame)
                || (refs.has(element.ref) && refs.get(element.ref) !== element.frame)) return false;
            refs.set(element.ref, element.frame);
        }
    }
    if ('textTotal' in result && (!Number.isSafeInteger(result.textTotal) || Number(result.textTotal) < 0)) return false;
    if ('image' in result) {
        const image = result.image as Record<string, unknown> | null;
        if (!image || image.mimeType !== 'image/jpeg' || typeof image.data !== 'string'
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return false;
    }
    return true;
}

function handle(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s|[\]]/.test(value);
}
