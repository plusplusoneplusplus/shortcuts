/**
 * Monaco providers over a live language document.
 *
 * Real code under test all the way down to the transport: the real document
 * store, the real conversions, and the real registration logic. Monaco itself is
 * a recorder — `FakeMonaco` captures the providers that were registered and lets
 * the test call them the way the editor would, with a model, a position and a
 * cancellation token.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LanguageDocumentStore } from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import {
    capabilityFingerprint,
    registerLanguageProviders,
    supportsFeature,
    type MonacoLike,
    type ProviderCancellationToken,
    type ProviderDisposable,
    type ProviderModel,
} from '../../../../src/server/spa/client/react/features/language-servers/languageProviders';
import { FakeClient, readyState } from './fakeLanguageTransport';

// ============================================================================
// Monaco stand-ins
// ============================================================================

interface Registered {
    kind: string;
    languageId: string;
    provider: Record<string, unknown>;
    disposed: boolean;
}

class FakeMonaco {
    readonly registered: Registered[] = [];

    readonly languages = {
        registerHoverProvider: (languageId: string, provider: Record<string, unknown>) =>
            this.record('hover', languageId, provider),
        registerDefinitionProvider: (languageId: string, provider: Record<string, unknown>) =>
            this.record('definition', languageId, provider),
        registerReferenceProvider: (languageId: string, provider: Record<string, unknown>) =>
            this.record('references', languageId, provider),
        registerCompletionItemProvider: (languageId: string, provider: Record<string, unknown>) =>
            this.record('completion', languageId, provider),
        registerSignatureHelpProvider: (languageId: string, provider: Record<string, unknown>) =>
            this.record('signatureHelp', languageId, provider),
    };

    readonly Uri = { parse: (value: string) => ({ toString: () => value, parsed: true }) };

    private record(kind: string, languageId: string, provider: Record<string, unknown>): ProviderDisposable {
        const entry: Registered = { kind, languageId, provider, disposed: false };
        this.registered.push(entry);
        return {
            dispose: () => {
                entry.disposed = true;
            },
        };
    }

    live(): string[] {
        return this.registered.filter((entry) => !entry.disposed).map((entry) => entry.kind);
    }

    /** The most recent live provider of a kind, as the editor would see it. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider(kind: string): any {
        const entry = [...this.registered].reverse().find((item) => item.kind === kind && !item.disposed);
        if (!entry) {
            throw new Error(`No live ${kind} provider`);
        }
        return entry.provider;
    }

    asMonaco(): MonacoLike {
        return this as unknown as MonacoLike;
    }
}

function model(uri: string): ProviderModel {
    return {
        uri: { toString: () => uri },
        // "cons|" — the word starts at column 1 and the cursor sits after it.
        getWordUntilPosition: () => ({ startColumn: 1, endColumn: 5 }),
        getWordAtPosition: () => ({ word: 'Widget', startColumn: 1, endColumn: 7 }),
    };
}

function token(): ProviderCancellationToken {
    return { isCancellationRequested: false, onCancellationRequested: () => undefined };
}

function cancellable(): { token: ProviderCancellationToken; cancel: () => void; disposals: number } {
    const listeners: (() => void)[] = [];
    const state = {
        token: {
            isCancellationRequested: false,
            onCancellationRequested: (listener: () => void) => {
                listeners.push(listener);
                return {
                    dispose: () => {
                        state.disposals += 1;
                    },
                };
            },
        },
        cancel: () => {
            state.token.isCancellationRequested = true;
            for (const listener of listeners) {
                listener();
            }
        },
        disposals: 0,
    };
    return state;
}

const POSITION = { lineNumber: 2, column: 5 };
const LSP_POSITION = { line: 1, character: 4 };

describe('supportsFeature', () => {
    it('accepts both the boolean and the options-object form', () => {
        const state = readyState({ hoverProvider: true, completionProvider: { triggerCharacters: ['.'] } });
        expect(supportsFeature(state, 'hover')).toBe(true);
        expect(supportsFeature(state, 'completion')).toBe(true);
    });

    it('refuses a capability the server left out or turned off', () => {
        const state = readyState({ hoverProvider: false });
        expect(supportsFeature(state, 'hover')).toBe(false);
        expect(supportsFeature(state, 'definition')).toBe(false);
    });

    it('enables everything while no session has reported capabilities', () => {
        expect(supportsFeature(null, 'hover')).toBe(true);
        expect(supportsFeature({ status: 'starting', definitionId: 'ts', displayName: 'TS' }, 'references')).toBe(true);
    });
});

describe('capabilityFingerprint', () => {
    it('ignores status churn that cannot change the registration', () => {
        const capabilities = { hoverProvider: true, completionProvider: { triggerCharacters: ['.'] } };
        const first = { ...readyState(capabilities), restarts: 0 };
        const second = { ...readyState(capabilities), status: 'reconnecting' as const, restarts: 3 };
        expect(capabilityFingerprint(second)).toBe(capabilityFingerprint(first));
    });

    it('changes when a capability or a trigger character changes', () => {
        const base = capabilityFingerprint(readyState({ hoverProvider: true }));
        expect(capabilityFingerprint(readyState({ hoverProvider: false }))).not.toBe(base);
        expect(capabilityFingerprint(readyState({ completionProvider: { triggerCharacters: ['.'] } }))).not.toBe(base);
    });
});

describe('registerLanguageProviders', () => {
    let client: FakeClient;
    let store: LanguageDocumentStore;
    let monaco: FakeMonaco;

    const FULL_CAPABILITIES = {
        textDocumentSync: 1,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        completionProvider: { triggerCharacters: ['.', '"'] },
        signatureHelpProvider: { triggerCharacters: ['(', ','], retriggerCharacters: [')'] },
    };

    function open(path = 'src/a.ts', capabilities: Record<string, unknown> = FULL_CAPABILITIES) {
        const view = store.open({ path, text: 'const a = 1;\n' });
        const attachment = client.get(path);
        attachment.attach({ state: readyState(capabilities) });
        const target = model(view.uri);
        const registration = registerLanguageProviders({
            monaco: monaco.asMonaco(),
            model: target,
            view,
            languageId: 'typescript',
        });
        return { view, attachment, target, registration };
    }

    beforeEach(() => {
        client = new FakeClient();
        store = new LanguageDocumentStore({ workspaceId: 'ws-1', client: client.asClient() });
        monaco = new FakeMonaco();
    });

    it('registers every selected feature under the model language', () => {
        open();
        expect(monaco.live()).toEqual(['hover', 'definition', 'references', 'completion', 'signatureHelp']);
        expect(monaco.registered.every((entry) => entry.languageId === 'typescript')).toBe(true);
    });

    it('registers only the features the server advertises', () => {
        open('src/a.ts', { textDocumentSync: 1, hoverProvider: true, definitionProvider: true });
        expect(monaco.live()).toEqual(['hover', 'definition']);
    });

    it('carries the server trigger characters into the registration', () => {
        open();
        expect(monaco.provider('completion').triggerCharacters).toEqual(['.', '"']);
        expect(monaco.provider('signatureHelp').signatureHelpTriggerCharacters).toEqual(['(', ',']);
        expect(monaco.provider('signatureHelp').signatureHelpRetriggerCharacters).toEqual([')']);
    });

    it('answers a hover out of the document, in LSP coordinates', async () => {
        const { attachment } = open();
        attachment.respond('textDocument/hover', () => ({
            contents: { kind: 'markdown', value: '`const a: number`' },
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
        }));

        const hover = await monaco.provider('hover').provideHover(model('coc-file://ws-1/src/a.ts'), POSITION, token());

        expect(attachment.lastRequest('textDocument/hover')?.params).toEqual({
            textDocument: { uri: 'coc-file://ws-1/src/a.ts' },
            position: LSP_POSITION,
        });
        expect(hover).toEqual({
            contents: [{ value: '`const a: number`' }],
            range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 6 },
        });
    });

    it('ignores a model it was not registered for', async () => {
        const { attachment } = open();
        const other = model('coc-file://ws-1/src/other.ts');

        expect(await monaco.provider('hover').provideHover(other, POSITION, token())).toBeNull();
        expect(await monaco.provider('definition').provideDefinition(other, POSITION, token())).toBeNull();
        expect(await monaco.provider('completion').provideCompletionItems(other, POSITION, {}, token())).toBeNull();
        expect(attachment.requests).toHaveLength(0);
    });

    it('keeps a definition inside this workspace and drops one outside it', async () => {
        const { attachment } = open();
        attachment.respond('textDocument/definition', () => [
            { uri: 'coc-file://ws-1/src/b.ts', range: { start: { line: 3, character: 2 }, end: { line: 3, character: 8 } } },
            { uri: 'coc-file://ws-2/src/b.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
            { uri: 'file:///home/me/node_modules/dep/index.d.ts', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } } },
        ]);

        const links = await monaco.provider('definition').provideDefinition(model('coc-file://ws-1/src/a.ts'), POSITION, token());

        expect(links).toHaveLength(1);
        expect(links[0].uri.toString()).toBe('coc-file://ws-1/src/b.ts');
        expect(links[0].range).toEqual({ startLineNumber: 4, startColumn: 3, endLineNumber: 4, endColumn: 9 });
    });

    it('merges exact and symbol-index definitions and dedupes by file and line', async () => {
        const lookup = vi.fn().mockResolvedValue([
            { path: 'src/exact.cpp', line: 4, column: 12 },
            { path: 'src/candidate.hpp', line: 9, column: 3 },
            { path: 'src/candidate.hpp', line: 9, column: 20 },
        ]);
        const view = store.open({ path: 'src/a.cpp', text: 'Widget value;\n' });
        const attachment = client.get('src/a.cpp');
        attachment.attach({ state: readyState({ definitionProvider: true }) });
        attachment.respond('textDocument/definition', () => [{
            uri: 'coc-file://ws-1/src/exact.cpp',
            range: { start: { line: 3, character: 1 }, end: { line: 3, character: 7 } },
        }]);
        const target = model(view.uri);
        registerLanguageProviders({
            monaco: monaco.asMonaco(),
            model: target,
            view,
            languageId: 'cpp',
            symbolDefinitions: { workspaceId: 'ws-1', lookup },
        });

        const links = await monaco.provider('definition').provideDefinition(target, POSITION, token());

        expect(lookup).toHaveBeenCalledWith('Widget', expect.any(AbortSignal));
        expect(links).toHaveLength(2);
        expect(links[0].uri.toString()).toBe('coc-file://ws-1/src/exact.cpp');
        expect(links[1].uri.toString()).toBe('coc-file://ws-1/src/candidate.hpp#symbol-index-candidate');
    });

    it('answers from the symbol index when the language server is unavailable', async () => {
        const view = store.open({ path: 'src/a.cpp', text: 'Widget value;\n' });
        const attachment = client.get('src/a.cpp');
        attachment.attach({
            state: {
                status: 'unavailable',
                definitionId: 'clangd',
                displayName: 'C / C++ (clangd)',
                capabilities: {},
            },
        });
        const target = model(view.uri);
        registerLanguageProviders({
            monaco: monaco.asMonaco(),
            model: target,
            view,
            languageId: 'cpp',
            symbolDefinitions: {
                workspaceId: 'ws-1',
                lookup: async () => [{ path: 'include/widget.hpp', line: 7, column: 2 }],
            },
        });

        const links = await monaco.provider('definition').provideDefinition(target, POSITION, token());

        expect(links.map((link: { uri: { toString(): string } }) => link.uri.toString()))
            .toEqual(['coc-file://ws-1/include/widget.hpp#symbol-index-candidate']);
        expect(attachment.requests).toHaveLength(0);
    });

    it('asks for references including the declaration', async () => {
        const { attachment } = open();
        attachment.respond('textDocument/references', () => []);

        await monaco.provider('references').provideReferences(model('coc-file://ws-1/src/a.ts'), POSITION, {}, token());

        expect(attachment.lastRequest('textDocument/references')?.params).toEqual({
            textDocument: { uri: 'coc-file://ws-1/src/a.ts' },
            position: LSP_POSITION,
            context: { includeDeclaration: true },
        });
    });

    it('completes against the word range Monaco computed', async () => {
        const { attachment, target } = open();
        attachment.respond('textDocument/completion', () => ({
            isIncomplete: true,
            items: [{ label: 'console', kind: 6 }],
        }));

        const list = await monaco.provider('completion').provideCompletionItems(
            target,
            POSITION,
            { triggerKind: 2, triggerCharacter: '.' },
            token(),
        );

        expect(attachment.lastRequest('textDocument/completion')?.params).toEqual({
            textDocument: { uri: target.uri.toString() },
            position: LSP_POSITION,
            context: { triggerKind: 2, triggerCharacter: '.' },
        });
        expect(list.incomplete).toBe(true);
        expect(list.suggestions[0].range).toEqual({
            startLineNumber: 2,
            startColumn: 1,
            endLineNumber: 2,
            endColumn: 5,
        });
    });

    it('returns signature help with a release hook', async () => {
        const { attachment, target } = open();
        attachment.respond('textDocument/signatureHelp', () => ({
            signatures: [{ label: 'greet(name: string): void', parameters: [{ label: 'name: string' }] }],
            activeSignature: 0,
            activeParameter: 0,
        }));

        const result = await monaco.provider('signatureHelp').provideSignatureHelpItems(
            target,
            POSITION,
            token(),
            { triggerKind: 1, triggerCharacter: '(', isRetrigger: false },
        );

        expect(result.value.signatures[0].label).toBe('greet(name: string): void');
        expect(() => result.dispose()).not.toThrow();
        expect(attachment.lastRequest('textDocument/signatureHelp')?.params).toMatchObject({
            context: { triggerKind: 1, triggerCharacter: '(', isRetrigger: false },
        });
    });

    it('answers empty instead of throwing when the request fails', async () => {
        const { attachment, target } = open();
        attachment.respond('textDocument/hover', () => {
            throw new Error('language server closed');
        });
        attachment.respond('textDocument/completion', () => {
            throw new Error('language server closed');
        });

        expect(await monaco.provider('hover').provideHover(target, POSITION, token())).toBeNull();
        expect(await monaco.provider('completion').provideCompletionItems(target, POSITION, {}, token()))
            .toEqual({ suggestions: [], incomplete: false });
    });

    it('aborts the in-flight request when Monaco cancels', async () => {
        const { attachment, target } = open();
        let aborted = false;
        attachment.respond('textDocument/hover', (_params, signal) => new Promise((resolve) => {
            signal?.addEventListener('abort', () => {
                aborted = true;
                resolve(null);
            });
        }));

        const cancellation = cancellable();
        const pending = monaco.provider('hover').provideHover(target, POSITION, cancellation.token);
        cancellation.cancel();

        expect(await pending).toBeNull();
        expect(aborted).toBe(true);
        // The token subscription is released, so a long-lived token cannot
        // accumulate one listener per keystroke.
        expect(cancellation.disposals).toBe(1);
    });

    it('never asks when the token is already cancelled', async () => {
        const { attachment, target } = open();
        const alreadyCancelled: ProviderCancellationToken = {
            isCancellationRequested: true,
            onCancellationRequested: () => undefined,
        };

        expect(await monaco.provider('hover').provideHover(target, POSITION, alreadyCancelled)).toBeNull();
        expect(attachment.requests).toHaveLength(0);
    });

    it('re-registers when a replacement server advertises a different feature set', () => {
        const { attachment } = open();
        expect(monaco.live()).toEqual(['hover', 'definition', 'references', 'completion', 'signatureHelp']);

        attachment.status(readyState({ textDocumentSync: 1, hoverProvider: true }));

        expect(monaco.live()).toEqual(['hover']);
        expect(monaco.registered.filter((entry) => entry.kind === 'hover')).toHaveLength(2);
    });

    it('leaves the registration alone when a status update changes nothing', () => {
        const { attachment } = open();
        const before = monaco.registered.length;

        attachment.status({ ...readyState(FULL_CAPABILITIES), status: 'reconnecting', restarts: 1 });

        expect(monaco.registered).toHaveLength(before);
        expect(monaco.live()).toHaveLength(5);
    });

    it('disposes every provider once and stops answering', async () => {
        const { registration, target, attachment } = open();
        const hover = monaco.provider('hover');

        registration.dispose();
        registration.dispose();

        expect(monaco.live()).toEqual([]);
        expect(monaco.registered.every((entry) => entry.disposed)).toBe(true);
        // A disposed registration also stops reacting to the host.
        attachment.status(readyState({ textDocumentSync: 1, hoverProvider: true }));
        expect(monaco.live()).toEqual([]);
        // Monaco holding on to the provider object cannot resurrect it either:
        // the model check still passes, but nothing new is registered.
        attachment.respond('textDocument/hover', () => null);
        expect(await hover.provideHover(target, POSITION, token())).toBeNull();
    });

    it('registers optimistically before the first attach and settles afterwards', () => {
        const view = store.open({ path: 'src/late.ts', text: '' });
        registerLanguageProviders({
            monaco: monaco.asMonaco(),
            model: model(view.uri),
            view,
            languageId: 'typescript',
        });
        expect(monaco.live()).toHaveLength(5);

        client.get('src/late.ts').attach({ state: readyState({ textDocumentSync: 1, hoverProvider: true }) });

        expect(monaco.live()).toEqual(['hover']);
    });

    it('honours an injected URI policy', async () => {
        const view = store.open({ path: 'src/a.ts', text: '' });
        client.get('src/a.ts').attach({ state: readyState(FULL_CAPABILITIES) });
        const target = model(view.uri);
        registerLanguageProviders({
            monaco: monaco.asMonaco(),
            model: target,
            view,
            languageId: 'typescript',
            resolveUri: (uri) => (uri.startsWith('file:') ? { toString: () => `readonly:${uri}` } : null),
        });
        client.get('src/a.ts').respond('textDocument/definition', () => ({
            uri: 'file:///dep/index.d.ts',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        }));

        const links = await monaco.provider('definition').provideDefinition(target, POSITION, token());

        expect(links.map((link: { uri: { toString(): string } }) => link.uri.toString()))
            .toEqual(['readonly:file:///dep/index.d.ts']);
    });
});
