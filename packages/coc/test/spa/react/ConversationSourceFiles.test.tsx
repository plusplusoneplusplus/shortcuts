/**
 * Regression tests for the source-canvas conversation file collector.
 */
/* @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';
import {
    collectConversationSourceFiles,
    getConversationSourceFileKey,
    useConversationSourceFiles,
} from '../../../src/server/spa/client/react/features/chat/source-canvas/conversationSourceFiles';

function turn(role: ClientConversationTurn['role'], content: string): ClientConversationTurn {
    return { role, content, timeline: [] };
}

describe('collectConversationSourceFiles', () => {
    it('collects assistant code links while excluding user links, notes, and folders', () => {
        const files = collectConversationSourceFiles([
            turn('user', '/repo/src/user-only.ts:3'),
            turn('assistant', [
                '/repo/src/first.ts:4',
                '[second](src/second.ts#L8-L10)',
                '/repo/notes/todo.md:2',
                '[folder](/repo/src/)',
            ].join('\n')),
        ], 'ws-a');

        expect(files).toEqual([
            {
                fullPath: 'src/second.ts',
                wsId: 'ws-a',
                kind: 'code',
                line: 8,
                endLine: 10,
            },
            {
                fullPath: '/repo/src/first.ts',
                wsId: 'ws-a',
                kind: 'code',
                line: 4,
                endLine: undefined,
            },
        ]);
    });

    it('deduplicates normalized workspace paths and keeps the latest line range first', () => {
        const files = collectConversationSourceFiles([
            turn('assistant', 'C:\\Repo\\src\\Widget.ts:2'),
            turn('assistant', '/repo/src/other.ts:6'),
            turn('assistant', 'c:/repo/src/widget.ts:12-14'),
        ], 'WS-A');

        expect(files).toEqual([
            {
                fullPath: 'c:/repo/src/widget.ts',
                wsId: 'WS-A',
                kind: 'code',
                line: 12,
                endLine: 14,
            },
            {
                fullPath: '/repo/src/other.ts',
                wsId: 'WS-A',
                kind: 'code',
                line: 6,
                endLine: undefined,
            },
        ]);
    });

    it('normalizes workspace identity and paths without merging different workspaces', () => {
        const canonical = getConversationSourceFileKey('workspace-A', 'C:\\Repo\\src\\Widget.ts');
        expect(getConversationSourceFileKey('WORKSPACE-a', 'c:/repo/src/widget.ts')).toBe(canonical);
        expect(getConversationSourceFileKey('workspace-b', 'c:/repo/src/widget.ts')).not.toBe(canonical);
    });

    it('keeps each conversation and workspace isolated without retaining candidates globally', () => {
        const firstConversation = collectConversationSourceFiles(
            [turn('assistant', '/repo/src/one.ts')],
            'workspace-one',
        );
        const secondConversation = collectConversationSourceFiles(
            [turn('assistant', '/repo/src/two.ts')],
            'workspace-two',
        );

        expect(firstConversation).toMatchObject([{ fullPath: '/repo/src/one.ts', wsId: 'workspace-one' }]);
        expect(secondConversation).toMatchObject([{ fullPath: '/repo/src/two.ts', wsId: 'workspace-two' }]);
    });
});

describe('useConversationSourceFiles', () => {
    it('updates when a newly loaded assistant message adds a source-code link', () => {
        const initialTurns = [turn('assistant', '/repo/src/older.ts:1')];
        const { result, rerender } = renderHook(
            ({ turns }) => useConversationSourceFiles(turns, 'ws-a'),
            { initialProps: { turns: initialTurns } },
        );

        expect(result.current.map(file => file.fullPath)).toEqual(['/repo/src/older.ts']);

        rerender({
            turns: [...initialTurns, turn('assistant', '/repo/src/newer.ts:9')],
        });

        expect(result.current.map(file => file.fullPath)).toEqual([
            '/repo/src/newer.ts',
            '/repo/src/older.ts',
        ]);
        expect(result.current[0]).toMatchObject({ line: 9, wsId: 'ws-a' });
    });
});
