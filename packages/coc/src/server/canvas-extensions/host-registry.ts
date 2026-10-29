import { promises as fs } from 'fs';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { CanvasDeclaration } from '@github/copilot-sdk';
import type { CLIConfig } from '../../config';
import type { DiscoveredCanvasExtension } from './discovery';
import { CanvasExtensionHost, type CanvasInstanceRequest, type CanvasExtensionHostOptions } from './extension-host';

export interface CanvasExtensionOwner {
    workspaceId: string;
    processId: string;
}

export interface CanvasExtensionRegistryOptions {
    config: () => Pick<CLIConfig, 'canvasExtensions'>;
    store: Pick<ProcessStore, 'getProcess'>;
    dataDir: string;
    log: (message: string) => void;
    send?: (owner: CanvasExtensionOwner, extensionKey: string, prompt: string) => Promise<{ messageId: string }>;
    ephemeralQuery?: (owner: CanvasExtensionOwner, question: string) => Promise<{ answer: string }>;
    /** Open persisted instances, read once when a conversation runtime is first used. */
    loadInstances?: (owner: CanvasExtensionOwner, extensionKey: string) => CanvasInstanceRequest[];
    /** Test seam; production always starts the stdio host. */
    startHost?: (options: CanvasExtensionHostOptions) => Promise<CanvasExtensionHost>;
}

interface Entry {
    owner: CanvasExtensionOwner;
    extension: DiscoveredCanvasExtension;
    instances: Map<string, CanvasInstanceRequest>;
    host?: CanvasExtensionHost;
    tail: Promise<unknown>;
    pending: number;
    retired: boolean;
    hydrated: boolean;
    timer?: ReturnType<typeof setTimeout>;
}

/** One lazy canvas runtime per conversation and extension, independent of providers. */
export class CanvasExtensionHostRegistry {
    private readonly entries = new Map<string, Entry>();
    private readonly declarationCache = new Map<string, { contentHash: string; declarations: CanvasDeclaration[] }>();
    private readonly cleanup = new Set<Promise<void>>();
    private disposed = false;
    private disposePromise?: Promise<void>;
    private readonly idleTtlMs: number;

    constructor(private readonly options: CanvasExtensionRegistryOptions) {
        const value = Number(process.env.COC_CANVAS_EXT_IDLE_TTL_MS ?? 600_000);
        this.idleTtlMs = Number.isFinite(value) && value >= 0 && value <= 2_147_483_647 ? value : 600_000;
    }

    async declarations(owner: CanvasExtensionOwner, extension: DiscoveredCanvasExtension) {
        await this.assertOwner(owner);
        const cached = this.declarationCache.get(extension.extensionPath);
        if (cached?.contentHash === extension.contentHash) return structuredClone(cached.declarations);
        return this.run(owner, extension, host => Promise.resolve(structuredClone(host.declarations)));
    }

    open(owner: CanvasExtensionOwner, extension: DiscoveredCanvasExtension, request: CanvasInstanceRequest) {
        // Snapshot input before queueing: reopening must use the successful open's original input.
        const saved = structuredClone(request);
        return this.run(owner, extension, async (host, entry) => {
            const known = entry.instances.get(saved.instanceId);
            if (known && known.canvasId !== saved.canvasId) throw new Error('Canvas instance belongs to another canvas');
            const result = await host.open(saved);
            this.assertActive(entry);
            entry.instances.set(saved.instanceId, saved);
            return result;
        });
    }

    invoke(owner: CanvasExtensionOwner, extension: DiscoveredCanvasExtension,
        request: { instanceId: string; actionName: string; input?: Record<string, unknown> }) {
        return this.run(owner, extension, (host, entry) => {
            const instance = this.instance(entry, request.instanceId);
            return host.invoke({ ...request, canvasId: instance.canvasId });
        });
    }

