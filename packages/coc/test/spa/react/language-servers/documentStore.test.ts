/**
 * Authoritative document buffers on top of the language-server transport.
 *
 * The transport is faked here (a `FakeClient` implementing the small slice of
 * `LanguageServerClient` the store uses), but the store itself is real: version
 * sequencing, `didOpen`/`didChange`/`didSave`/`didClose` ordering, reference
 * counting across views, diagnostics routing, and full-text replay after a
 * host session is replaced.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    LanguageDocumentStore,
    browserDocumentUri,
    readSyncOptions,
    type LspDiagnostic,
} from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import type {
    LanguageServerAttachedInfo,
    LanguageServerAttachment,
    LanguageServerClient,
    LanguageServerSessionStateView,
    LanguageServerUnavailableInfo,
} from '../../../../src/server/spa/client/react/features/language-servers/languageServerClient';

interface SentNotification {
    method: string;
    params: Record<string, unknown>;
}

/** One host attachment, shared by every view of the same path. */
class FakeAttachment {
    readonly notifications: SentNotification[] = [];
    readonly requests: { method: string; params: unknown }[] = [];
    refCount = 0;
    released = false;

    info: LanguageServerAttachedInfo | null = null;
    unavailable: LanguageServerUnavailableInfo | null = null;

    private readonly attached = new Set<(info: LanguageServerAttachedInfo) => void>();
    private readonly detached = new Set<(reason: string) => void>();
    private readonly unavailableListeners = new Set<(info: LanguageServerUnavailableInfo) => void>();
    private readonly notificationListeners = new Set<(method: string, params: unknown) => void>();
    private readonly statusListeners = new Set<(state: LanguageServerSessionStateView) => void>();

    constructor(readonly path: string) {}

    handle(): LanguageServerAttachment {
        this.refCount += 1;
        const self = this;
        let live = true;
        return {
            path: this.path,
            getInfo: () => self.info,
            getUnavailable: () => self.unavailable,
            onAttached: (listener) => add(self.attached, listener),
            onDetached: (listener) => add(self.detached, listener),
            onUnavailable: (listener) => add(self.unavailableListeners, listener),
            onNotification: (listener) => add(self.notificationListeners, listener),
            onStatus: (listener) => add(self.statusListeners, listener),
            sendRequest: async <T,>(method: string, params?: unknown) => {
                self.requests.push({ method, params });
                return undefined as T;
            },
            sendNotification: (method: string, params?: unknown) => {
                if (!self.info) {
                    return; // The real client drops notifications while detached.
                }
                self.notifications.push({ method, params: (params ?? {}) as Record<string, unknown> });
            },
            release: () => {
                if (!live) {
                    return;
                }
                live = false;
                self.refCount -= 1;
                if (self.refCount === 0) {
                    self.released = true;
                }
            },
        };
    }

    /** The host reports a live session; this is the replay signal. */
    attach(overrides: Partial<LanguageServerAttachedInfo> = {}): void {
        const info: LanguageServerAttachedInfo = {
            attachmentId: `att-${this.path}`,
            sessionKey: 'session-key',
            documentUri: browserDocumentUri('ws-1', this.path),
            languageId: 'typescript',
            definitionId: 'typescript',
            displayName: 'TypeScript',
            state: readyState(),
            ...overrides,
        };
        this.info = info;
        this.unavailable = null;
        for (const listener of [...this.attached]) {
            listener(info);
        }
    }

    detach(reason = 'config-changed'): void {
        this.info = null;
        for (const listener of [...this.detached]) {
            listener(reason);
        }
    }

    reportUnavailable(reason: string, detail: string): void {
        this.info = null;
        this.unavailable = { reason, detail };
        for (const listener of [...this.unavailableListeners]) {
            listener(this.unavailable);
        }
    }

    notify(method: string, params: unknown): void {
        for (const listener of [...this.notificationListeners]) {
            listener(method, params);
        }
    }

    status(state: LanguageServerSessionStateView): void {
        for (const listener of [...this.statusListeners]) {
            listener(state);
        }
    }

    methods(): string[] {
        return this.notifications.map((entry) => entry.method);
    }

    lastOf(method: string): Record<string, unknown> | undefined {
        return [...this.notifications].reverse().find((entry) => entry.method === method)?.params;
    }
}

class FakeClient {
    readonly attachments = new Map<string, FakeAttachment>();

    attach(path: string): LanguageServerAttachment {
        let attachment = this.attachments.get(path);
        if (!attachment) {
            attachment = new FakeAttachment(path);
            this.attachments.set(path, attachment);
        }
        return attachment.handle();
    }

    get(path: string): FakeAttachment {
        const attachment = this.attachments.get(path);
        if (!attachment) {
            throw new Error(`No attachment for ${path}`);
        }
        return attachment;
    }

