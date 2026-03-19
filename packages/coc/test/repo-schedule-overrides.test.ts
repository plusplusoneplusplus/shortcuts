/**
 * Tests for repo-schedule-overrides.ts
 *
 * Covers: load/save overrides, setStatus, missing file, cross-platform path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RepoScheduleOverrideStore } from '../src/server/repo-schedule-overrides';

describe('RepoScheduleOverrideStore', () => {
    let dataDir: string;
    let store: RepoScheduleOverrideStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-overrides-test-'));
        store = new RepoScheduleOverrideStore(dataDir);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('returns empty object when override file does not exist', () => {
        const result = store.load('repo-1');
        expect(result).toEqual({});
    });

    it('saves and loads overrides', () => {
        store.save('repo-1', { 'repo:daily': { status: 'paused' } });
        const result = store.load('repo-1');
        expect(result['repo:daily']).toEqual({ status: 'paused' });
    });

    it('setStatus creates and updates override entry', () => {
        store.setStatus('repo-1', 'repo:daily', 'paused');
        expect(store.load('repo-1')['repo:daily'].status).toBe('paused');

        store.setStatus('repo-1', 'repo:daily', 'active');
        expect(store.load('repo-1')['repo:daily'].status).toBe('active');
    });

    it('setStatus preserves other entries', () => {
        store.setStatus('repo-1', 'repo:daily', 'paused');
        store.setStatus('repo-1', 'repo:weekly', 'active');
        const overrides = store.load('repo-1');
        expect(overrides['repo:daily'].status).toBe('paused');
        expect(overrides['repo:weekly'].status).toBe('active');
    });

    it('is scoped per repoId', () => {
        store.setStatus('repo-1', 'repo:daily', 'paused');
        store.setStatus('repo-2', 'repo:daily', 'active');
        expect(store.load('repo-1')['repo:daily'].status).toBe('paused');
        expect(store.load('repo-2')['repo:daily'].status).toBe('active');
    });

    it('returns empty object when override file contains invalid JSON', () => {
        const reposDir = path.join(dataDir, 'repos', 'repo-bad');
        fs.mkdirSync(reposDir, { recursive: true });
        fs.writeFileSync(path.join(reposDir, 'repo-schedule-overrides.json'), '{not valid json', 'utf-8');
        expect(store.load('repo-bad')).toEqual({});
    });
});
