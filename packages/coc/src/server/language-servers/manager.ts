/**
 * Owns every live language-server session on this host.
 *
 * A session is keyed on the workspace, definition, resolved project root, and
 * normally the browser editing session. Definitions may opt into workspace
 * scope when an expensive server should be shared across editing sessions.
 *
 * The manager stays language-neutral: it resolves which definition serves a
 * file through the shared selection rules and hands the rest to
 * `LanguageServerSession`.
 */

import { LanguageServerSession } from './session';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { LanguageServerSessionOptions, LanguageServerSessionState } from './session';
import { onLanguageServerConfigChanged, resolveLanguageServerDefinitions } from './repository';
import { prepareDefinitionForRoot, resolveDefinitionRoot } from './adapters';
import type { PrepareDefinitionDeps } from './adapters';
import { resolveLanguageId, selectDefinitionForFile } from './selection';
import type { JsonValue, LanguageServerDefinition } from './types';

/** Why a document has no language server. Each maps to a concise editor status. */
export type LanguageServerUnavailableReason = 'disabled' | 'no-definition' | 'capacity';

export interface LanguageServerHandle {
    /** Stable identity of the underlying session, useful for status routing. */
    key: string;
    session: LanguageServerSession;
    definition: LanguageServerDefinition;
    /** LSP language id for this document, from the definition's mapping. */
    languageId: string;
    /** Project root the process was started in. */
    rootPath: string;
    /** Detaches this document. The process stops once nothing references it. */
    release: () => void;
}

export type AcquireResult =
    | { ok: true; handle: LanguageServerHandle }
    | { ok: false; reason: LanguageServerUnavailableReason; detail: string };

export interface AcquireRequest {
    workspaceId: string;
    /** Absolute path of the workspace on this host. */
    workspaceRoot: string;
    /** Identifies one browser editing session; isolates document state. */
    editingSessionId: string;
    /** Workspace-relative path of the document. */
    relativePath: string;
}

/** Reported when the manager closes a session out from under its documents. */
export interface SessionClosedEvent {
    key: string;
    workspaceId: string;
    editingSessionId: string;
    definitionId: string;
    reason: 'config-changed' | 'evicted' | 'workspace-removed' | 'shutdown';
}

export interface LanguageServerManagerOptions {
    /** Resolved CoC data directory; per-workspace config lives beneath it. */
    dataDir: string;
    /** Bound on live sessions across all workspaces. Defaults to 12. */
    maxSessions?: number;
    /** Passed through to every session. */
    idleTimeoutMs?: number;
    startTimeoutMs?: number;
    /** Grace a stopping process gets before it is killed outright. */
    killGraceMs?: number;
    requestTimeoutMs?: number;
    maxMessageBytes?: number;
    clientCapabilities?: JsonValue;
    onError?: (error: Error) => void;
    /** Injectable for tests: existence check used to find a project root. */
    exists?: (candidate: string) => boolean;
    /** Injectable for tests: builds the session for a resolved definition. */
    createSession?: (options: LanguageServerSessionOptions) => LanguageServerSession;
    /**
     * Injectable for tests: filesystem seams the per-language adapters use to
     * resolve an executable and a toolchain for a project root.
     */
    prepareDeps?: PrepareDefinitionDeps;
}

const DEFAULT_MAX_SESSIONS = 12;

interface SessionEntry {
    key: string;
    publicId: string;
    workspaceId: string;
    editingSessionIds: Set<string>;
    releasesByEditingSession: Map<string, Set<() => void>>;
    definition: LanguageServerDefinition;
    rootPath: string;
    rootLabel: string;
    session: LanguageServerSession;
    references: number;
    lastUsedAt: number;
    /** Definition snapshot used to detect a configuration change. */
    fingerprint: string;
}

export class LanguageServerManager {
    private readonly options: LanguageServerManagerOptions;
    private readonly entries = new Map<string, SessionEntry>();
    private readonly closedListeners = new Set<(event: SessionClosedEvent) => void>();
    private readonly unsubscribeConfig: () => void;
    /** Closes nobody awaits — evictions and config reloads — so `dispose` can. */
    private readonly pendingCloses = new Set<Promise<unknown>>();
    private clock = 0;
    private disposed = false;

