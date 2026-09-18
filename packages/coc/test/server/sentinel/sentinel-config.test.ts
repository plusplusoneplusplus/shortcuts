import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    DEFAULT_SENTINEL_CONFIG,
    parseSentinelConfig,
    readSentinelConfig,
} from '../../../src/server/sentinel/sentinel-config';
import { getSentinelWatchlistPath } from '../../../src/server/sentinel/sentinel-watchlist';

const tempDirs: string[] = [];

afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('Sentinel configuration', () => {
    it('loads editable tick, recency, mute, and budget settings', () => {
        expect(parseSentinelConfig(`# Sentinel
tickInterval: 30m
recencyWindow: 2d
mute: [chat-b, chat-a, chat-a]
maxNudgesPerChat: 5
`)).toEqual({
            tickIntervalMs: 30 * 60 * 1_000,
            recencyWindowMs: 2 * 24 * 60 * 60 * 1_000,
            muteProcessIds: ['chat-a', 'chat-b'],
            maxNudgesPerChat: 5,
        });
    });

    it('defaults missing keys and rejects unsafe values', () => {
        expect(parseSentinelConfig('# Sentinel\n')).toEqual(DEFAULT_SENTINEL_CONFIG);
        expect(() => parseSentinelConfig('tickInterval: 5s\n'))
            .toThrow('tickInterval must be at least 10s');
        expect(() => parseSentinelConfig('maxNudgesPerChat: -1\n'))
            .toThrow('maxNudgesPerChat must be a non-negative integer');
        expect(() => parseSentinelConfig('mute: chat-a\n'))
            .toThrow('mute must be a list');
    });

    it('creates the default config once and reads later user edits', async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-config-'));
        tempDirs.push(dataDir);

        await expect(readSentinelConfig(dataDir, 'workspace-a')).resolves.toEqual(
            DEFAULT_SENTINEL_CONFIG,
        );
        const configPath = path.join(
            path.dirname(getSentinelWatchlistPath(dataDir, 'workspace-a')),
            'Sentinel.md',
        );
        fs.writeFileSync(configPath, 'tickInterval: 2h\n', 'utf8');

        await expect(readSentinelConfig(dataDir, 'workspace-a')).resolves.toEqual({
            ...DEFAULT_SENTINEL_CONFIG,
            tickIntervalMs: 2 * 60 * 60 * 1_000,
        });
    });
});
