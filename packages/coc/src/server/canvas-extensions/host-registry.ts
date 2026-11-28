import { promises as fs } from 'fs';
import { generatedOwnerRoot, removeManagedPath, assertManagedPath } from './generated-packages';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { CanvasDeclaration } from '@github/copilot-sdk';
import type { CLIConfig } from '../../config';
import type { DiscoveredCanvasExtension } from './discovery';
import type { OwnerScriptRunner } from '../executors/owner-script-runner';
import { runOwnerToolScript } from '../canvas/owner-tool-script-service';
import { CanvasExtensionHost, type CanvasInstanceRequest, type CanvasExtensionHostOptions } from './extension-host';
import { listSessionWorkspaceOwners, sessionWorkspacePath } from './session-workspace';
import type { CanvasMcpServerList } from './mcp-server-list';
import type { CanvasToolMetadataResult } from './tool-metadata';

export interface CanvasExtensionOwner {
    workspaceId: string;
    processId: string;
}

export interface CanvasExtensionRegistryOptions {
    config: () => Pick<CLIConfig, 'canvasExtensions'>;
    store: Pick<ProcessStore, 'getProcess'> & Partial<Pick<ProcessStore, 'getWorkspaces'>>;
    dataDir: string;
    log: (message: string) => void;
    send?: (owner: CanvasExtensionOwner, extensionKey: string, prompt: string) => Promise<{ messageId: string }>;
    ephemeralQuery?: (owner: CanvasExtensionOwner, extensionKey: string, question: string) => Promise<{ answer: string }>;
    getOwnerScriptRunner?: () => OwnerScriptRunner | undefined;
    listMcpServers?: (owner: CanvasExtensionOwner) => Promise<CanvasMcpServerList>;
    getToolMetadata?: (owner: CanvasExtensionOwner) => CanvasToolMetadataResult;
    /** Open persisted instances, read once when a conversation runtime is first used. */
    deleteGeneratedRecords?: (owner: CanvasExtensionOwner) => void;
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
    startup?: AbortController;
}

/** One lazy canvas runtime per conversation and extension, independent of providers. */
export class CanvasExtensionHostRegistry {
    private readonly entries = new Map<string, Entry>();
    private readonly declarationCache = new Map<string, { contentHash: string; declarations: CanvasDeclaration[] }>();
    private readonly publications = new Set<{ owner: CanvasExtensionOwner; controller: AbortController; done: Promise<void> }>();
    private readonly removingWorkspaces = new Set<string>();
    private readonly cleanup = new Set<Promise<void>>();
    private readonly deletions = new Map<string, Promise<void>>();
    private disposed = false;
    private wiping = false;
    private epoch = 0;
    private readonly ownerEpochs = new Map<string, number>();
    private disposePromise?: Promise<void>;
    private readonly idleTtlMs: number;

    constructor(private readonly options: CanvasExtensionRegistryOptions) {
        const value = Number(process.env.COC_CANVAS_EXT_IDLE_TTL_MS ?? 600_000);
        this.idleTtlMs = Number.isFinite(value) && value >= 0 && value <= 2_147_483_647 ? value : 600_000;
    }

    /** Publication checks this lease after every await; lifecycle events revoke late results. */
    publicationGuard(owner: CanvasExtensionOwner): () => void {
        this.assertEnabled();
        const key = JSON.stringify([owner.workspaceId, owner.processId]);
        const epoch = this.epoch;
        const ownerEpoch = this.ownerEpochs.get(key) ?? 0;
        return () => {
            this.assertEnabled();
            if (this.removingWorkspaces.has(owner.workspaceId)) throw new Error('Canvas workspace is being removed');
            if (epoch !== this.epoch || ownerEpoch !== (this.ownerEpochs.get(key) ?? 0)) {
                throw new Error('Canvas publication was revoked');
            }
        };
    }

