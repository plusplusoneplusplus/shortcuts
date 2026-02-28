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

describe('RepoDetail Generate button in header', () => {
    it('imports GenerateTaskDialog', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { GenerateTaskDialog } from '../tasks/GenerateTaskDialog'");
    });

    it('renders generate button in the header row', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-generate-btn"');
    });

    it('generate button appears before edit button', () => {
        const genIdx = REPO_DETAIL_SOURCE.indexOf('repo-generate-btn');
        const editIdx = REPO_DETAIL_SOURCE.indexOf('repo-edit-btn');
        expect(genIdx).toBeLessThan(editIdx);
    });

    it('generate button uses primary variant', () => {
        const line = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('repo-generate-btn'));
        expect(line).toContain('variant="primary"');
    });

    it('passes onOpenGenerateDialog to TasksPanel', () => {
        expect(REPO_DETAIL_SOURCE).toContain('onOpenGenerateDialog={handleOpenGenerateDialog}');
    });

    it('renders GenerateTaskDialog when generateDialog.open is true', () => {
        expect(REPO_DETAIL_SOURCE).toContain('generateDialog.open');
        expect(REPO_DETAIL_SOURCE).toContain('<GenerateTaskDialog');
    });

    it('switches to tasks tab when generate button is clicked', () => {
        expect(REPO_DETAIL_SOURCE).toContain("switchSubTab('tasks')");
    });
});

describe('RepoDetail Queue badge wiring', () => {
    it('imports useRepoQueueStats from hooks', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { useRepoQueueStats } from '../hooks/useRepoQueueStats'");
    });

    it('destructures running, queued, and chatRunning from useRepoQueueStats', () => {
        expect(REPO_DETAIL_SOURCE).toContain('running: queueRunningCount');
        expect(REPO_DETAIL_SOURCE).toContain('queued: queueQueuedCount');
        expect(REPO_DETAIL_SOURCE).toContain('chatRunning: chatRunningCount');
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

    it('does not compute counts from raw repoQueue arrays directly', () => {
        // Counts now come from useRepoQueueStats, not from repoQueue.running.length
        expect(REPO_DETAIL_SOURCE).not.toContain('repoQueue.running.length');
        expect(REPO_DETAIL_SOURCE).not.toContain('repoQueue.queued.length');
    });
});

describe('RepoDetail Chat badge wiring', () => {
    it('renders chat badge only when chatRunningCount > 0', () => {
        expect(REPO_DETAIL_SOURCE).toContain("t.key === 'chat' && chatRunningCount > 0");
    });

    it('chat badge has data-testid for testing', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="chat-running-badge"');
    });

    it('chat badge uses green background for active sessions', () => {
        const chatBadgeLine = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('chat-running-badge'));
        expect(chatBadgeLine).toContain('bg-[#16825d]');
    });

    it('chat badge has title attribute', () => {
        expect(REPO_DETAIL_SOURCE).toContain('title="Active chats"');
    });

    it('chat badge renders after queue badges', () => {
        const queueBadgeIdx = REPO_DETAIL_SOURCE.indexOf('queue-queued-badge');
        const chatBadgeIdx = REPO_DETAIL_SOURCE.indexOf('chat-running-badge');
        expect(chatBadgeIdx).toBeGreaterThan(queueBadgeIdx);
    });

    it('chat badge displays chatRunningCount', () => {
        const chatBadgeLine = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('chat-running-badge'));
        expect(chatBadgeLine).toContain('{chatRunningCount}');
    });
});