    constructor(options: LanguageServerManagerOptions) {
        this.options = options;
        this.unsubscribeConfig = onLanguageServerConfigChanged((event) => {
            this.trackClose(this.handleConfigChanged(event.workspaceId));
        });
    }

    /**
     * Finds or starts the session that serves a document and registers one
     * reference for it. The caller must invoke `release` when its last view of
     * the document closes.
     */
    acquire(request: AcquireRequest): AcquireResult {
        if (this.disposed) {
            return { ok: false, reason: 'disabled', detail: 'Language support is shut down.' };
        }
        const startable = resolveLanguageServerDefinitions(this.options.dataDir, request.workspaceId);
        if (startable.length === 0) {
            return { ok: false, reason: 'disabled', detail: 'Language support is off for this workspace.' };
        }
        const definition = selectDefinitionForFile(startable, request.relativePath);
        if (!definition) {
            return { ok: false, reason: 'no-definition', detail: 'No language server serves this file.' };
        }
        const rootPath = resolveDefinitionRoot(
            definition,
            request.workspaceRoot,
            request.relativePath,
            {
                exists: this.options.exists,
                ...this.options.prepareDeps,
            },
        );
        const key = sessionKey(
            request.workspaceId,
            definition.sessionScope === 'workspace' ? undefined : request.editingSessionId,
            definition.id,
            rootPath,
        );
        let entry = this.entries.get(key);
        if (entry && entry.fingerprint !== fingerprintOf(definition)) {
            // Configuration moved on while this session was alive.
            this.trackClose(this.closeEntry(entry, 'config-changed'));
            entry = undefined;
        }
        if (!entry) {
            if (!this.makeRoom(request.workspaceId, definition)) {
                return {
                    ok: false,
                    reason: 'capacity',
                    detail: 'Too many language servers are already running.',
                };
            }
            entry = this.createEntry(key, request, definition, rootPath);
        }
        return { ok: true, handle: this.attach(entry, request.relativePath, request.editingSessionId) };
    }

    /** Current state of every live session, newest use first. */
    listStates(workspaceId?: string): (LanguageServerSessionState & {
        sessionId: string;
        workspaceId: string;
        projectRoot: string;
    })[] {
        return [...this.entries.values()]
            .filter((entry) => workspaceId === undefined || entry.workspaceId === workspaceId)
            .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
            .map((entry) => ({
                ...entry.session.getState(),
                sessionId: entry.publicId,
                workspaceId: entry.workspaceId,
                projectRoot: entry.rootLabel,
            }));
    }

    async retry(workspaceId: string, sessionId: string): Promise<boolean> {
        const entry = [...this.entries.values()].find(
            candidate => candidate.publicId === sessionId && candidate.workspaceId === workspaceId,
        );
        if (!entry) {
            return false;
        }
        try {
            await entry.session.restart();
        } catch (error) {
            if (!['unavailable', 'failed', 'timeout'].includes(entry.session.status)) {
                throw error;
            }
        }
        return true;
    }

    getSession(key: string): LanguageServerSession | undefined {
        return this.entries.get(key)?.session;
    }

    get size(): number {
        return this.entries.size;
    }

    /**
     * Subscribe to sessions the manager closed on its own — a configuration
     * change, an eviction, or shutdown. The document layer replays its buffers
     * into a fresh session when it sees one.
     */
    onSessionClosed(listener: (event: SessionClosedEvent) => void): () => void {
        this.closedListeners.add(listener);
        return () => {
            this.closedListeners.delete(listener);
        };
    }

    /** Drops every session belonging to a workspace, e.g. when it is removed. */
    async disposeWorkspace(workspaceId: string): Promise<void> {
        const doomed = [...this.entries.values()].filter((entry) => entry.workspaceId === workspaceId);
        await Promise.all(doomed.map((entry) => this.closeEntry(entry, 'workspace-removed')));
    }

    /** Drops every session belonging to one browser editing session. */
    async disposeEditingSession(workspaceId: string, editingSessionId: string): Promise<void> {
        const doomed: SessionEntry[] = [];
        for (const entry of this.entries.values()) {
            if (entry.workspaceId !== workspaceId || !entry.editingSessionIds.has(editingSessionId)) {
                continue;
            }
            for (const release of [...(entry.releasesByEditingSession.get(editingSessionId) ?? [])]) {
                release();
            }
            if (entry.definition.sessionScope === 'workspace') {
                entry.editingSessionIds.delete(editingSessionId);
            } else {
                doomed.push(entry);
            }
        }
        await Promise.all(doomed.map((entry) => this.closeEntry(entry, 'workspace-removed')));
    }

