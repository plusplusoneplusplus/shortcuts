/**
 * Tests for RepoDetail SUB_TABS and component wiring.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SUB_TABS } from '../../../src/server/spa/client/react/repos/RepoDetail';

const REPO_DETAIL_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoDetail.tsx'),
    'utf-8',
);

describe('RepoDetail SUB_TABS', () => {
    it('includes a "chat" entry', () => {
        const chatTab = SUB_TABS.find(t => t.key === 'chat');
        expect(chatTab).toBeDefined();
        expect(chatTab!.label).toBe('Chat');
    });

    it('"chat" is the last entry', () => {
        const last = SUB_TABS[SUB_TABS.length - 1];
        expect(last.key).toBe('chat');
    });

    it('has exactly 6 entries', () => {
        expect(SUB_TABS).toHaveLength(6);
    });

    it('contains all expected sub-tabs in order', () => {
        const keys = SUB_TABS.map(t => t.key);
        expect(keys).toEqual(['info', 'pipelines', 'tasks', 'queue', 'schedules', 'chat']);
    });
});

describe('RepoDetail RepoChatTab wiring', () => {
    it('passes ws.rootPath (not ws.path) as workspacePath to RepoChatTab', () => {
        expect(REPO_DETAIL_SOURCE).toContain('workspacePath={ws.rootPath}');
        expect(REPO_DETAIL_SOURCE).not.toContain('workspacePath={ws.path}');
    });
});

describe('RepoDetail Queue badge wiring', () => {
    it('imports useQueue from QueueContext', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { useQueue } from '../context/QueueContext'");
    });

    it('imports fetchApi from useApi hook', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { fetchApi } from '../hooks/useApi'");
    });

    it('derives separate running and queued counts from repoQueueMap', () => {
        expect(REPO_DETAIL_SOURCE).toContain('repoQueue.running.length');
        expect(REPO_DETAIL_SOURCE).toContain('repoQueue.queued.length');
        expect(REPO_DETAIL_SOURCE).toContain('queueRunningCount');
        expect(REPO_DETAIL_SOURCE).toContain('queueQueuedCount');
    });

    it('renders running badge only when queueRunningCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'queue' && queueRunningCount > 0");
    });

    it('renders queued badge only when queueQueuedCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'queue' && queueQueuedCount > 0");
    });

    it('running badge uses green background color', () => {
        expect(REPO_DETAIL_SOURCE).toContain('bg-[#16825d]');
    });

    it('queued badge uses blue background color matching tasks badge', () => {
        const badgeClass = 'bg-[#0078d4] text-white px-1 py-px rounded-full';
        const matches = REPO_DETAIL_SOURCE.split(badgeClass);
        expect(matches.length).toBeGreaterThanOrEqual(3);
    });

    it('running badge has data-testid for testing', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="queue-running-badge"');
    });

    it('queued badge has data-testid for testing', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="queue-queued-badge"');
    });

    it('running badge has title attribute', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Running"');
    });

    it('queued badge has title attribute', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Queued"');
    });

    it('running badge renders before queued badge', () => {
        const runningIdx = REPO_DETAIL_SOURCE.indexOf('queueRunningCount > 0');
        const queuedIdx = REPO_DETAIL_SOURCE.indexOf('queueQueuedCount > 0');
        expect(runningIdx).toBeLessThan(queuedIdx);
    });

    it('seeds repo queue map via useEffect on ws.id change', () => {
        expect(REPO_DETAIL_SOURCE).toContain("fetchApi('/queue?repoId='");
        expect(REPO_DETAIL_SOURCE).toContain("type: 'REPO_QUEUE_UPDATED'");
    });

    it('skips fetch if repoQueueMap already has data for the repo', () => {
        expect(REPO_DETAIL_SOURCE).toContain('if (queueState.repoQueueMap[ws.id]) return');
    });

    it('does not use combined queueCount variable', () => {
        expect(REPO_DETAIL_SOURCE).not.toMatch(/\bqueueCount\b/);
    });
});
