import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolCallCapture, ToolCallCaptureOptions } from '../../src/memory/tool-call-capture';
import type { ToolCallCacheStore, ToolCallFilter, ToolCallQAEntry } from '../../src/memory/tool-call-cache-types';
import type { ToolEvent } from '../../src/copilot-sdk-wrapper/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStore(): ToolCallCacheStore & { writeRaw: ReturnType<typeof vi.fn> } {
    return {
        writeRaw: vi.fn().mockResolvedValue('mock-filename.json'),
        readRaw: vi.fn().mockResolvedValue(undefined),
        listRaw: vi.fn().mockResolvedValue([]),
        deleteRaw: vi.fn().mockResolvedValue(false),
        readConsolidated: vi.fn().mockResolvedValue([]),
        writeConsolidated: vi.fn().mockResolvedValue(undefined),
        readConsolidatedIndex: vi.fn().mockResolvedValue([]),
        readEntryAnswer: vi.fn().mockResolvedValue(undefined),
        writeConsolidatedEntry: vi.fn().mockResolvedValue(undefined),
        deleteConsolidatedEntry: vi.fn().mockResolvedValue(true),
        readIndex: vi.fn().mockResolvedValue({ lastAggregation: null, rawCount: 0, consolidatedCount: 0 }),
        updateIndex: vi.fn().mockResolvedValue(undefined),
        getStats: vi.fn().mockResolvedValue({ rawCount: 0, consolidatedExists: false, consolidatedCount: 0, lastAggregation: null }),
        clear: vi.fn().mockResolvedValue(undefined),
    };
}

function makeStartEvent(id: string, toolName: string, params: Record<string, unknown>): ToolEvent {
    return { type: 'tool-start', toolCallId: id, toolName, parameters: params };
}

function makeCompleteEvent(id: string, toolName?: string, result?: string, parentToolCallId?: string): ToolEvent {
    return { type: 'tool-complete', toolCallId: id, toolName, result, parentToolCallId };
}

function makeFailedEvent(id: string, toolName?: string, error?: string): ToolEvent {
    return { type: 'tool-failed', toolCallId: id, toolName, error };
}

