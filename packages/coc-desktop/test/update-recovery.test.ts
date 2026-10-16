import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    PENDING_UPDATE_STALE_MS, clearPendingUpdate, recordPendingUpdate, recoverPendingUpdate,
} from '../src/update-recovery';
import type { ReleaseInfo } from '../src/update-check';

const release: ReleaseInfo = {
    version: '3.5.0', tag: 'v3.5.0', htmlUrl: 'https://github.com/o/r/releases/tag/v3.5.0',
    notes: '', isPrerelease: false,
    assets: [{ name: 'CoC-3.5.0-arm64.dmg', url: 'https://example.test/CoC.dmg' }],
};

let root: string;
let file: string;
let tempDir: string;
const now = 1_800_000_000_000;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-recovery-'));
    file = path.join(root, 'user-data', 'pending-update.json');
    tempDir = path.join(root, 'coc-update-1');
    await fs.mkdir(tempDir);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

async function exists(p: string): Promise<boolean> {
    return fs.stat(p).then(() => true, () => false);
}

function recover(currentVersion = '3.4.0', at = now) {
    return recoverPendingUpdate(file, { currentVersion, now: at });
}

describe('pending update recovery', () => {
    it('returns none without a record', async () => {
        expect(await recover()).toEqual({ state: 'none' });
    });

    it('round-trips the record atomically, creating the data directory', async () => {
        await recordPendingUpdate(file, { release, tempDir, startedAt: now });
        expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ release, tempDir, startedAt: now });
        expect(await fs.readdir(path.dirname(file))).toEqual(['pending-update.json']);
        await clearPendingUpdate(file);
        await clearPendingUpdate(file);
        expect(await exists(file)).toBe(false);
    });

    it('reports a helper error with the original release and removes update files', async () => {
        await recordPendingUpdate(file, { release, tempDir, startedAt: now });
        await fs.writeFile(path.join(tempDir, 'install-error.txt'), 'Windows installer failed with exit code 2.\n');
        expect(await recover('3.4.0', now + 1)).toEqual({
            state: 'failed', release, reason: 'Windows installer failed with exit code 2.',
        });
        expect(await exists(tempDir)).toBe(false);
        expect(await exists(file)).toBe(false);
        expect(await recover()).toEqual({ state: 'none' });
    });

    it('uses a generic reason for an empty error file', async () => {
        await recordPendingUpdate(file, { release, tempDir, startedAt: now });
        await fs.writeFile(path.join(tempDir, 'install-error.txt'), '');
        expect(await recover()).toMatchObject({ state: 'failed', reason: 'The update installer failed.' });
    });

    it('treats a removed download directory as success', async () => {
        await recordPendingUpdate(file, { release, tempDir, startedAt: now });
        await fs.rm(tempDir, { recursive: true });
        expect(await recover('3.5.0')).toEqual({ state: 'succeeded' });
        expect(await exists(file)).toBe(false);
    });

    it('leaves an in-progress install untouched while the helper may still clean up', async () => {
        await fs.writeFile(path.join(tempDir, 'CoC-Setup.exe'), 'installer');
        await recordPendingUpdate(file, { release, tempDir, startedAt: now });
        expect(await recover('3.5.0', now + 1000)).toEqual({ state: 'installing' });
        expect(await exists(path.join(tempDir, 'CoC-Setup.exe'))).toBe(true);
        expect(await exists(file)).toBe(true);
        // Helper cleanup finishes later; the next launch reports success.
        await fs.rm(tempDir, { recursive: true });
        expect(await recover('3.5.0', now + 2000)).toEqual({ state: 'succeeded' });
    });

    it('cleans a stale record as success when the new version is running', async () => {
        await recordPendingUpdate(file, { release, tempDir, startedAt: now });
        expect(await recover('3.5.0', now + PENDING_UPDATE_STALE_MS)).toEqual({ state: 'succeeded' });
        expect(await exists(tempDir)).toBe(false);
    });

    it('reports a stale record on the old version as a failure', async () => {
        await recordPendingUpdate(file, { release, tempDir, startedAt: now });
        expect(await recover('3.4.0', now + PENDING_UPDATE_STALE_MS)).toEqual({
            state: 'failed', release, reason: 'The update helper stopped before installing the update.',
        });
        expect(await exists(tempDir)).toBe(false);
        expect(await exists(file)).toBe(false);
    });

    it('removes macOS staging after a failure when no image or previous app remains', async () => {
        const stageDir = path.join(root, 'Applications', '.coc-update-x');
        await fs.mkdir(path.join(stageDir, 'image'), { recursive: true });
        await fs.mkdir(path.join(stageDir, 'CoC.app'));
        await recordPendingUpdate(file, { release, tempDir, stageDir, startedAt: now });
        await fs.writeFile(path.join(tempDir, 'install-error.txt'), 'Timed out waiting for CoC to quit.');
        expect(await recover()).toEqual({ state: 'failed', release, reason: 'Timed out waiting for CoC to quit.' });
        expect(await exists(stageDir)).toBe(false);
    });

    it('keeps staging whose image directory is not empty (still mounted)', async () => {
        const stageDir = path.join(root, 'Applications', '.coc-update-x');
        await fs.mkdir(path.join(stageDir, 'image', 'CoC.app'), { recursive: true });
        await recordPendingUpdate(file, { release, tempDir, stageDir, startedAt: now });
        await fs.writeFile(path.join(tempDir, 'install-error.txt'), 'Could not install the staged app bundle.');
        expect(await recover()).toEqual({
            state: 'failed', release,
            reason: `Could not install the staged app bundle.\nUpdate files were kept at ${stageDir}.`,
        });
        expect(await exists(path.join(stageDir, 'image', 'CoC.app'))).toBe(true);
        expect(await exists(file)).toBe(false);
    });

    it('keeps an unrestored previous app and reports where it is', async () => {
        const stageDir = path.join(root, 'Applications', '.coc-update-x');
        const previous = path.join(stageDir, 'previous.app');
        await fs.mkdir(previous, { recursive: true });
        await recordPendingUpdate(file, { release, tempDir, stageDir, startedAt: now });
        await fs.writeFile(path.join(tempDir, 'install-error.txt'),
            'Update failed and the previous app could not be restored.');
        expect(await recover()).toEqual({
            state: 'failed', release,
            reason: `Update failed and the previous app could not be restored.\nThe previous app was kept at ${previous}.`,
        });
        expect(await exists(previous)).toBe(true);
    });

    it.each([
        'not json',
        JSON.stringify({ release, tempDir: 'relative', startedAt: now }),
        JSON.stringify({ release: { tag: 'v1' }, tempDir: '/tmp/x', startedAt: now }),
        JSON.stringify({ release, tempDir: '/tmp/x', stageDir: 'relative', startedAt: now }),
    ])('discards an invalid record without touching files (%s)', async text => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, text);
        expect(await recover()).toEqual({ state: 'none' });
        expect(await exists(file)).toBe(false);
        expect(await exists(tempDir)).toBe(true);
    });
});
