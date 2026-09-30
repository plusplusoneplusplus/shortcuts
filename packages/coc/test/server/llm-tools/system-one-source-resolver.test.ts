import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { LedgerEntry, ToolCallLedger } from '../../../src/server/executors/tool-call-ledger';
import {
    SYSTEM_ONE_LIMITS,
    buildSystemOneState,
    normalizeToolName,
    resolveSources,
    trimToBudget,
    type SystemOneSource,
} from '../../../src/server/llm-tools/system-one/source-resolver';

function entry(id: string, name: string, extra: Partial<LedgerEntry> = {}): LedgerEntry {
    return { id, name, status: 'completed', result: `result of ${id}`, current: false, ...extra };
}

/** Fake ledger that honours `scope` and `excludeId` like the real one. */
function fakeLedger(entries: LedgerEntry[]): ToolCallLedger {
    return {
        list: async ({ excludeId, scope }) => entries
            .filter(e => e.id !== excludeId)
            .filter(e => scope === 'any' || e.current),
    };
}

describe('resolveSources', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const resolve = (sources: unknown[], entries: LedgerEntry[] = [], excludeId?: string) =>
        resolveSources({ sources: sources as SystemOneSource[], ledger: fakeLedger(entries), workspaceRoot: root, excludeId });

    describe('tool refs', () => {
        const calls = [
            entry('b1', 'bash'),
            entry('v1', 'view'),
            entry('b2', 'Bash'),
            entry('b3', 'bash', { current: true }),
        ];

        it.each([
            [-1, 'b3'],
            [-2, 'b2'],
            [1, 'b1'],
            [2, 'b2'],
        ])('nth %i resolves to %s (case-insensitive name)', async (nth, id) => {
            const result = await resolve([{ tool: 'bash', nth }], calls);
            expect(result.ok && result.sections[0].meta.toolCallId).toBe(id);
        });

        it('defaults nth to -1', async () => {
            const result = await resolve([{ tool: 'BASH' }], calls);
            expect(result.ok && result.sections[0].meta).toMatchObject({ ref: 'BASH#-1', toolCallId: 'b3' });
        });

        it('reports out-of-range nth as SOURCE_NOT_FOUND with the source index', async () => {
            const result = await resolve([{ text: 'x' }, { tool: 'bash', nth: -9 }], calls);
            expect(!result.ok && result.error).toMatchObject({ error: 'SOURCE_NOT_FOUND', source: 1 });
        });

        it('limits to the current turn when turn is "current"', async () => {
            const result = await resolve([{ tool: 'bash', nth: 1, turn: 'current' }], calls);
            expect(result.ok && result.sections[0].meta.toolCallId).toBe('b3');
            const missing = await resolve([{ tool: 'view', turn: 'current' }], calls);
            expect(!missing.ok && missing.error.error).toBe('SOURCE_NOT_FOUND');
        });

        it('never counts its own call or running calls', async () => {
            const result = await resolve([{ tool: 'bash' }], [
                entry('b1', 'bash'),
                entry('b2', 'bash', { status: 'running', result: undefined }),
                entry('self', 'bash'),
            ], 'self');
            expect(result.ok && result.sections[0].meta.toolCallId).toBe('b1');
        });

        it('reports SOURCE_PENDING when only a running call matches', async () => {
            const result = await resolve([{ tool: 'grep' }], [entry('g1', 'grep', { status: 'running', result: undefined })]);
            expect(!result.ok && result.error.error).toBe('SOURCE_PENDING');
        });

        it('reports SOURCE_FAILED with the call error', async () => {
            const result = await resolve([{ tool: 'grep' }], [entry('g1', 'grep', { status: 'failed', error: 'bad regex' })]);
            expect(!result.ok && result.error).toMatchObject({ error: 'SOURCE_FAILED' });
            expect(!result.ok && result.error.message).toContain('bad regex');
        });

        it('rejects image data URL results as SOURCE_UNSUPPORTED', async () => {
            const result = await resolve([{ tool: 'view' }], [entry('v1', 'view', { result: 'data:image/png;base64,AAAA' })]);
            expect(!result.ok && result.error.error).toBe('SOURCE_UNSUPPORTED');
        });

        it('matches MCP-prefixed tool names', async () => {
            const result = await resolve([{ tool: 'kusto_query' }], [entry('k1', 'mcp__coc_llm_tools__kusto_query')]);
            expect(result.ok && result.sections[0].meta.toolCallId).toBe('k1');
            expect(normalizeToolName('mcp__coc_llm_tools__Kusto_Query')).toBe('kusto_query');
        });

        it('rejects nth 0', async () => {
            const result = await resolve([{ tool: 'bash', nth: 0 }], calls);
            expect(!result.ok && result.error.error).toBe('DECISION_INVALID_REQUEST');
        });
    });

    describe('last refs', () => {
        it('returns the last N completed results oldest first', async () => {
            const result = await resolve([{ last: 2 }], [
                entry('a', 'bash'),
                entry('b', 'view'),
                entry('c', 'grep', { status: 'failed', error: 'x' }),
                entry('d', 'grep'),
            ]);
            expect(result.ok && result.sections.map(s => s.meta.toolCallId)).toEqual(['b', 'd']);
        });

        it.each([0, 6, 1.5])('rejects last %s', async (last) => {
            const result = await resolve([{ last }], [entry('a', 'bash')]);
            expect(!result.ok && result.error.error).toBe('DECISION_INVALID_REQUEST');
        });
    });

    describe('file refs', () => {
        it('reads a workspace file and slices lines', async () => {
            fs.mkdirSync(path.join(root, 'src'));
            fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'one\ntwo\nthree\nfour\n');
            const result = await resolve([{ file: 'src/a.ts', lines: '2-3' }]);
            expect(result.ok && result.sections[0]).toMatchObject({
                label: 'file src/a.ts:2-3',
                content: 'two\nthree',
            });
        });

        it('reports a missing file as SOURCE_NOT_FOUND', async () => {
            const result = await resolve([{ file: 'nope.ts' }]);
            expect(!result.ok && result.error.error).toBe('SOURCE_NOT_FOUND');
        });

        it('rejects paths that escape the workspace', async () => {
            const result = await resolve([{ file: path.join('..', 'outside.txt') }]);
            expect(!result.ok && result.error.error).toBe('SOURCE_OUTSIDE_WORKSPACE');
            const absolute = await resolve([{ file: path.resolve(os.tmpdir(), 'elsewhere.txt') }]);
            expect(!absolute.ok && absolute.error.error).toBe('SOURCE_OUTSIDE_WORKSPACE');
        });

        it('rejects a symlink that points outside the workspace', async () => {
            const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-one-outside-'));
            try {
                fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret');
                try {
                    fs.symlinkSync(path.join(outsideDir, 'secret.txt'), path.join(root, 'link.txt'));
                } catch {
                    return; // Symlinks need extra privileges on some Windows setups.
                }
                const result = await resolve([{ file: 'link.txt' }]);
                expect(!result.ok && result.error.error).toBe('SOURCE_OUTSIDE_WORKSPACE');
            } finally {
                fs.rmSync(outsideDir, { recursive: true, force: true });
            }
        });

        it('rejects binary files and bad line ranges', async () => {
            fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([1, 0, 2]));
            const binary = await resolve([{ file: 'bin.dat' }]);
            expect(!binary.ok && binary.error.error).toBe('SOURCE_UNSUPPORTED');
            fs.writeFileSync(path.join(root, 'a.txt'), 'x');
            const badRange = await resolve([{ file: 'a.txt', lines: '5-2' }]);
            expect(!badRange.ok && badRange.error.error).toBe('DECISION_INVALID_REQUEST');
        });
    });

    describe('text refs and shape', () => {
        it('passes short text through and rejects text over the limit', async () => {
            const ok = await resolve([{ text: 'PR targets release/3.4' }]);
            expect(ok.ok && ok.sections[0]).toMatchObject({ label: 'text', content: 'PR targets release/3.4' });
            const tooBig = await resolve([{ text: 'x'.repeat(SYSTEM_ONE_LIMITS.maxTextBytes + 1) }]);
            expect(!tooBig.ok && tooBig.error.error).toBe('DECISION_INVALID_REQUEST');
        });

        it('requires 1..8 sources of a known kind', async () => {
            expect((await resolve([])).ok).toBe(false);
            expect((await resolve(Array.from({ length: 9 }, () => ({ text: 'x' })))).ok).toBe(false);
            const unknown = await resolve([{ url: 'https://example.com' }]);
            expect(!unknown.ok && unknown.error).toMatchObject({ error: 'DECISION_INVALID_REQUEST', source: 0 });
        });
    });

    describe('budget', () => {
        it('trims each source head+tail and reports it', async () => {
            const big = `HEAD${'x'.repeat(SYSTEM_ONE_LIMITS.maxSourceBytes * 2)}TAIL`;
            const result = await resolve([{ tool: 'bash' }], [entry('b1', 'bash', { result: big })]);
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            const section = result.sections[0];
            expect(section.meta.trimmed).toBe(true);
            expect(section.meta.bytes).toBe(Buffer.byteLength(big));
            expect(section.content.startsWith('HEAD')).toBe(true);
            expect(section.content.endsWith('TAIL')).toBe(true);
            expect(section.content).toContain('[trimmed');
            expect(Buffer.byteLength(section.content)).toBeLessThan(SYSTEM_ONE_LIMITS.maxSourceBytes + 100);
        });

        it('leaves content under budget alone', () => {
            expect(trimToBudget('small', 100)).toEqual({ content: 'small', trimmed: false });
        });

        it('builds labeled state and rejects state over the total budget', async () => {
            const result = await resolve([{ tool: 'bash' }, { text: 'fact' }], [entry('b1', 'bash', { result: 'out' })]);
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            const built = buildSystemOneState(result.sections);
            expect(built.ok && built.state).toBe('### [1] tool bash #-1 (toolCallId b1, 3 bytes)\nout\n\n### [2] text\nfact');

            const chunk = 'y'.repeat(SYSTEM_ONE_LIMITS.maxSourceBytes);
            const many = await resolve(
                [1, 2, 3, 4].map(nth => ({ tool: 'bash', nth })),
                [1, 2, 3, 4].map(i => entry(`b${i}`, 'bash', { result: chunk })),
            );
            expect(many.ok).toBe(true);
            if (!many.ok) return;
            const tooLarge = buildSystemOneState(many.sections);
            expect(!tooLarge.ok && tooLarge.error.error).toBe('STATE_TOO_LARGE');
        });
    });
});
