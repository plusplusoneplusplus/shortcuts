/**
 * Tests for RepoQueueTab per-repo pause/resume UI.
 *
 * Static source analysis tests verifying:
 *   - isPaused state declarations and dual-source wiring (HTTP + WebSocket)
 *   - handlePauseResume handler uses fetchApi with correct endpoints
 *   - Toolbar renders pause/resume button with correct data-testid
 *   - Empty state is pause-aware with resume button
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_QUEUE_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoQueueTab.tsx'
);

describe('RepoQueueTab pause/resume', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_QUEUE_TAB_PATH, 'utf-8');
    });

    describe('state declarations', () => {
        it('declares isPaused state initialized to false', () => {
            expect(source).toContain('useState(false)');
            expect(source).toContain('isPaused');
            expect(source).toContain('setIsPaused');
        });

        it('declares isPauseResumeLoading state', () => {
            expect(source).toContain('isPauseResumeLoading');
            expect(source).toContain('setIsPauseResumeLoading');
        });
    });

    describe('isPaused wiring', () => {
        it('sets isPaused from HTTP fetch response (stats?.isPaused)', () => {
            expect(source).toContain('stats?.isPaused');
            // Verify setIsPaused is called with the fetch result
            expect(source).toMatch(/setIsPaused\(.*stats\?\.isPaused/);
        });

        it('sets isPaused from WebSocket context (repoQueue?.stats?.isPaused)', () => {
            expect(source).toContain('repoQueue?.stats?.isPaused');
            // Verify the WebSocket effect updates isPaused
            expect(source).toMatch(/repoQueue\?\.stats\?\.isPaused !== undefined/);
        });
    });

    describe('handlePauseResume handler', () => {
        it('defines handlePauseResume function', () => {
            expect(source).toContain('handlePauseResume');
        });

        it('calls /queue/pause endpoint', () => {
            expect(source).toContain("'/queue/pause'");
        });

        it('calls /queue/resume endpoint', () => {
            expect(source).toContain("'/queue/resume'");
        });

        it('passes repoId query parameter via workspaceId', () => {
            // The handler should append ?repoId= to the endpoint
            expect(source).toMatch(/\?repoId=/);
        });

        it('uses fetchApi (not raw fetch + getApiBase) for pause/resume', () => {
            // Find the handlePauseResume function body
            const fnStart = source.indexOf('handlePauseResume');
            const fnBody = source.slice(fnStart, fnStart + 400);
            expect(fnBody).toContain('fetchApi');
            expect(fnBody).toContain("method: 'POST'");
        });

        it('calls fetchQueue after the API call to refresh state', () => {
            const fnStart = source.indexOf('handlePauseResume');
            const fnBody = source.slice(fnStart, fnStart + 400);
            expect(fnBody).toContain('fetchQueue()');
        });

        it('resets isPauseResumeLoading in finally block', () => {
            const fnStart = source.indexOf('handlePauseResume');
            const fnBody = source.slice(fnStart, fnStart + 400);
            expect(fnBody).toContain('finally');
            expect(fnBody).toContain('setIsPauseResumeLoading(false)');
        });
    });

    describe('toolbar UI', () => {
        it('renders pause/resume button with distinct data-testid', () => {
            expect(source).toContain('data-testid="repo-pause-resume-btn"');
        });

        it('does not use the global pause-resume-btn testid', () => {
            // All occurrences should be prefixed with "repo-"
            const matches = source.match(/data-testid="pause-resume-btn"/g);
            expect(matches).toBeNull();
        });

        it('shows Paused badge when isPaused is true', () => {
            expect(source).toContain('isPaused && <Badge');
            expect(source).toContain('Paused');
        });

        it('toolbar visibility depends on isPaused or active queue items', () => {
            expect(source).toContain('isPaused || running.length > 0 || queued.length > 0');
        });

        it('button shows ▶ when paused and ⏸ when running', () => {
            // Check the ternary for button content
            expect(source).toMatch(/isPaused \? '▶' : '⏸'/);
        });

        it('button is disabled during loading', () => {
            expect(source).toContain('disabled={isPauseResumeLoading}');
        });
    });

    describe('empty state', () => {
        it('has pause-aware empty state with repo-pause-resume-btn-empty testid', () => {
            expect(source).toContain('data-testid="repo-pause-resume-btn-empty"');
        });

        it('shows "Queue is paused" message when paused', () => {
            expect(source).toContain('Queue is paused');
        });

        it('shows "No tasks in queue" when not paused', () => {
            expect(source).toContain('No tasks in queue');
        });

        it('shows resume button in empty paused state', () => {
            // The empty state resume button text
            expect(source).toContain('▶ Resume');
        });
    });
});