    /** Releases every process, timer, and listener. Used on CoC shutdown. */
    async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.unsubscribeConfig();
        const doomed = [...this.entries.values()];
        await Promise.all(doomed.map((entry) => this.closeEntry(entry, 'shutdown')));
        // An evicted session left the map before anyone awaited its teardown.
        // Shutdown is the last chance to wait for it, and callers take
        // `dispose` resolving to mean no language server process is left.
        await Promise.allSettled([...this.pendingCloses]);
        this.closedListeners.clear();
    }

    private createEntry(
        key: string,
        request: AcquireRequest,
        definition: LanguageServerDefinition,
        rootPath: string,
    ): SessionEntry {
        const prepared = prepareDefinitionForRoot(definition, rootPath, {
            exists: this.options.exists,
            ...this.options.prepareDeps,
        });
        const sessionOptions: LanguageServerSessionOptions = {
            definition: prepared.definition,
            rootPath,
            runtimeLabel: prepared.runtimeLabel,
            commandLabel: prepared.commandLabel,
            unavailableDetail: prepared.notes?.join(' '),
            recoveryCommand: prepared.recoveryCommand,
            prepareForStart: () => {
                const next = prepareDefinitionForRoot(definition, rootPath, {
                    exists: this.options.exists,
                    ...this.options.prepareDeps,
                });
                return {
                    definition: next.definition,
                    runtimeLabel: next.runtimeLabel,
                    commandLabel: next.commandLabel,
                    unavailableDetail: next.notes?.join(' '),
                    recoveryCommand: next.recoveryCommand,
                };
            },
            clientCapabilities: this.options.clientCapabilities,
            startTimeoutMs: this.options.startTimeoutMs,
            requestTimeoutMs: definition.requestTimeoutMs ?? this.options.requestTimeoutMs,
            maxMessageBytes: this.options.maxMessageBytes,
            idleTimeoutMs: definition.idleTimeoutMs ?? this.options.idleTimeoutMs,
            killGraceMs: this.options.killGraceMs,
            onError: this.options.onError,
        };
        const session = this.options.createSession
            ? this.options.createSession(sessionOptions)
            : new LanguageServerSession(sessionOptions);
        const entry: SessionEntry = {
            key,
            publicId: randomUUID(),
            workspaceId: request.workspaceId,
            editingSessionIds: new Set(),
            releasesByEditingSession: new Map(),
            definition,
            rootPath,
            rootLabel: relativeRootLabel(request.workspaceRoot, rootPath),
            session,
            references: 0,
            lastUsedAt: ++this.clock,
            fingerprint: fingerprintOf(definition),
        };
        this.entries.set(key, entry);
        return entry;
    }

    private attach(entry: SessionEntry, relativePath: string, editingSessionId: string): LanguageServerHandle {
        entry.references++;
        entry.lastUsedAt = ++this.clock;
        entry.editingSessionIds.add(editingSessionId);
        const releaseSession = entry.session.attach();
        let released = false;
        const release = (): void => {
            if (released) {
                return;
            }
            released = true;
            entry.references = Math.max(0, entry.references - 1);
            const editingReleases = entry.releasesByEditingSession.get(editingSessionId);
            editingReleases?.delete(release);
            if (editingReleases?.size === 0) {
                entry.releasesByEditingSession.delete(editingSessionId);
            }
            releaseSession();
        };
        let editingReleases = entry.releasesByEditingSession.get(editingSessionId);
        if (!editingReleases) {
            editingReleases = new Set();
            entry.releasesByEditingSession.set(editingSessionId, editingReleases);
        }
        editingReleases.add(release);
        return {
            key: entry.key,
            session: entry.session,
            definition: entry.definition,
            languageId: resolveLanguageId(entry.definition, relativePath),
            rootPath: entry.rootPath,
            release,
        };
    }

    /**
     * Makes space for one more session. Evicts the least recently used
     * unreferenced session; returns false when every session is still in use,
     * because dropping a session a document depends on would lose its buffer.
     */
    private makeRoom(workspaceId: string, definition: LanguageServerDefinition): boolean {
        if (definition.maxSessions !== undefined) {
            const matching = [...this.entries.values()].filter(
                entry => entry.workspaceId === workspaceId && entry.definition.id === definition.id,
            );
            if (matching.length >= definition.maxSessions && !this.evictOne(matching)) {
                return false;
            }
        }

        const max = this.options.maxSessions ?? DEFAULT_MAX_SESSIONS;
        return this.entries.size < max || this.evictOne(this.entries.values());
    }

    private evictOne(candidates: Iterable<SessionEntry>): boolean {
        let victim: SessionEntry | undefined;
        for (const entry of candidates) {
            if (entry.references > 0) {
                continue;
            }
            if (!victim || entry.lastUsedAt < victim.lastUsedAt) {
                victim = entry;
            }
        }
        if (!victim) {
            return false;
        }
        this.trackClose(this.closeEntry(victim, 'evicted'));
        return true;
    }

    /**
     * Holds on to a close whose caller cannot await it, so `dispose` can. The
     * settle handler doubles as the rejection handler, keeping a failed close
     * from surfacing as an unhandled rejection.
     */
    private trackClose(closing: Promise<unknown>): void {
        this.pendingCloses.add(closing);
        const settle = (): void => {
            this.pendingCloses.delete(closing);
        };
        closing.then(settle, settle);
    }

    /**
     * Replaces the sessions of a workspace whose definition changed or
     * disappeared. Sessions whose definition is byte-identical keep running, so
     * toggling an unrelated setting does not restart every server.
     */
    private async handleConfigChanged(workspaceId: string): Promise<void> {
        if (this.disposed) {
            return;
        }
        const startable = resolveLanguageServerDefinitions(this.options.dataDir, workspaceId);
        const byId = new Map(startable.map((definition) => [definition.id, definition]));
        const doomed: SessionEntry[] = [];
        for (const entry of this.entries.values()) {
            if (entry.workspaceId !== workspaceId) {
                continue;
            }
            const next = byId.get(entry.definition.id);
            if (!next || fingerprintOf(next) !== entry.fingerprint) {
                doomed.push(entry);
            }
        }
        await Promise.all(doomed.map((entry) => this.closeEntry(entry, 'config-changed')));
    }

    private async closeEntry(entry: SessionEntry, reason: SessionClosedEvent['reason']): Promise<void> {
        if (this.entries.get(entry.key) !== entry) {
            return;
        }
        this.entries.delete(entry.key);
        for (const editingSessionId of entry.editingSessionIds.keys()) {
            this.emitClosed({
                key: entry.key,
                workspaceId: entry.workspaceId,
                editingSessionId,
                definitionId: entry.definition.id,
                reason,
            });
        }
        try {
            await entry.session.dispose();
        } catch (error) {
            this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private emitClosed(event: SessionClosedEvent): void {
        for (const listener of this.closedListeners) {
            try {
                listener(event);
            } catch {
                // A status listener must never take the manager down.
            }
        }
    }
}

function relativeRootLabel(workspaceRoot: string, rootPath: string): string {
    const relative = path.relative(path.resolve(workspaceRoot), path.resolve(rootPath));
    if (relative === '') {
        return '.';
    }
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
        return path.basename(rootPath);
    }
    return relative.split(path.sep).join('/');
}

/**
 * Root path is part of the key: a monorepo can hold two projects served by the
 * same definition, and each needs its own process.
 */
function sessionKey(
    workspaceId: string,
    editingSessionId: string | undefined,
    definitionId: string,
    rootPath: string,
): string {
    return [workspaceId, editingSessionId ?? '', definitionId, rootPath].map(encodeURIComponent).join('|');
}

/** Everything that would change how the process is started or configured. */
function fingerprintOf(definition: LanguageServerDefinition): string {
    return JSON.stringify([
        definition.command,
        definition.args,
        definition.initializationOptions ?? null,
        definition.settings ?? null,
        definition.languageIds,
        definition.extensionLanguageIds ?? null,
        definition.sessionScope ?? null,
        definition.maxSessions ?? null,
        definition.requestTimeoutMs ?? null,
        definition.idleTimeoutMs ?? null,
    ]);
}