    asClient(): LanguageServerClient {
        return this as unknown as LanguageServerClient;
    }
}

function add<T>(set: Set<T>, listener: T): () => void {
    set.add(listener);
    return () => {
        set.delete(listener);
    };
}

function readyState(capabilities: Record<string, unknown> = { textDocumentSync: 1 }): LanguageServerSessionStateView {
    return {
        status: 'ready',
        definitionId: 'typescript',
        displayName: 'TypeScript',
        capabilities,
    };
}

function diagnostic(message: string): LspDiagnostic {
    return { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message };
}

describe('readSyncOptions', () => {
    it('reads the shorthand number form', () => {
        expect(readSyncOptions(readyState({ textDocumentSync: 2 }))).toEqual({
            change: 2,
            includeTextOnSave: false,
            openClose: true,
        });
    });

    it('reads the options-object form including save text', () => {
        const state = readyState({ textDocumentSync: { openClose: true, change: 2, save: { includeText: true } } });
        expect(readSyncOptions(state)).toEqual({ change: 2, includeTextOnSave: true, openClose: true });
    });

    it('falls back to full sync when the server advertises nothing usable', () => {
        expect(readSyncOptions(readyState({}))).toEqual({ change: 1, includeTextOnSave: false, openClose: true });
        expect(readSyncOptions(undefined)).toEqual({ change: 1, includeTextOnSave: false, openClose: true });
    });
});