    /** Track staging/syntax/startup as owner work so disable/delete/shutdown cancel and drain it too. */
    runPublication<T>(owner: CanvasExtensionOwner, requestSignal: AbortSignal | undefined,
        action: (signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> {
        const check = this.publicationGuard(owner);
        const controller = new AbortController();
        const abort = () => controller.abort(requestSignal?.reason);
        requestSignal?.addEventListener('abort', abort, { once: true });
        if (requestSignal?.aborted) abort();
        const pending = { owner: { ...owner }, controller, done: Promise.resolve() };
        this.publications.add(pending);
        const result = Promise.resolve().then(() => action(controller.signal, check)).finally(() => {
            requestSignal?.removeEventListener('abort', abort);
            this.publications.delete(pending);
        });
        pending.done = this.track(result.then(() => {}, () => {}));
        return result;
    }

    async declarations(owner: CanvasExtensionOwner, extension: DiscoveredCanvasExtension) {
        await this.assertOwner(owner);
        const cached = this.declarationCache.get(extension.extensionPath);
        if (cached?.contentHash === extension.contentHash) return structuredClone(cached.declarations);
        return this.run(owner, extension, host => Promise.resolve(structuredClone(host.declarations)));
    }

    /** Explicit reload bypasses discovery hashes, including changes to local imports. */
    async reset(owner: CanvasExtensionOwner, extension: DiscoveredCanvasExtension): Promise<void> {
        await this.assertOwner(owner);
        this.declarationCache.delete(extension.extensionPath);
        const entry = this.entries.get(JSON.stringify([owner.workspaceId, owner.processId, extension.extensionKey]));
        if (entry) {
            this.declarationCache.delete(entry.extension.extensionPath);
            await this.retire(entry);
        }
        await this.assertOwner(owner);
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
        // Do not wait behind an action whose script must be cancelled by this close.
        const entry = this.entries.get(JSON.stringify([owner.workspaceId, owner.processId, extension.extensionKey]));
        if (entry?.instances.has(instanceId)) entry.host?.cancelScripts();
        return this.run(owner, extension, async (host, entry) => {
            await host.close(this.instance(entry, instanceId));
            this.assertActive(entry);
            entry.instances.delete(instanceId);
        });
    }

    /** Called synchronously on store events, revoking queued and starting work immediately. */
    stopConversation(owner: CanvasExtensionOwner, deleted = false): Promise<void> {
        const key = JSON.stringify([owner.workspaceId, owner.processId]);
        this.ownerEpochs.set(key, (this.ownerEpochs.get(key) ?? 0) + 1);
        const pending = this.deletions.get(key);
        if (pending) return pending;
        const publications = [...this.publications].filter(pending => pending.owner.workspaceId === owner.workspaceId && pending.owner.processId === owner.processId);
        for (const pending of publications) pending.controller.abort(new Error('Canvas owner retired'));
        const stops = [...this.entries.values()]
            .filter(entry => entry.owner.workspaceId === owner.workspaceId && entry.owner.processId === owner.processId)
            .map(entry => this.retire(entry));
        const cleanup = this.track((async () => {
            await Promise.all([...stops, ...publications.map(pending => pending.done)]);
            if (deleted) {
                this.options.deleteGeneratedRecords?.(owner);
                const state = sessionWorkspacePath(this.options.dataDir, owner);
                assertManagedPath(this.options.dataDir, state);
                await fs.rm(state, { recursive: true, force: true });
                removeManagedPath(this.options.dataDir, generatedOwnerRoot(this.options.dataDir, owner));
            }
        })());
        if (deleted) {
            // Store events and explicit callers can stop the same owner concurrently.
            this.deletions.set(key, cleanup);
            const settled = () => { this.deletions.delete(key); };
            void cleanup.then(settled, settled);
        }
        return cleanup;
    }

    /** Revoke starts before unregistering, and stop children before removing their source/state. */
    async removeWorkspace(workspaceId: string, remove: () => Promise<boolean>): Promise<boolean> {
        if (this.removingWorkspaces.has(workspaceId)) throw new Error('Workspace removal is already pending');
        this.removingWorkspaces.add(workspaceId);
        try {
            const owners = new Map([...this.entries.values()].filter(entry => entry.owner.workspaceId === workspaceId)
                .map(entry => [entry.owner.processId, entry.owner]));
            for (const owner of await listSessionWorkspaceOwners(this.options.dataDir)) {
                if (owner.workspaceId === workspaceId) owners.set(owner.processId, owner);
            }
            await Promise.all([...owners.values()].map(owner => this.stopConversation(owner)));
            const removed = await remove();
            if (removed) await Promise.all([...owners.values()].map(owner => this.stopConversation(owner, true)));
            return removed;
        } finally { this.removingWorkspaces.delete(workspaceId); }
    }

    onProcessChange(event: Parameters<NonNullable<ProcessStore['onProcessChange']>>[0]): void {
        let cleanup: Promise<void> | undefined;
        if (event.type === 'processes-cleared') {
            // Clear can be workspace-filtered; keep surviving conversations' runtimes intact.
            cleanup = (async () => {
                const owners = new Map([...this.entries.values()].map(entry => [
                    JSON.stringify(entry.owner), entry.owner,
                ]));
                for (const owner of await listSessionWorkspaceOwners(this.options.dataDir)) {
                    owners.set(JSON.stringify(owner), owner);
                }
                await Promise.all([...owners.values()].map(async owner => {
                    const conversation = await this.options.store.getProcess(owner.processId, owner.workspaceId);
                    if (!conversation || conversation.metadata?.workspaceId !== owner.workspaceId) {
                        await this.stopConversation(owner, true);
                    } else if (conversation.archived) await this.stopConversation(owner);
                }));
            })();
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
        this.epoch++;
        this.declarationCache.clear();
        const publications = [...this.publications];
        for (const pending of publications) pending.controller.abort(new Error('Canvas extensions stopped'));
        return this.track(Promise.all([...this.entries.values()].map(entry => this.retire(entry)).concat(publications.map(pending => pending.done))).then(() => {}));
    }

    async prepareDataWipe(): Promise<() => void> {
        if (this.wiping) throw new Error('Canvas data wipe is already pending');
        this.wiping = true;
        try {
            await this.stopAll();
            for (const owner of await listSessionWorkspaceOwners(this.options.dataDir)) await this.stopConversation(owner, true);
            return () => { this.wiping = false; };
        } catch (error) { this.wiping = false; throw error; }
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
                const instances = current.extension.skipSavedInstances ? [] : this.options.loadInstances?.(current.owner, current.extension.extensionKey) ?? [];
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
        entry.startup = new AbortController();
        const host = await (this.options.startHost ?? CanvasExtensionHost.start)({
            config: this.options.config(), extension: entry.extension, signal: entry.startup.signal,
            workspaceId: entry.owner.workspaceId, processId: entry.owner.processId,
            dataDir: this.options.dataDir, log: this.options.log,
            send: prompt => {
                this.assertActive(entry);
                if (!this.options.send) throw new Error('Canvas extension follow-up service is unavailable');
                return this.options.send(entry.owner, entry.extension.extensionKey, prompt);
            },
            runScript: async (request, tools, signal) => {
                this.assertActive(entry);
                await this.assertOwner(entry.owner);
                this.assertActive(entry);
                signal.throwIfAborted();
                const runner = this.options.getOwnerScriptRunner?.();
                if (!runner) throw new Error('Canvas extension tool script runtime is unavailable');
                const result = await runOwnerToolScript({ ...entry.owner, request, tools, runner, signal });
                await this.assertOwner(entry.owner);
                this.assertActive(entry);
                return result;
            },
            listMcpServers: async () => {
                this.assertActive(entry);
                await this.assertOwner(entry.owner);
                this.assertActive(entry);
                if (!this.options.listMcpServers) throw new Error('Canvas extension MCP server list is unavailable');
                return this.options.listMcpServers(entry.owner);
            },
            getToolMetadata: async () => {
                this.assertActive(entry);
                await this.assertOwner(entry.owner);
                this.assertActive(entry);
                if (!this.options.getToolMetadata) throw new Error('Canvas extension tool metadata is unavailable');
                return this.options.getToolMetadata(entry.owner);
            },
            ephemeralQuery: question => {
                this.assertActive(entry);
                if (!this.options.ephemeralQuery) throw new Error('Canvas extension completion service is unavailable');
                return this.options.ephemeralQuery(entry.owner, entry.extension.extensionKey, question);
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
            entry.startup?.abort(new Error('Canvas runtime retired during startup'));
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
        if (this.wiping) throw new Error('Canvas extension data is being wiped');
        if (!this.options.config().canvasExtensions?.enabled) throw new Error('Canvas extensions are disabled');
    }

    private async assertOwner(owner: CanvasExtensionOwner): Promise<void> {
        this.assertEnabled();
        if (this.removingWorkspaces.has(owner.workspaceId)) throw new Error('Canvas workspace is being removed');
        const conversation = await this.options.store.getProcess(owner.processId, owner.workspaceId);
        const workspaces = await this.options.store.getWorkspaces?.();
        this.assertEnabled();
        if (this.removingWorkspaces.has(owner.workspaceId) || (workspaces && !workspaces.some(workspace => workspace.id === owner.workspaceId))) throw new Error('Canvas workspace is unavailable');
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