    close(owner: CanvasExtensionOwner, extension: DiscoveredCanvasExtension, instanceId: string) {
        return this.run(owner, extension, async (host, entry) => {
            await host.close(this.instance(entry, instanceId));
            this.assertActive(entry);
            entry.instances.delete(instanceId);
        });
    }

    /** Called synchronously on store events, revoking queued and starting work immediately. */
    stopConversation(owner: CanvasExtensionOwner, deleted = false): Promise<void> {
        const stops = [...this.entries.values()]
            .filter(entry => entry.owner.workspaceId === owner.workspaceId && entry.owner.processId === owner.processId)
            .map(entry => this.retire(entry));
        return this.track((async () => {
            await Promise.all(stops);
            if (deleted) {
                const directory = path.join(this.options.dataDir, 'canvas-ext', 'home', 'session-state');
                const target = path.resolve(directory, owner.processId);
                // IDs come from the store, but never let malformed historical IDs remove other data.
                if (path.dirname(target) !== path.resolve(directory)) throw new Error('Invalid canvas conversation ID');
                await fs.rm(target, { recursive: true, force: true });
            }
        })());
    }

    onProcessChange(event: Parameters<NonNullable<ProcessStore['onProcessChange']>>[0]): void {
        let cleanup: Promise<void> | undefined;
        if (event.type === 'processes-cleared') {
            // Clear can be workspace-filtered; keep surviving conversations' runtimes intact.
            const owners = new Map([...this.entries.values()].map(entry => [
                JSON.stringify(entry.owner), entry.owner,
            ]));
            cleanup = Promise.all([...owners.values()].map(async owner => {
                const conversation = await this.options.store.getProcess(owner.processId, owner.workspaceId);
                if (!conversation || conversation.metadata?.workspaceId !== owner.workspaceId) {
                    await this.stopConversation(owner, true);
                } else if (conversation.archived) await this.stopConversation(owner);
            })).then(() => {});
            this.track(cleanup);
        } else if (event.process && (event.type === 'process-removed' || event.process.archived)) {
            const workspaceId = event.process.metadata?.workspaceId;
            if (typeof workspaceId === 'string') {
                cleanup = this.stopConversation({ workspaceId, processId: event.process.id }, event.type === 'process-removed');
            }
        }
        void cleanup?.catch(error => this.options.log(`Canvas conversation cleanup failed: ${error}`));
    }

    /** Live flag changes stop existing runtimes as well as preventing later starts. */
    syncConfig(): Promise<void> {
        if (this.options.config().canvasExtensions?.enabled) return Promise.resolve();
        return this.stopAll();
    }

    stopAll(): Promise<void> {
        this.declarationCache.clear();
        return this.track(Promise.all([...this.entries.values()].map(entry => this.retire(entry))).then(() => {}));
    }

    dispose(): Promise<void> {
        if (this.disposePromise) return this.disposePromise;
        this.disposed = true;
        this.disposePromise = (async () => {
            await this.stopAll();
            await Promise.all([...this.cleanup]);
        })();
        return this.disposePromise;
    }