describe('LanguageDocumentStore', () => {
    let client: FakeClient;
    let store: LanguageDocumentStore;

    beforeEach(() => {
        client = new FakeClient();
        store = new LanguageDocumentStore({ workspaceId: 'ws-1', client: client.asClient() });
    });

    describe('open and synchronize', () => {
        it('sends didOpen with the buffer once the host attaches', () => {
            const view = store.open({ path: 'src/a.ts', text: 'const a = 1;\n' });
            const attachment = client.get('src/a.ts');
            expect(attachment.notifications).toHaveLength(0);
            expect(view.getStatus()).toBe('detached');

            attachment.attach();

            expect(attachment.methods()).toEqual(['textDocument/didOpen']);
            expect(attachment.lastOf('textDocument/didOpen')).toEqual({
                textDocument: {
                    uri: 'coc-file://ws-1/src/a.ts',
                    languageId: 'typescript',
                    version: 1,
                    text: 'const a = 1;\n',
                },
            });
            expect(view.getStatus()).toBe('ready');
            expect(view.isReady()).toBe(true);
        });

        it('encodes the document URI the way the host bridge does', () => {
            store.open({ path: 'src/nested dir/héllo.ts', text: '' });
            client.get('src/nested dir/héllo.ts').attach();
            expect(client.get('src/nested dir/héllo.ts').lastOf('textDocument/didOpen')).toMatchObject({
                textDocument: { uri: browserDocumentUri('ws-1', 'src/nested dir/héllo.ts') },
            });
            expect(browserDocumentUri('ws-1', 'src/nested dir/héllo.ts')).toBe(
                'coc-file://ws-1/src/nested%20dir/h%C3%A9llo.ts',
            );
        });

        it('uses the fallback language id when the host reports none', () => {
            store.open({ path: 'a.txt', text: 'hi', fallbackLanguageId: 'plaintext' });
            client.get('a.txt').attach({ languageId: '' });
            expect(client.get('a.txt').lastOf('textDocument/didOpen')).toMatchObject({
                textDocument: { languageId: 'plaintext' },
            });
        });

        it('opens immediately when the attachment is already live', () => {
            const first = store.open({ path: 'src/a.ts', text: 'one' });
            client.get('src/a.ts').attach();
            first.close();
            // The fake keeps `info` set, standing in for a session that is still
            // up because another document holds it.
            const second = store.open({ path: 'src/a.ts', text: 'two' });
            expect(second.getStatus()).toBe('ready');
        });
    });

    describe('edits and versions', () => {
        it('increments the version on every change and sends full text by default', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            attachment.attach();

            view.update('ab');
            view.update('abc');

            expect(view.getVersion()).toBe(3);
            expect(view.isDirty()).toBe(true);
            const changes = attachment.notifications.filter((n) => n.method === 'textDocument/didChange');
            expect(changes).toHaveLength(2);
            expect(changes[1].params).toEqual({
                textDocument: { uri: 'coc-file://ws-1/a.ts', version: 3 },
                contentChanges: [{ text: 'abc' }],
            });
        });

        it('forwards ranged changes when the server negotiated incremental sync', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            attachment.attach({ state: readyState({ textDocumentSync: 2 }) });

            const range = { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } };
            view.update('ab', [{ range, rangeLength: 0, text: 'b' }]);

            expect(attachment.lastOf('textDocument/didChange')).toEqual({
                textDocument: { uri: 'coc-file://ws-1/a.ts', version: 2 },
                contentChanges: [{ range, rangeLength: 0, text: 'b' }],
            });
        });

        it('falls back to full text when the server only supports full sync', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            attachment.attach({ state: readyState({ textDocumentSync: 1 }) });

            view.update('ab', [
                { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, text: 'b' },
            ]);

            expect(attachment.lastOf('textDocument/didChange')).toMatchObject({
                contentChanges: [{ text: 'ab' }],
            });
        });

        it('ignores an update that does not change the text', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            client.get('a.ts').attach();
            view.update('a');
            expect(view.getVersion()).toBe(1);
            expect(client.get('a.ts').methods()).toEqual(['textDocument/didOpen']);
        });

        it('buffers edits made while detached and replays the result, not the edits', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            attachment.attach();
            attachment.detach('crashed');

            view.update('ab');
            view.update('abc');
            expect(attachment.methods()).toEqual(['textDocument/didOpen']);

            attachment.attach();

            expect(attachment.methods()).toEqual(['textDocument/didOpen', 'textDocument/didOpen']);
            const replay = attachment.lastOf('textDocument/didOpen') as { textDocument: Record<string, unknown> };
            expect(replay.textDocument.text).toBe('abc');
            // Versions keep climbing across the reconnect so a late reply from
            // the dead session can still be told apart.
            expect(replay.textDocument.version).toBe(4);
            expect(view.getVersion()).toBe(4);
        });
    });

    describe('saving and disk changes', () => {
        it('sends didSave only after the caller reports a successful write', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            attachment.attach();
            view.update('ab');
            expect(attachment.methods()).not.toContain('textDocument/didSave');

            view.markSaved();

            expect(attachment.lastOf('textDocument/didSave')).toEqual({
                textDocument: { uri: 'coc-file://ws-1/a.ts' },
            });
            expect(view.isDirty()).toBe(false);
        });

        it('includes the text on save when the server asked for it', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            attachment.attach({ state: readyState({ textDocumentSync: { change: 1, save: { includeText: true } } }) });
            view.update('ab');
            view.markSaved();
            expect(attachment.lastOf('textDocument/didSave')).toEqual({
                textDocument: { uri: 'coc-file://ws-1/a.ts' },
                text: 'ab',
            });
        });

        it('refuses to let disk text overwrite a dirty buffer', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            client.get('a.ts').attach();
            view.update('user edit');

            expect(view.setDiskText('from disk')).toBe(false);
            expect(view.getText()).toBe('user edit');
        });

        it('accepts disk text into a clean buffer and keeps it clean', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            attachment.attach();

            expect(view.setDiskText('from disk')).toBe(true);
            expect(view.getText()).toBe('from disk');
            expect(view.isDirty()).toBe(false);
            expect(attachment.lastOf('textDocument/didChange')).toMatchObject({
                contentChanges: [{ text: 'from disk' }],
            });
        });
    });

    describe('views and reference counting', () => {
        it('shares one buffer between two views of the same file', () => {
            const explorer = store.open({ path: 'a.ts', text: 'a' });
            const panel = store.open({ path: 'a.ts', text: 'stale text from disk' });
            client.get('a.ts').attach();

            explorer.update('edited');

            expect(panel.getText()).toBe('edited');
            expect(panel.getVersion()).toBe(explorer.getVersion());
            expect(store.documentCount).toBe(1);
        });

        it('keeps the document open while another view still holds it', () => {
            const explorer = store.open({ path: 'a.ts', text: 'a' });
            const panel = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            attachment.attach();

            explorer.close();

            expect(attachment.methods()).not.toContain('textDocument/didClose');
            expect(attachment.released).toBe(false);
            expect(panel.isReady()).toBe(true);

            panel.close();

            expect(attachment.methods()).toContain('textDocument/didClose');
            expect(attachment.released).toBe(true);
            expect(store.documentCount).toBe(0);
        });

        it('closes once even when a view is closed twice', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            attachment.attach();
            view.close();
            view.close();
            expect(attachment.methods().filter((m) => m === 'textDocument/didClose')).toHaveLength(1);
        });

        it('stops sending for a closed document', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            attachment.attach();
            view.close();
            const after = attachment.notifications.length;

            view.update('later');
            view.markSaved();

            expect(attachment.notifications).toHaveLength(after);
        });
    });

    describe('diagnostics', () => {
        it('routes published diagnostics to the matching document only', () => {
            const a = store.open({ path: 'a.ts', text: 'a' });
            const b = store.open({ path: 'b.ts', text: 'b' });
            client.get('a.ts').attach();
            client.get('b.ts').attach();
            const seen: LspDiagnostic[][] = [];
            a.onDiagnostics((diagnostics) => seen.push(diagnostics));

            // Diagnostics are session-wide, so b's results reach a's listener too.
            client.get('a.ts').notify('textDocument/publishDiagnostics', {
                uri: 'coc-file://ws-1/b.ts',
                diagnostics: [diagnostic('other file')],
            });
            expect(seen).toHaveLength(0);
            expect(a.getDiagnostics()).toEqual([]);

            client.get('a.ts').notify('textDocument/publishDiagnostics', {
                uri: 'coc-file://ws-1/a.ts',
                diagnostics: [diagnostic('mine')],
            });

            expect(seen).toHaveLength(1);
            expect(a.getDiagnostics()).toEqual([diagnostic('mine')]);
            expect(b.getDiagnostics()).toEqual([]);
        });

        it('drops diagnostics for a version the user has already replaced', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            attachment.attach();
            view.update('ab');

            attachment.notify('textDocument/publishDiagnostics', {
                uri: 'coc-file://ws-1/a.ts',
                version: 1,
                diagnostics: [diagnostic('stale')],
            });

            expect(view.getDiagnostics()).toEqual([]);
        });

        it('clears diagnostics when the host session goes away', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            attachment.attach();
            attachment.notify('textDocument/publishDiagnostics', {
                uri: 'coc-file://ws-1/a.ts',
                diagnostics: [diagnostic('boom')],
            });
            expect(view.getDiagnostics()).toHaveLength(1);

            attachment.detach('evicted');

            expect(view.getDiagnostics()).toEqual([]);
            expect(view.getStatus()).toBe('detached');
        });
    });

    describe('status and unavailability', () => {
        it('keeps the buffer usable when the host refuses language support', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            attachment.reportUnavailable('disabled', 'Language support is disabled for this workspace.');

            expect(view.getStatus()).toBe('unavailable');
            expect(view.isReady()).toBe(false);

            view.update('still editable');

            expect(view.getText()).toBe('still editable');
            expect(view.getVersion()).toBe(1);
            expect(attachment.notifications).toHaveLength(0);
        });

        it('reports the host session state through onStatus', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            const snapshots: string[] = [];
            view.onStatus((snapshot) => snapshots.push(snapshot.status));

            attachment.attach();
            attachment.status({ status: 'reconnecting', definitionId: 'typescript', displayName: 'TypeScript' });

            expect(snapshots).toContain('ready');
            expect(view.getSnapshot().state?.status).toBe('reconnecting');
            expect(view.getSnapshot().displayName).toBe('TypeScript');
        });

        it('fires onSynchronized after each replay', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            const attachment = client.get('a.ts');
            const synchronized = vi.fn();
            view.onSynchronized(synchronized);

            attachment.attach();
            attachment.detach('crashed');
            attachment.attach();

            expect(synchronized).toHaveBeenCalledTimes(2);
        });
    });

    describe('requests', () => {
        it('fills in the document URI for position requests', async () => {
            const view = store.open({ path: 'src/a.ts', text: 'a' });
            const attachment = client.get('src/a.ts');
            attachment.attach();

            await view.sendRequest('textDocument/hover', view.documentParams({ position: { line: 2, character: 4 } }));

            expect(attachment.requests).toEqual([
                {
                    method: 'textDocument/hover',
                    params: { position: { line: 2, character: 4 }, textDocument: { uri: 'coc-file://ws-1/src/a.ts' } },
                },
            ]);
        });
    });

    describe('store lifecycle', () => {
        it('normalizes paths so two spellings share one document', () => {
            store.open({ path: 'src/a.ts', text: 'a' });
            store.open({ path: '/src/a.ts', text: 'a' });
            expect(store.documentCount).toBe(1);
        });

        it('peeks without taking a reference', () => {
            const view = store.open({ path: 'a.ts', text: 'a' });
            expect(store.peek('a.ts')?.text).toBe('a');
            view.close();
            expect(store.peek('a.ts')).toBeNull();
        });

        it('closes every document on dispose', () => {
            store.open({ path: 'a.ts', text: 'a' });
            store.open({ path: 'b.ts', text: 'b' });
            client.get('a.ts').attach();
            client.get('b.ts').attach();

            store.dispose();

            expect(client.get('a.ts').methods()).toContain('textDocument/didClose');
            expect(client.get('a.ts').released).toBe(true);
            expect(client.get('b.ts').released).toBe(true);
            expect(store.documentCount).toBe(0);
            expect(() => store.open({ path: 'a.ts', text: 'a' })).toThrow(/disposed/);
        });
    });
});
