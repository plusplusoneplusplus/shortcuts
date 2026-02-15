/**
 * Interface contract tests for EditorTransport, StateStore, and EditorHost.
 *
 * Creates mock implementations and verifies the contracts work as expected.
 */

import { describe, it, expect, vi } from 'vitest';
import type {
    EditorTransport,
    EditorHost,
    StateStore,
    MessageListener,
    WebviewToBackendMessage,
    BackendToWebviewMessage,
} from '../../src/editor';
import type { Disposable } from '../../src/utils/process-monitor';

// -------------------------------------------------------------------------
// Mock implementations
// -------------------------------------------------------------------------

function createMockTransport(): EditorTransport & { _listeners: MessageListener<WebviewToBackendMessage>[] } {
    const listeners: MessageListener<WebviewToBackendMessage>[] = [];
    const posted: BackendToWebviewMessage[] = [];

    return {
        _listeners: listeners,
        isConnected: true,

        postMessage(msg: BackendToWebviewMessage): void {
            posted.push(msg);
        },

        onMessage(listener: MessageListener<WebviewToBackendMessage>): Disposable {
            listeners.push(listener);
            return {
                dispose() {
                    const idx = listeners.indexOf(listener);
                    if (idx >= 0) { listeners.splice(idx, 1); }
                },
            };
        },
    };
}

function createMockStateStore(): StateStore & { _data: Map<string, unknown> } {
    const data = new Map<string, unknown>();
    return {
        _data: data,
        get<T>(key: string, defaultValue: T): T {
            return data.has(key) ? data.get(key) as T : defaultValue;
        },
        async update(key: string, value: unknown): Promise<void> {
            data.set(key, value);
        },
        keys(): string[] {
            return Array.from(data.keys());
        },
    };
}

function createMockHost(): EditorHost {
    return {
        showInformation: vi.fn(),
        showWarning: vi.fn(),
        showError: vi.fn(),
        showConfirmation: vi.fn().mockResolvedValue('OK'),
        copyToClipboard: vi.fn().mockResolvedValue(undefined),
        openFile: vi.fn().mockResolvedValue(undefined),
        resolveImageUri: vi.fn().mockReturnValue('https://example.com/img.png'),
        getWorkspaceRoot: vi.fn().mockReturnValue('/workspace'),
    };
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('EditorTransport', () => {
    it('postMessage delivers a BackendToWebviewMessage', () => {
        const transport = createMockTransport();
        const msg: BackendToWebviewMessage = { type: 'showUpdateDocumentDialog' };
        transport.postMessage(msg);
        // If it doesn't throw, the contract is satisfied
        expect(transport.isConnected).toBe(true);
    });

    it('onMessage round-trip works', () => {
        const transport = createMockTransport();
        const received: WebviewToBackendMessage[] = [];

        const disposable = transport.onMessage((msg) => { received.push(msg); });

        // Simulate webview sending a message
        const incoming: WebviewToBackendMessage = { type: 'ready' };
        for (const l of transport._listeners) { l(incoming); }

        expect(received).toHaveLength(1);
        expect(received[0].type).toBe('ready');

        // Dispose and verify listener is removed
        disposable.dispose();
        expect(transport._listeners).toHaveLength(0);
    });

    it('Disposable from onMessage is compatible with pipeline-core Disposable', () => {
        const transport = createMockTransport();
        const disposable: Disposable = transport.onMessage(() => { /* noop */ });
        expect(typeof disposable.dispose).toBe('function');
        disposable.dispose();
    });
});

describe('StateStore', () => {
    it('get returns default when key not set', () => {
        const store = createMockStateStore();
        expect(store.get('missing', 42)).toBe(42);
    });

    it('update then get returns the stored value', async () => {
        const store = createMockStateStore();
        await store.update('theme', 'dark');
        expect(store.get('theme', 'light')).toBe('dark');
    });

    it('keys lists all stored keys', async () => {
        const store = createMockStateStore();
        await store.update('a', 1);
        await store.update('b', 2);
        expect(store.keys!()).toEqual(['a', 'b']);
    });

    it('update returns a Promise', () => {
        const store = createMockStateStore();
        const result = store.update('k', 'v');
        expect(result).toBeInstanceOf(Promise);
    });

    it('stores complex objects', async () => {
        const store = createMockStateStore();
        const obj = { comments: [{ id: '1', text: 'hi' }] };
        await store.update('data', obj);
        expect(store.get('data', null)).toEqual(obj);
    });
});

describe('EditorHost', () => {
    it('has all required methods', () => {
        const host = createMockHost();
        expect(typeof host.showInformation).toBe('function');
        expect(typeof host.showWarning).toBe('function');
        expect(typeof host.showError).toBe('function');
        expect(typeof host.showConfirmation).toBe('function');
        expect(typeof host.copyToClipboard).toBe('function');
        expect(typeof host.openFile).toBe('function');
        expect(typeof host.resolveImageUri).toBe('function');
        expect(typeof host.getWorkspaceRoot).toBe('function');
    });

    it('showConfirmation returns a Promise<string | undefined>', async () => {
        const host = createMockHost();
        const result = await host.showConfirmation('Delete?', ['Yes', 'No']);
        expect(result).toBe('OK'); // mock default
    });

    it('copyToClipboard returns a Promise<void>', async () => {
        const host = createMockHost();
        await host.copyToClipboard('text');
        expect(host.copyToClipboard).toHaveBeenCalledWith('text');
    });

    it('openFile returns a Promise<void>', async () => {
        const host = createMockHost();
        await host.openFile('/path/to/file.md');
        expect(host.openFile).toHaveBeenCalledWith('/path/to/file.md');
    });

    it('resolveImageUri returns string or undefined', () => {
        const host = createMockHost();
        const uri = host.resolveImageUri('img.png', '/doc.md');
        expect(typeof uri).toBe('string');
    });

    it('getWorkspaceRoot returns a string', () => {
        const host = createMockHost();
        expect(host.getWorkspaceRoot()).toBe('/workspace');
    });
});
