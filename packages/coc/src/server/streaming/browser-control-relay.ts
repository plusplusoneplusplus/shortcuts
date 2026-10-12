import { randomUUID } from 'node:crypto';
import type { BrowserCommand, BrowserCommandResult, BrowserControlRuntime } from '@plusplusoneplusplus/coc-client';

export interface BrowserRelayClient {
    id: string;
    send(data: string): void;
}

interface Capability {
    client: BrowserRelayClient;
    workspaceId: string;
    focused: number;
}

interface Pending {
    client: BrowserRelayClient;
    finish(error?: unknown, result?: BrowserCommandResult): void;
}

/** Targeted messages never enter the global broadcast/container event channel. */
export class BrowserControlRelay implements BrowserControlRuntime {
    private enabled = () => false;
    private sequence = 0;
    private readonly clients = new Map<string, Capability>();
    private readonly pending = new Map<string, Pending>();

    setEnabledGetter(getEnabled: () => boolean): void { this.enabled = getEnabled; }
    getEnabled(): boolean { return this.enabled(); }

    advertise(client: BrowserRelayClient, workspaceId: unknown, focused: unknown): void {
        if (typeof workspaceId !== 'string' || !workspaceId || typeof focused !== 'boolean') return;
        const old = this.clients.get(client.id);
        if (old && old.workspaceId !== workspaceId) this.disconnect(client);
        this.clients.set(client.id, {
            client, workspaceId,
            focused: focused ? ++this.sequence : old?.focused ?? 0,
        });
    }

    disconnect(client: BrowserRelayClient): void {
        this.clients.delete(client.id);
        for (const pending of [...this.pending.values()]) {
            if (pending.client === client) pending.finish(new Error('CoC desktop window disconnected during browser command'));
        }
    }

    reply(client: BrowserRelayClient, reply: unknown): void {
        if (!reply || typeof reply !== 'object') return;
        const value = reply as { id?: unknown; ok?: unknown; result?: unknown; error?: unknown };
        if (typeof value.id !== 'string') return;
        const pending = this.pending.get(value.id);
        if (!pending || pending.client !== client) return;
        if (value.ok === false && typeof value.error === 'string') {
            pending.finish(new Error(value.error));
        } else if (value.ok === true && isResult(value.result)) {
            pending.finish(undefined, value.result);
        }
    }

    execute(workspaceId: string, processId: string, command: BrowserCommand, selectedTab?: string, signal?: AbortSignal): Promise<BrowserCommandResult> {
        if (!this.getEnabled()) return Promise.reject(new Error('Browser control is disabled'));
        if (signal?.aborted) return Promise.reject(signal.reason);
        const selected = [...this.clients.values()].filter(client => client.workspaceId === workspaceId)
            .sort((a, b) => b.focused - a.focused)[0];
        if (!selected) return Promise.reject(new Error('No CoC desktop window is open for this workspace'));
        const client = selected.client;
        const id = randomUUID();
        return new Promise((resolve, reject) => {
            const cancel = () => {
                try { client.send(JSON.stringify({ type: 'browser-command-cancel', id })); } catch { /* disconnected */ }
            };
            const abort = () => { cancel(); finish(signal?.reason ?? new Error('Browser command cancelled')); };
            const timer = setTimeout(() => {
                cancel();
                finish(new Error('Browser command timed out after 30s'));
            }, 30_000);
            timer.unref();
            const finish = (error?: unknown, result?: BrowserCommandResult) => {
                if (!this.pending.delete(id)) return;
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                if (error !== undefined) reject(error); else resolve(result!);
            };
            this.pending.set(id, { client, finish });
            signal?.addEventListener('abort', abort, { once: true });
            try { client.send(JSON.stringify({ type: 'browser-command', request: { id, workspaceId, processId, command, selectedTab } })); }
            catch (error) { finish(error); }
        });
    }
}

function isResult(value: unknown): value is BrowserCommandResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const result = value as Record<string, unknown>;
    if (Object.keys(result).some(key => !['tab', 'title', 'url', 'tabs', 'elements', 'interactiveElements', 'text', 'textTotal', 'value', 'image'].includes(key))) return false;
    for (const key of ['tab', 'title', 'url', 'text']) if (key in result && typeof result[key] !== 'string') return false;
    if ('tabs' in result && (!Array.isArray(result.tabs) || result.tabs.some(tab => !tab || typeof tab.id !== 'string'
        || typeof tab.title !== 'string' || typeof tab.url !== 'string' || !['electron', 'webview2'].includes(tab.engine)))) return false;
    for (const key of ['elements', 'interactiveElements']) {
        if (key in result && (!Array.isArray(result[key]) || result[key].some(element => !element
            || typeof element.ref !== 'string' || typeof element.role !== 'string' || typeof element.name !== 'string'
            || !Number.isSafeInteger(element.depth) || element.depth < 0
            || ('checked' in element && typeof element.checked !== 'boolean')))) return false;
    }
    if ('textTotal' in result && (!Number.isSafeInteger(result.textTotal) || Number(result.textTotal) < 0)) return false;
    if ('image' in result) {
        const image = result.image as Record<string, unknown> | null;
        if (!image || image.mimeType !== 'image/jpeg' || typeof image.data !== 'string'
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return false;
    }
    return true;
}
