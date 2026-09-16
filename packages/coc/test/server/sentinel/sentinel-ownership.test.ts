import type { AIProcess } from '@plusplusoneplusplus/forge';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getRepoDataPath } from '../../../src/server/paths';
import {
    claimSentinelOwnership,
    type SentinelOwnershipRecord,
} from '../../../src/server/sentinel/sentinel-ownership';
import { createMockProcessStore } from '../../helpers/mock-process-store';

const NOW = new Date('2026-09-16T20:00:00.000Z');
const tempDirs: string[] = [];

function makeTempDir(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-ownership-'));
    tempDirs.push(directory);
    return directory;
}

function makeSentinelProcess(
    id: string,
    workspaceId: string,
    overrides: Partial<AIProcess> = {},
): AIProcess {
    return {
        id,
        type: 'chat',
        promptPreview: 'Sentinel',
        fullPrompt: 'Sentinel',
        status: 'completed',
        startTime: new Date('2026-09-16T19:00:00.000Z'),
        metadata: { type: 'chat', mode: 'sentinel', workspaceId },
        ...overrides,
    };
}

function watchlistPath(dataDir: string, workspaceId: string): string {
    return path.join(
        getRepoDataPath(dataDir, workspaceId, 'notes'),
        'Sentinel',
        '.watchlist.json',
    );
}

function writeOwner(
    dataDir: string,
    workspaceId: string,
    sentinelProcessId: string,
    claimedAt = '2026-09-16T18:00:00.000Z',
): void {
    const filePath = watchlistPath(dataDir, workspaceId);
    const record: SentinelOwnershipRecord = {
        version: 1,
        sentinelProcessId,
        claimedAt,
        excludedProcessIds: [sentinelProcessId],
        entries: [],
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(record), 'utf8');
}

afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('claimSentinelOwnership', () => {
    it('creates an atomic workspace-scoped ownership marker', async () => {
        const dataDir = makeTempDir();
        const store = createMockProcessStore();

        await expect(claimSentinelOwnership({
            dataDir,
            workspaceId: 'workspace-a',
            processId: 'sentinel-a',
            processStore: store,
            now: () => NOW,
        })).resolves.toEqual({ status: 'claimed' });

        const record = JSON.parse(fs.readFileSync(watchlistPath(dataDir, 'workspace-a'), 'utf8'));
        expect(record).toEqual({
            version: 1,
            sentinelProcessId: 'sentinel-a',
            claimedAt: NOW.toISOString(),
            excludedProcessIds: ['sentinel-a'],
            entries: [],
        });
        expect(fs.existsSync(watchlistPath(dataDir, 'workspace-b'))).toBe(false);
    });

    it('refuses a second claim when the existing owner is live', async () => {
        const dataDir = makeTempDir();
        const owner = makeSentinelProcess('sentinel-a', 'workspace-a');
        const store = createMockProcessStore({ initialProcesses: [owner] });
        writeOwner(dataDir, 'workspace-a', owner.id);

        await expect(claimSentinelOwnership({
            dataDir,
            workspaceId: 'workspace-a',
            processId: 'sentinel-b',
            processStore: store,
            now: () => NOW,
        })).resolves.toEqual({ status: 'existing', processId: owner.id });
    });

    it('temporarily preserves a fresh claim before its process row exists', async () => {
        const dataDir = makeTempDir();
        writeOwner(dataDir, 'workspace-a', 'sentinel-a', NOW.toISOString());

        await expect(claimSentinelOwnership({
            dataDir,
            workspaceId: 'workspace-a',
            processId: 'sentinel-b',
            processStore: createMockProcessStore(),
            now: () => NOW,
        })).resolves.toEqual({ status: 'existing', processId: 'sentinel-a' });
    });

    it.each([
        ['missing', undefined],
        ['archived', { archived: true }],
        ['failed', { status: 'failed' as const }],
        ['cancelled', { status: 'cancelled' as const }],
        ['wrong-workspace', { metadata: { type: 'chat', mode: 'sentinel', workspaceId: 'workspace-b' } }],
        ['non-sentinel', { metadata: { type: 'chat', mode: 'ask', workspaceId: 'workspace-a' } }],
    ])('takes over a %s owner', async (_label, overrides) => {
        const dataDir = makeTempDir();
        const owner = overrides
            ? makeSentinelProcess('sentinel-a', 'workspace-a', overrides)
            : undefined;
        const store = createMockProcessStore({
            initialProcesses: owner ? [owner] : [],
        });
        writeOwner(dataDir, 'workspace-a', 'sentinel-a');

        await expect(claimSentinelOwnership({
            dataDir,
            workspaceId: 'workspace-a',
            processId: 'sentinel-b',
            processStore: store,
            now: () => NOW,
        })).resolves.toEqual({ status: 'claimed', replacedProcessId: 'sentinel-a' });
    });

    it.each(['', '{"sentinelProcessId":'])('reclaims an unreadable watchlist', async (content) => {
        const dataDir = makeTempDir();
        const filePath = watchlistPath(dataDir, 'workspace-a');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');

        await expect(claimSentinelOwnership({
            dataDir,
            workspaceId: 'workspace-a',
            processId: 'sentinel-b',
            processStore: createMockProcessStore(),
            now: () => NOW,
        })).resolves.toEqual({ status: 'claimed' });
    });

    it('allows exactly one winner across concurrent initial claims', async () => {
        const dataDir = makeTempDir();
        const store = createMockProcessStore();
        const options = {
            dataDir,
            workspaceId: 'workspace-a',
            processStore: store,
            now: () => NOW,
        };

        const results = await Promise.all([
            claimSentinelOwnership({ ...options, processId: 'sentinel-a' }),
            claimSentinelOwnership({ ...options, processId: 'sentinel-b' }),
        ]);

        expect(results.filter(result => result.status === 'claimed')).toHaveLength(1);
        expect(results.filter(result => result.status === 'existing')).toHaveLength(1);
    });
});
