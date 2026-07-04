/**
 * Tests for the pure WhisperCollapsedGroup model construction: header-part
 * order + counts, plain-text header + duration, and group tool-call collection.
 */

import { describe, it, expect } from 'vitest';
import type { WhisperSummary } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';
import {
    buildWhisperHeaderParts,
    buildWhisperGroupModel,
    formatWhisperDuration,
    collectGroupToolCalls,
} from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/whisperGroupModel';

function summary(overrides: Partial<WhisperSummary> = {}): WhisperSummary {
    return { toolCallCount: 0, messageCount: 0, ...overrides };
}

describe('buildWhisperHeaderParts', () => {
    it('emits every kind in reading order', () => {
        const parts = buildWhisperHeaderParts(summary({
            toolCallCount: 3,
            messageCount: 2,
            fileEditCount: 5,
            deletedFileCount: 1,
            commitCount: 2,
            fixupCommitCount: 1,
            prCount: 1,
            pushCount: 1,
            skillCount: 2,
            memoryCount: 1,
        }));
        expect(parts.map(p => p.text)).toEqual([
            '3 tool calls',
            '2 messages',
            '4 files',
            '1 removed',
            '2 commits',
            '1 fixup',
            '1 PR',
            '1 pushed',
            '2 skills',
            '1 memory',
        ]);
        expect(parts.map(p => p.kind)).toEqual([
            undefined, undefined, 'file', 'removed-file', 'commit', 'fixup', 'pr', 'push', 'skill', 'memory',
        ]);
    });

    it('uses singular forms for counts of one', () => {
        const parts = buildWhisperHeaderParts(summary({
            toolCallCount: 1,
            messageCount: 1,
            fileEditCount: 1,
            commitCount: 1,
            fixupCommitCount: 1,
            prCount: 1,
            skillCount: 1,
            memoryCount: 1,
        }));
        expect(parts.map(p => p.text)).toEqual([
            '1 tool call', '1 message', '1 file', '1 commit', '1 fixup', '1 PR', '1 skill', '1 memory',
        ]);
    });

    it('pluralizes memories with the -ies form', () => {
        expect(buildWhisperHeaderParts(summary({ memoryCount: 2 })).map(p => p.text)).toEqual(['2 memories']);
    });

    it('subtracts deleted files from the active file count', () => {
        const parts = buildWhisperHeaderParts(summary({ fileEditCount: 6, deletedFileCount: 2 }));
        expect(parts.map(p => p.text)).toEqual(['4 files', '2 removed']);
    });

    it('omits the active file chip when every file was deleted', () => {
        const parts = buildWhisperHeaderParts(summary({ fileEditCount: 2, deletedFileCount: 2 }));
        expect(parts.map(p => p.text)).toEqual(['2 removed']);
        expect(parts.map(p => p.kind)).toEqual(['removed-file']);
    });

    it('omits zero-count parts entirely', () => {
        expect(buildWhisperHeaderParts(summary())).toEqual([]);
    });
});

describe('formatWhisperDuration', () => {
    it('renders sub-second durations in ms', () => {
        expect(formatWhisperDuration(1000, 1500)).toBe('500ms');
    });
    it('renders multi-second durations with one decimal', () => {
        expect(formatWhisperDuration(1000, 3000)).toBe('2.0s');
    });
    it('returns empty when a timestamp is missing', () => {
        expect(formatWhisperDuration(undefined, 3000)).toBe('');
        expect(formatWhisperDuration(1000, undefined)).toBe('');
    });
});

describe('buildWhisperGroupModel', () => {
    it('joins the header parts and appends the duration', () => {
        const model = buildWhisperGroupModel(summary({
            toolCallCount: 2,
            messageCount: 1,
            startTime: 1000,
            endTime: 3000,
        }));
        expect(model.duration).toBe('2.0s');
        expect(model.headerTextPlain).toBe('2 tool calls · 1 message (2.0s)');
    });

    it('omits the duration suffix when unavailable', () => {
        const model = buildWhisperGroupModel(summary({ toolCallCount: 1 }));
        expect(model.duration).toBe('');
        expect(model.headerTextPlain).toBe('1 tool call');
    });
});

describe('collectGroupToolCalls', () => {
    it('flattens standalone tool and tool-group chunks in order, skipping unknown ids', () => {
        const toolById = new Map<string, { toolName: string; args?: Record<string, unknown> }>([
            ['t1', { toolName: 'edit', args: { path: 'a.ts' } }],
            ['t2', { toolName: 'create', args: { path: 'b.ts' } }],
        ]);
        const chunks = [
            { kind: 'tool', toolId: 't1', key: 'k1' },
            { kind: 'tool-group', toolIds: ['t2', 'missing'], key: 'k2' },
            { kind: 'content', key: 'k3' },
            { kind: 'tool', toolId: 'unknown', key: 'k4' },
        ];
        expect(collectGroupToolCalls(chunks, toolById)).toEqual([
            { toolName: 'edit', args: { path: 'a.ts' } },
            { toolName: 'create', args: { path: 'b.ts' } },
        ]);
    });

    it('returns an empty list when there are no reconstructable calls', () => {
        expect(collectGroupToolCalls([{ kind: 'content', key: 'k' }], new Map())).toEqual([]);
    });
});
