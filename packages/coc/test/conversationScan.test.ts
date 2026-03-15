import { describe, it, expect } from 'vitest';
import {
    scanTurnsForCreatedFiles,
    PINNED_EXTENSIONS,
} from '../src/server/spa/client/react/utils/conversationScan';
import type { ClientConversationTurn } from '../src/server/spa/client/react/types/dashboard';

// ============================================================================
// Helpers
// ============================================================================

function makeTurn(
    toolCalls: Array<{ toolName: string; args: Record<string, string>; status?: string }>,
    useTimeline = true
): ClientConversationTurn {
    const tc = toolCalls.map((t, i) => ({
        id: `tc${i}`,
        toolName: t.toolName,
        args: t.args,
        status: (t.status ?? 'completed') as 'pending' | 'running' | 'completed' | 'failed',
    }));

    if (useTimeline) {
        return {
            role: 'assistant',
            content: '',
            timeline: tc
                .filter(t => t.status === 'completed')
                .map(t => ({ type: 'tool-complete' as const, timestamp: '', toolCall: t })),
        };
    }

    // Historical turns: no timeline, only toolCalls
    return {
        role: 'assistant',
        content: '',
        timeline: [],
        toolCalls: tc,
    };
}

// ============================================================================
// scanTurnsForCreatedFiles
// ============================================================================

describe('scanTurnsForCreatedFiles', () => {
    it('returns empty for empty turns', () => {
        expect(scanTurnsForCreatedFiles([])).toEqual([]);
    });

    it('returns empty when no create tool calls', () => {
        const turns: ClientConversationTurn[] = [
            makeTurn([{ toolName: 'read_file', args: { path: '/some/file.md' } }]),
        ];
        expect(scanTurnsForCreatedFiles(turns)).toEqual([]);
    });

    it('detects a single create call via timeline', () => {
        const turns = [
            makeTurn([{ toolName: 'create', args: { path: '/tmp/plan.md' } }]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe('/tmp/plan.md');
        expect(results[0].turnIndex).toBe(0);
    });

    it('detects write_file tool name as well', () => {
        const turns = [
            makeTurn([{ toolName: 'write_file', args: { path: '/tmp/notes.txt' } }]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe('/tmp/notes.txt');
    });

    it('filters out non-pinned extensions (.js, .png)', () => {
        const turns = [
            makeTurn([
                { toolName: 'create', args: { path: '/tmp/script.js' } },
                { toolName: 'create', args: { path: '/tmp/image.png' } },
                { toolName: 'create', args: { path: '/tmp/plan.md' } },
            ]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe('/tmp/plan.md');
    });

    it('deduplicates the same path created twice', () => {
        const turns = [
            makeTurn([{ toolName: 'create', args: { path: '/tmp/plan.md' } }]),
            makeTurn([{ toolName: 'create', args: { path: '/tmp/plan.md' } }]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(1);
        expect(results[0].turnIndex).toBe(0);
    });

    it('returns multiple distinct files in order', () => {
        const turns = [
            makeTurn([{ toolName: 'create', args: { path: '/tmp/spec.md' } }]),
            makeTurn([{ toolName: 'create', args: { path: '/tmp/plan.md' } }]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(2);
        expect(results[0].filePath).toBe('/tmp/spec.md');
        expect(results[1].filePath).toBe('/tmp/plan.md');
    });

    it('falls back to turn.toolCalls when timeline is empty (historical format)', () => {
        const turns = [
            makeTurn([{ toolName: 'create', args: { path: '/tmp/old.md' } }], false),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe('/tmp/old.md');
    });

    it('ignores failed tool calls (tool-failed events not counted)', () => {
        const turn: ClientConversationTurn = {
            role: 'assistant',
            content: '',
            timeline: [
                {
                    type: 'tool-failed',
                    timestamp: '',
                    toolCall: {
                        id: 'tc0',
                        toolName: 'create',
                        args: { path: '/tmp/failed.md' },
                        status: 'failed',
                    },
                },
            ],
        };
        expect(scanTurnsForCreatedFiles([turn])).toEqual([]);
    });

    it('accepts filePath arg key in addition to path', () => {
        const turns = [
            makeTurn([{ toolName: 'create', args: { filePath: '/tmp/alt.yaml' } }]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe('/tmp/alt.yaml');
    });

    it('all PINNED_EXTENSIONS are accepted', () => {
        const turns = PINNED_EXTENSIONS.map(ext =>
            makeTurn([{ toolName: 'create', args: { path: `/tmp/file${ext}` } }])
        );
        const results = scanTurnsForCreatedFiles(turns);
        expect(results).toHaveLength(PINNED_EXTENSIONS.length);
    });

    it('returns correct turnIndex for each record', () => {
        const turns = [
            { role: 'user' as const, content: 'hello', timeline: [] },
            makeTurn([{ toolName: 'create', args: { path: '/tmp/a.md' } }]),
            makeTurn([{ toolName: 'create', args: { path: '/tmp/b.md' } }]),
        ];
        const results = scanTurnsForCreatedFiles(turns);
        expect(results[0].turnIndex).toBe(1);
        expect(results[1].turnIndex).toBe(2);
    });
});