const acceptAll: ToolCallFilter = () => true;
const acceptOnly = (...names: string[]): ToolCallFilter => (toolName) => names.includes(toolName);
const rejectOnly = (...names: string[]): ToolCallFilter => (toolName) => !names.includes(toolName);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolCallCapture', () => {
    let store: ReturnType<typeof createMockStore>;

    beforeEach(() => {
        store = createMockStore();
    });

    // --- Filter behaviour ---------------------------------------------------

    describe('filter', () => {
        it('includes tool events matching the filter', async () => {
            const capture = new ToolCallCapture(store, acceptOnly('grep', 'view'));
            const handler = capture.createToolEventHandler();

            handler(makeStartEvent('c1', 'grep', { pattern: 'foo' }));
            handler(makeCompleteEvent('c1', 'grep', 'result1'));

            handler(makeStartEvent('c2', 'view', { path: 'a.ts' }));
            handler(makeCompleteEvent('c2', 'view', 'result2'));

            await vi.waitFor(() => expect(store.writeRaw).toHaveBeenCalledTimes(2));
        });

        it('excludes tool events not matching the filter', async () => {
            const capture = new ToolCallCapture(store, rejectOnly('edit'));
            const handler = capture.createToolEventHandler();

            handler(makeStartEvent('c1', 'edit', { path: 'a.ts' }));
            handler(makeCompleteEvent('c1', 'edit', 'ok'));

            // Give any fire-and-forget promises a tick to settle
            await new Promise(r => setTimeout(r, 10));
            expect(store.writeRaw).not.toHaveBeenCalled();
        });
    });

    // --- Arg normalization ---------------------------------------------------

    describe('normalizeToolArgs', () => {
        const capture = new ToolCallCapture(createMockStore(), acceptAll);

        it('normalizes grep args', () => {
            expect(capture.normalizeToolArgs('grep', { pattern: 'auth', path: 'src/' }))
                .toBe("Search for 'auth' in src/");
            expect(capture.normalizeToolArgs('grep', { pattern: 'TODO' }))
                .toBe("Search for 'TODO'");
        });

        it('normalizes glob args', () => {
            expect(capture.normalizeToolArgs('glob', { pattern: '**/*.test.ts' }))
                .toBe('Find files matching **/*.test.ts');
            expect(capture.normalizeToolArgs('glob', { pattern: '*.md', path: 'docs/' }))
                .toBe('Find files matching *.md in docs/');
        });

        it('normalizes view args', () => {
            expect(capture.normalizeToolArgs('view', { path: 'src/auth.ts' }))
                .toBe('View file src/auth.ts');
            expect(capture.normalizeToolArgs('view', { path: 'src/auth.ts', view_range: [10, 20] }))
                .toBe('View file src/auth.ts lines 10-20');
        });

        it('normalizes task args', () => {
            expect(capture.normalizeToolArgs('task', { prompt: 'How does auth work?', agent_type: 'explore' }))
                .toBe('How does auth work?');
            expect(capture.normalizeToolArgs('task', { prompt: '' }))
                .toBe('Task');
            const longPrompt = 'A'.repeat(250);
            const result = capture.normalizeToolArgs('task', { prompt: longPrompt });
            expect(result).toBe('A'.repeat(200) + '...');
        });

        it('normalizes powershell args', () => {
            expect(capture.normalizeToolArgs('powershell', { command: 'npm test' }))
                .toBe('Run command: npm test');
            const longCmd = 'x'.repeat(200);
            const result = capture.normalizeToolArgs('powershell', { command: longCmd });
            expect(result).toBe('Run command: ' + 'x'.repeat(150) + '...');
        });

        it('normalizes edit args', () => {
            expect(capture.normalizeToolArgs('edit', { path: 'src/foo.ts' }))
                .toBe('Edit file src/foo.ts');
        });

        it('normalizes create args', () => {
            expect(capture.normalizeToolArgs('create', { path: 'new-file.ts' }))
                .toBe('Create file new-file.ts');
        });

        it('normalizes web_search args', () => {
            expect(capture.normalizeToolArgs('web_search', { query: 'vitest mocking' }))
                .toBe('vitest mocking');
        });

        it('normalizes web_fetch args', () => {
            expect(capture.normalizeToolArgs('web_fetch', { url: 'https://example.com' }))
                .toBe('Fetch https://example.com');
        });

        it('uses default fallback for unknown tools', () => {
            expect(capture.normalizeToolArgs('foo', { x: 1 }))
                .toBe('foo: {"x":1}');
        });

        it('truncates long fallback args', () => {
            const longVal = 'v'.repeat(200);
            const result = capture.normalizeToolArgs('unknown_tool', { key: longVal });
            expect(result.length).toBeLessThanOrEqual('unknown_tool: '.length + 150 + 3);
            expect(result).toContain('...');
        });
    });

    // --- Store writes --------------------------------------------------------

    describe('writeRaw on tool-complete', () => {
        it('writes entry with correct fields', async () => {
            const capture = new ToolCallCapture(store, acceptAll, { gitHash: 'abc123' });
            const handler = capture.createToolEventHandler();

            handler(makeStartEvent('call-1', 'grep', { pattern: 'auth', path: 'src/' }));
            handler(makeCompleteEvent('call-1', 'grep', 'found 3 matches', 'parent-1'));

            await vi.waitFor(() => expect(store.writeRaw).toHaveBeenCalledTimes(1));

            const entry: ToolCallQAEntry = store.writeRaw.mock.calls[0][0];
            expect(entry.id).toBe('call-1');
            expect(entry.toolName).toBe('grep');
            expect(entry.question).toBe("Search for 'auth' in src/");
            expect(entry.answer).toBe('found 3 matches');
            expect(entry.args).toEqual({ pattern: 'auth', path: 'src/' });
            expect(entry.gitHash).toBe('abc123');
            expect(entry.parentToolCallId).toBe('parent-1');
            expect(entry.timestamp).toBeTruthy();
            // timestamp should be ISO 8601
            expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
        });

        it('uses empty string answer when result is undefined', async () => {
            const capture = new ToolCallCapture(store, acceptAll);
            const handler = capture.createToolEventHandler();

            handler(makeStartEvent('c1', 'view', { path: 'a.ts' }));
            handler(makeCompleteEvent('c1', 'view', undefined));

            await vi.waitFor(() => expect(store.writeRaw).toHaveBeenCalledTimes(1));
            expect(store.writeRaw.mock.calls[0][0].answer).toBe('');
        });
    });

    // --- tool-start only (no write) ------------------------------------------

    it('does not write on tool-start events alone', async () => {
        const capture = new ToolCallCapture(store, acceptAll);
        const handler = capture.createToolEventHandler();

        handler(makeStartEvent('c1', 'grep', { pattern: 'x' }));

        await new Promise(r => setTimeout(r, 10));
        expect(store.writeRaw).not.toHaveBeenCalled();
    });

    // --- tool-failed behaviour -----------------------------------------------

    describe('tool-failed events', () => {
        it('ignores tool-failed by default', async () => {
            const capture = new ToolCallCapture(store, acceptAll);
            const handler = capture.createToolEventHandler();

            handler(makeStartEvent('c1', 'grep', { pattern: 'x' }));
            handler(makeFailedEvent('c1', 'grep', 'timeout'));

            await new Promise(r => setTimeout(r, 10));
            expect(store.writeRaw).not.toHaveBeenCalled();
        });

        it('captures tool-failed when captureFailures is true', async () => {
            const capture = new ToolCallCapture(store, acceptAll, { captureFailures: true });
            const handler = capture.createToolEventHandler();

            handler(makeStartEvent('c1', 'grep', { pattern: 'x' }));
            handler(makeFailedEvent('c1', 'grep', 'timeout'));

            await vi.waitFor(() => expect(store.writeRaw).toHaveBeenCalledTimes(1));
            const entry: ToolCallQAEntry = store.writeRaw.mock.calls[0][0];
            expect(entry.answer).toBe('[ERROR] timeout');
        });

        it('uses default error message when error is undefined', async () => {
            const capture = new ToolCallCapture(store, acceptAll, { captureFailures: true });
            const handler = capture.createToolEventHandler();

            handler(makeStartEvent('c1', 'grep', { pattern: 'x' }));
            handler(makeFailedEvent('c1', 'grep', undefined));

            await vi.waitFor(() => expect(store.writeRaw).toHaveBeenCalledTimes(1));
            expect(store.writeRaw.mock.calls[0][0].answer).toBe('[ERROR] Unknown error');
        });
    });

    // --- Non-blocking guarantee ----------------------------------------------

    it('does not throw when writeRaw rejects', async () => {
        store.writeRaw.mockRejectedValue(new Error('disk full'));
        const capture = new ToolCallCapture(store, acceptAll);
        const handler = capture.createToolEventHandler();

        // Should not throw
        expect(() => {
            handler(makeStartEvent('c1', 'grep', { pattern: 'x' }));
            handler(makeCompleteEvent('c1', 'grep', 'result'));
        }).not.toThrow();

        // Let the rejected promise settle
        await new Promise(r => setTimeout(r, 10));
        expect(capture.capturedCount).toBe(0);
    });

    // --- Captured count tracking ---------------------------------------------

    it('tracks captured count for successful writes', async () => {
        const capture = new ToolCallCapture(store, acceptAll);
        const handler = capture.createToolEventHandler();

        handler(makeStartEvent('c1', 'grep', { pattern: 'a' }));
        handler(makeCompleteEvent('c1', 'grep', 'r1'));

        handler(makeStartEvent('c2', 'view', { path: 'b.ts' }));
        handler(makeCompleteEvent('c2', 'view', 'r2'));

        handler(makeStartEvent('c3', 'glob', { pattern: '*.ts' }));
        handler(makeCompleteEvent('c3', 'glob', 'r3'));

        await vi.waitFor(() => expect(capture.capturedCount).toBe(3));
    });

    it('does not increment count on write failure', async () => {
        store.writeRaw.mockRejectedValue(new Error('fail'));
        const capture = new ToolCallCapture(store, acceptAll);
        const handler = capture.createToolEventHandler();

        handler(makeStartEvent('c1', 'grep', { pattern: 'a' }));
        handler(makeCompleteEvent('c1', 'grep', 'r1'));

        await new Promise(r => setTimeout(r, 10));
        expect(capture.capturedCount).toBe(0);
    });

    // --- Orphaned events -----------------------------------------------------

    it('handles orphaned tool-complete (no matching start)', async () => {
        const capture = new ToolCallCapture(store, acceptAll);
        const handler = capture.createToolEventHandler();

        // Send complete without start — should not throw or write
        expect(() => handler(makeCompleteEvent('orphan', 'grep', 'result'))).not.toThrow();
        await new Promise(r => setTimeout(r, 10));
        expect(store.writeRaw).not.toHaveBeenCalled();
    });

    // --- Missing toolName on start -------------------------------------------

    it('ignores tool-start with missing toolName', async () => {
        const capture = new ToolCallCapture(store, acceptAll);
        const handler = capture.createToolEventHandler();

        handler({ type: 'tool-start', toolCallId: 'no-name', parameters: { x: 1 } } as ToolEvent);
        handler(makeCompleteEvent('no-name', undefined, 'result'));

        await new Promise(r => setTimeout(r, 10));
        expect(store.writeRaw).not.toHaveBeenCalled();
    });

    // --- gitHash and parentToolCallId pass-through ---------------------------

    it('passes gitHash and parentToolCallId through to entry', async () => {
        const capture = new ToolCallCapture(store, acceptAll, { gitHash: 'abc123' });
        const handler = capture.createToolEventHandler();

        handler({ ...makeStartEvent('c1', 'grep', { pattern: 'x' }), parentToolCallId: 'parent-1' });
        handler(makeCompleteEvent('c1', 'grep', 'result', 'parent-1'));

        await vi.waitFor(() => expect(store.writeRaw).toHaveBeenCalledTimes(1));
        const entry: ToolCallQAEntry = store.writeRaw.mock.calls[0][0];
        expect(entry.gitHash).toBe('abc123');
        expect(entry.parentToolCallId).toBe('parent-1');
    });
});
