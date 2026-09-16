import type { AIProcess } from '@plusplusoneplusplus/forge';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    createSentinelWatchlist,
    getSentinelWatchlistPath,
    persistSentinelClassification,
    readSentinelWatchlist,
    reconcileSentinelWatchlist,
    SENTINEL_WATCHLIST_VERSION,
    writeSentinelWatchlist,
    type SentinelWatchlist,
} from '../../../src/server/sentinel/sentinel-watchlist';
import { createMockProcessStore } from '../../helpers/mock-process-store';

const NOW = new Date('2026-09-16T21:00:00.000Z');
const tempDirs: string[] = [];

function makeTempDir(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-watchlist-'));
    tempDirs.push(directory);
    return directory;
}

function makeProcess(id: string, overrides: Partial<AIProcess> = {}): AIProcess {
    return {
        id,
        type: 'chat',
        promptPreview: id,
        fullPrompt: id,
        status: 'completed',
        startTime: new Date('2026-09-16T19:00:00.000Z'),
        metadata: { type: 'chat', mode: 'ask', workspaceId: 'workspace-a' },
        ...overrides,
    };
}

afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('Sentinel watchlist persistence', () => {
    it('round-trips judgment state through an atomic write', async () => {
        const dataDir = makeTempDir();
        const watchlist: SentinelWatchlist = {
            ...createSentinelWatchlist('sentinel-a', NOW),
            excludedProcessIds: ['child-a', 'sentinel-a'],
            entries: [{
                processId: 'chat-a',
                bucket: 'failed',
                disposition: 'nudged',
                reason: 'The chat failed.',
                nudgeCount: 2,
                lastNudgedAt: '2026-09-16T20:00:00.000Z',
                snoozedUntil: '2026-09-17T20:00:00.000Z',
                addedAt: '2026-09-15T20:00:00.000Z',
            }],
        };

        await writeSentinelWatchlist(dataDir, 'workspace-a', watchlist);

        await expect(readSentinelWatchlist(dataDir, 'workspace-a')).resolves.toEqual(watchlist);
        expect(fs.readdirSync(path.dirname(getSentinelWatchlistPath(dataDir, 'workspace-a'))))
            .toEqual(['.watchlist.json']);
    });

    it.each(['', '{"sentinelProcessId":'])(
        'treats an absent, empty, or truncated watchlist as unclaimed',
        async (content) => {
            const dataDir = makeTempDir();
            await expect(readSentinelWatchlist(dataDir, 'workspace-a')).resolves.toBeUndefined();
            const filePath = getSentinelWatchlistPath(dataDir, 'workspace-a');
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content, 'utf8');
            await expect(readSentinelWatchlist(dataDir, 'workspace-a')).resolves.toBeUndefined();
        },
    );

    it('loads a version 1 record with missing judgment fields using safe defaults', async () => {
        const dataDir = makeTempDir();
        const filePath = getSentinelWatchlistPath(dataDir, 'workspace-a');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify({
            version: 1,
            sentinelProcessId: 'sentinel-a',
            claimedAt: '2026-09-15T20:00:00.000Z',
            entries: [{ processId: 'chat-a', reason: 'Needs attention.' }],
        }), 'utf8');

        await expect(readSentinelWatchlist(dataDir, 'workspace-a')).resolves.toEqual({
            version: SENTINEL_WATCHLIST_VERSION,
            sentinelProcessId: 'sentinel-a',
            claimedAt: '2026-09-15T20:00:00.000Z',
            excludedProcessIds: ['sentinel-a'],
            entries: [{
                processId: 'chat-a',
                bucket: 'loose-ends',
                disposition: 'watching',
                reason: 'Needs attention.',
                nudgeCount: 0,
                addedAt: '2026-09-15T20:00:00.000Z',
            }],
        });
    });

    it('round-trips the last rendered board used for restart-safe edit comparison', async () => {
        const dataDir = makeTempDir();
        const watchlist = {
            ...createSentinelWatchlist('sentinel-a', NOW),
            lastRenderedBoard: '# Sentinel Board\n',
        };

        await writeSentinelWatchlist(dataDir, 'workspace-a', watchlist);

        await expect(readSentinelWatchlist(dataDir, 'workspace-a')).resolves.toEqual(watchlist);
    });

    it('evicts missing, archived, and long-resolved entries while retaining recent judgments', () => {
        const watchlist: SentinelWatchlist = {
            ...createSentinelWatchlist('sentinel-a', NOW),
            entries: [
                {
                    processId: 'missing',
                    bucket: 'failed',
                    disposition: 'watching',
                    reason: 'Missing',
                    nudgeCount: 0,
                    addedAt: '2026-09-01T00:00:00.000Z',
                },
                {
                    processId: 'archived',
                    bucket: 'failed',
                    disposition: 'watching',
                    reason: 'Archived',
                    nudgeCount: 0,
                    addedAt: '2026-09-01T00:00:00.000Z',
                },
                {
                    processId: 'old-resolved',
                    bucket: 'loose-ends',
                    disposition: 'resolved',
                    reason: 'Resolved',
                    nudgeCount: 0,
                    addedAt: '2026-07-01T00:00:00.000Z',
                    resolvedAt: '2026-07-02T00:00:00.000Z',
                },
                {
                    processId: 'muted',
                    bucket: 'done-unread',
                    disposition: 'muted',
                    reason: 'Muted',
                    nudgeCount: 1,
                    addedAt: '2026-07-01T00:00:00.000Z',
                },
            ],
        };

        const reconciled = reconcileSentinelWatchlist(
            watchlist,
            { excludedProcessIds: ['sentinel-a'], entries: [] },
            [
                makeProcess('archived', { archived: true }),
                makeProcess('old-resolved'),
                makeProcess('muted'),
            ],
            NOW,
        );

        expect(reconciled.entries).toEqual([expect.objectContaining({
            processId: 'muted',
            disposition: 'muted',
            nudgeCount: 1,
        })]);
    });

    it('refreshes classifications without losing user intent or nudge history', () => {
        const watchlist: SentinelWatchlist = {
            ...createSentinelWatchlist('sentinel-a', NOW),
            entries: [{
                processId: 'chat-a',
                bucket: 'failed',
                disposition: 'muted',
                reason: 'Old reason.',
                nudgeCount: 2,
                lastNudgedAt: '2026-09-16T20:00:00.000Z',
                addedAt: '2026-09-15T20:00:00.000Z',
            }],
        };

        const reconciled = reconcileSentinelWatchlist(
            watchlist,
            {
                excludedProcessIds: ['sentinel-a'],
                entries: [{
                    processId: 'chat-a',
                    bucket: 'blocked-on-you',
                    reason: 'Waiting for your answer.',
                }],
            },
            [makeProcess('chat-a')],
            NOW,
        );

        expect(reconciled.entries).toEqual([{
            processId: 'chat-a',
            bucket: 'blocked-on-you',
            disposition: 'muted',
            reason: 'Waiting for your answer.',
            nudgeCount: 2,
            lastNudgedAt: '2026-09-16T20:00:00.000Z',
            addedAt: '2026-09-15T20:00:00.000Z',
        }]);
    });

    it('persists classifications as judgments without copying mutable process facts', async () => {
        const dataDir = makeTempDir();
        await writeSentinelWatchlist(
            dataDir,
            'workspace-a',
            createSentinelWatchlist('sentinel-a', NOW),
        );
        const process = makeProcess('chat-a', {
            status: 'failed',
            stale: true,
            archived: false,
            lastEventAt: new Date('2026-09-16T20:30:00.000Z'),
        });

        const result = await persistSentinelClassification({
            dataDir,
            workspaceId: 'workspace-a',
            sentinelProcessId: 'sentinel-a',
            processStore: createMockProcessStore({ initialProcesses: [process] }),
            classification: {
                excludedProcessIds: ['child-a', 'sentinel-a'],
                entries: [{
                    processId: 'chat-a',
                    bucket: 'failed',
                    reason: 'The chat was marked stale.',
                }],
            },
            now: NOW,
        });

        expect(result).toEqual({
            version: SENTINEL_WATCHLIST_VERSION,
            sentinelProcessId: 'sentinel-a',
            claimedAt: NOW.toISOString(),
            excludedProcessIds: ['child-a', 'sentinel-a'],
            entries: [{
                processId: 'chat-a',
                bucket: 'failed',
                disposition: 'watching',
                reason: 'The chat was marked stale.',
                nudgeCount: 0,
                addedAt: NOW.toISOString(),
            }],
        });
        const serialized = fs.readFileSync(
            getSentinelWatchlistPath(dataDir, 'workspace-a'),
            'utf8',
        );
        expect(serialized).not.toMatch(/"status"|"stale"|"archived"|"lastEventAt"|"seenAt"/);
    });

    it('does not overwrite a missing or replacement owner during a tick', async () => {
        const dataDir = makeTempDir();
        const store = createMockProcessStore({ initialProcesses: [makeProcess('chat-a')] });
        const classification = {
            excludedProcessIds: ['sentinel-old'],
            entries: [{
                processId: 'chat-a',
                bucket: 'loose-ends' as const,
                reason: 'Follow-up was promised.',
            }],
        };

        await expect(persistSentinelClassification({
            dataDir,
            workspaceId: 'workspace-a',
            sentinelProcessId: 'sentinel-old',
            processStore: store,
            classification,
            now: NOW,
        })).resolves.toBeUndefined();

        await writeSentinelWatchlist(
            dataDir,
            'workspace-a',
            createSentinelWatchlist('sentinel-new', NOW),
        );
        await expect(persistSentinelClassification({
            dataDir,
            workspaceId: 'workspace-a',
            sentinelProcessId: 'sentinel-old',
            processStore: store,
            classification,
            now: NOW,
        })).resolves.toBeUndefined();
        await expect(readSentinelWatchlist(dataDir, 'workspace-a')).resolves.toEqual(
            createSentinelWatchlist('sentinel-new', NOW),
        );
    });
});
