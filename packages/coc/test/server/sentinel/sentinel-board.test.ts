import type { AIProcess } from '@plusplusoneplusplus/forge';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    createSentinelBoardStorage,
    findNewlyApprovedSentinelNudges,
    foldSentinelBoardEdits,
    renderSentinelBoard,
} from '../../../src/server/sentinel/sentinel-board';
import {
    createSentinelWatchlist,
    getSentinelWatchlistPath,
    type SentinelWatchlist,
    type SentinelWatchlistEntry,
} from '../../../src/server/sentinel/sentinel-watchlist';

const NOW = new Date('2026-09-16T21:00:00.000Z');
const tempDirs: string[] = [];

afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function makeEntry(
    processId: string,
    overrides: Partial<SentinelWatchlistEntry> = {},
): SentinelWatchlistEntry {
    return {
        processId,
        bucket: 'failed',
        disposition: 'watching',
        reason: `${processId} needs attention.`,
        nudgeCount: 0,
        addedAt: NOW.toISOString(),
        ...overrides,
    };
}

function makeProcess(id: string, title: string): AIProcess {
    return {
        id,
        type: 'chat',
        promptPreview: id,
        fullPrompt: id,
        title,
        status: 'completed',
        startTime: NOW,
        metadata: { type: 'chat', mode: 'ask', workspaceId: 'workspace-a' },
    };
}

function withRenderedBoard(entries: SentinelWatchlistEntry[]): {
    watchlist: SentinelWatchlist;
    board: string;
} {
    const watchlist = { ...createSentinelWatchlist('sentinel-a', NOW), entries };
    const board = renderSentinelBoard('workspace-a', watchlist);
    return { board, watchlist: { ...watchlist, lastRenderedBoard: board } };
}

describe('Sentinel board', () => {
    it('creates files once and rejects stale board writes', async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-board-'));
        tempDirs.push(dataDir);
        const storage = createSentinelBoardStorage(dataDir, 'workspace-a');

        await expect(storage.readBoard()).resolves.toBeUndefined();
        await storage.ensureConfig();
        const sentinelDirectory = path.dirname(
            getSentinelWatchlistPath(dataDir, 'workspace-a'),
        );
        fs.writeFileSync(path.join(sentinelDirectory, 'Sentinel.md'), '# Custom\n', 'utf8');
        await storage.ensureConfig();
        expect(fs.readFileSync(path.join(sentinelDirectory, 'Sentinel.md'), 'utf8'))
            .toBe('# Custom\n');

        await expect(storage.writeBoard('first\n')).resolves.toBe(true);
        const first = await storage.readBoard();
        expect(first?.content).toBe('first\n');
        await expect(storage.writeBoard('stale\n', (first?.mtimeMs ?? 0) - 1))
            .resolves.toBe(false);
        await expect(storage.readBoard()).resolves.toEqual(first);
        await expect(storage.writeBoard('second\n', first?.mtimeMs)).resolves.toBe(true);
        await expect(storage.readBoard()).resolves.toEqual(expect.objectContaining({
            content: 'second\n',
        }));
    });

    it('renders active judgments deterministically by bucket and process id', () => {
        const watchlist: SentinelWatchlist = {
            ...createSentinelWatchlist('sentinel-a', NOW),
            entries: [
                makeEntry('chat-z', { bucket: 'loose-ends', reason: 'Promised\nmore work.' }),
                makeEntry('chat-b'),
                makeEntry('chat-a'),
                makeEntry('chat-muted', { disposition: 'muted' }),
                makeEntry('chat-resolved', { disposition: 'resolved' }),
            ],
        };
        const processes = [
            makeProcess('chat-z', 'Zeta [follow-up]'),
            makeProcess('chat-a', 'Alpha'),
            makeProcess('chat-b', 'Beta'),
        ];

        expect(renderSentinelBoard('workspace-a', watchlist, processes)).toBe(
            '# Sentinel Board\n'
            + '\n'
            + '> Checked items are being watched. Uncheck an item to resolve it, or delete it to mute it.\n'
            + '\n'
            + '## Failed\n'
            + '\n'
            + '- [x] [Alpha](#repos/workspace-a/activity/chat-a) — chat-a needs attention. <!-- sentinel:item:chat-a -->\n'
            + '- [x] [Beta](#repos/workspace-a/activity/chat-b) — chat-b needs attention. <!-- sentinel:item:chat-b -->\n'
            + '\n'
            + '## Loose ends\n'
            + '\n'
            + '- [x] [Zeta \\[follow-up\\]](#repos/workspace-a/activity/chat-z) — Promised more work. <!-- sentinel:item:chat-z -->\n',
        );
    });

    it('maps an unchecked item to resolved and a deleted item to muted', () => {
        const { watchlist, board } = withRenderedBoard([
            makeEntry('chat-resolve'),
            makeEntry('chat-mute'),
            makeEntry('chat-unchanged'),
        ]);
        const edited = board
            .replace('- [x] [chat-resolve]', '- [ ] [chat-resolve]')
            .replace(/^.*sentinel:item:chat-mute.*\n/m, '');

        const result = foldSentinelBoardEdits(watchlist, edited, NOW);

        expect(result.entries).toEqual([
            expect.objectContaining({
                processId: 'chat-resolve',
                disposition: 'resolved',
                resolvedAt: NOW.toISOString(),
            }),
            expect.objectContaining({ processId: 'chat-mute', disposition: 'muted' }),
            expect.objectContaining({ processId: 'chat-unchanged', disposition: 'watching' }),
        ]);
    });

    it('returns the existing watchlist for an unchanged board', () => {
        const { watchlist, board } = withRenderedBoard([makeEntry('chat-a')]);

        expect(foldSentinelBoardEdits(watchlist, board, NOW)).toBe(watchlist);
    });

    it('does not infer edits without a stashed prior render', () => {
        const watchlist = {
            ...createSentinelWatchlist('sentinel-a', NOW),
            entries: [makeEntry('chat-a')],
        };

        expect(foldSentinelBoardEdits(watchlist, '', NOW)).toBe(watchlist);
    });

    it('renders drafts unchecked and detects only a new explicit approval', () => {
        const watchlist = {
            ...createSentinelWatchlist('sentinel-a', NOW),
            entries: [makeEntry('chat-a')],
        };
        const board = renderSentinelBoard(
            'workspace-a',
            watchlist,
            [],
            [{
                processId: 'chat-a',
                action: 'follow-up',
                message: 'Please continue.',
            }],
        );

        expect(board).toContain(
            '  - [ ] **Approve nudge:** Please continue. <!-- sentinel:approve:chat-a -->',
        );
        expect(findNewlyApprovedSentinelNudges(board, board)).toEqual(new Set());
        expect(findNewlyApprovedSentinelNudges(
            board,
            board.replace('  - [ ] **Approve nudge:**', '  - [x] **Approve nudge:**'),
        )).toEqual(new Set(['chat-a']));
    });
});