    private run<T>(owner: CanvasExtensionOwner, extension: DiscoveredCanvasExtension,
        action: (host: CanvasExtensionHost, entry: Entry) => Promise<T>): Promise<T> {
        try { this.assertEnabled(); } catch (error) { return Promise.reject(error); }
        const key = JSON.stringify([owner.workspaceId, owner.processId, extension.extensionKey]);
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { owner: { ...owner }, extension: { ...extension }, instances: new Map(),
                tail: Promise.resolve(), pending: 0, retired: false, hydrated: false };
            this.entries.set(key, entry);
        }
        const current = entry;
        clearTimeout(current.timer);
        current.pending++;
        const result = current.tail.then(async () => {
            this.assertActive(current);
            await this.assertOwner(owner);
            this.assertActive(current);
            if (current.extension.extensionPath !== extension.extensionPath
                || current.extension.contentHash !== extension.contentHash) {
                await current.host?.dispose();
                this.assertActive(current);
                current.extension = { ...extension };
            }
            if (!current.hydrated) {
                const instances = this.options.loadInstances?.(current.owner, current.extension.extensionKey) ?? [];
                for (const instance of instances) current.instances.set(instance.instanceId, structuredClone(instance));
                current.hydrated = true;
            }
            const host = await this.ensureHost(current);
            this.assertActive(current);
            const value = await action(host, current);
            this.assertActive(current);
            return value;
        });
        current.tail = result.then(() => {}, () => {}).finally(() => {
            current.pending--;
            if (!current.retired && current.pending === 0 && current.instances.size === 0) {
                current.timer = setTimeout(() => {
                    void this.retire(current).catch(error => this.options.log(`Canvas idle cleanup failed: ${error}`));
                }, this.idleTtlMs);
                current.timer.unref?.();
            }
        });
        return result;
    }

    private async ensureHost(entry: Entry): Promise<CanvasExtensionHost> {
        if (entry.host?.running) return entry.host;
        await entry.host?.dispose();
        this.assertActive(entry);
        const host = await (this.options.startHost ?? CanvasExtensionHost.start)({
            config: this.options.config(), extension: entry.extension,
            processId: entry.owner.processId, dataDir: this.options.dataDir, log: this.options.log,
            send: prompt => {
                this.assertActive(entry);
                if (!this.options.send) throw new Error('Canvas extension follow-up service is unavailable');
                return this.options.send(entry.owner, entry.extension.extensionKey, prompt);
            },
            ephemeralQuery: question => {
                this.assertActive(entry);
                if (!this.options.ephemeralQuery) throw new Error('Canvas extension completion service is unavailable');
                return this.options.ephemeralQuery(entry.owner, question);
            },
        });
        entry.host = host;
        try {
            this.assertActive(entry);
            this.declarationCache.set(entry.extension.extensionPath, {
                contentHash: entry.extension.contentHash, declarations: structuredClone(host.declarations),
            });
            for (const instance of entry.instances.values()) {
                await host.open(instance);
                this.assertActive(entry);
            }
            return host;
        } catch (error) {
            await host.dispose();
            throw error;
        }
    }

    private retire(entry: Entry): Promise<void> {
        if (!entry.retired) {
            entry.retired = true;
            clearTimeout(entry.timer);
            // Keep this entry until cleanup finishes so a later call cannot overlap its child.
            const stop = entry.host?.dispose();
            return this.track((async () => {
                await stop;
                await entry.tail;
                await entry.host?.dispose();
                const key = JSON.stringify([entry.owner.workspaceId, entry.owner.processId, entry.extension.extensionKey]);
                if (this.entries.get(key) === entry) this.entries.delete(key);
            })());
        }
        return entry.tail.then(() => entry.host?.dispose());
    }

    private instance(entry: Entry, instanceId: string): CanvasInstanceRequest {
        const instance = entry.instances.get(instanceId);
        if (!instance) throw new Error(`Unknown canvas instance: ${instanceId}`);
        return instance;
    }

    private assertEnabled(): void {
        if (this.disposed) throw new Error('Canvas extension registry is disposed');
        if (!this.options.config().canvasExtensions?.enabled) throw new Error('Canvas extensions are disabled');
    }

    private async assertOwner(owner: CanvasExtensionOwner): Promise<void> {
        this.assertEnabled();
        const conversation = await this.options.store.getProcess(owner.processId, owner.workspaceId);
        this.assertEnabled();
        if (!conversation || conversation.archived || conversation.metadata?.workspaceId !== owner.workspaceId) {
            throw new Error('Canvas conversation is missing, archived or owned by another workspace');
        }
    }

    private assertActive(entry: Entry): void {
        this.assertEnabled();
        if (entry.retired) throw new Error('Canvas conversation runtime has stopped');
    }

    private track(promise: Promise<void>): Promise<void> {
        this.cleanup.add(promise);
        void promise.then(() => this.cleanup.delete(promise), () => this.cleanup.delete(promise));
        return promise;
    }
}
