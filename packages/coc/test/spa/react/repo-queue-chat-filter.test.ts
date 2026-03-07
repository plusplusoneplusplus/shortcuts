/**
 * Tests for Queue tab chat-type task inclusion.
 *
 * Verifies that RepoQueueTab includes tasks with `type === 'chat'` in
 * running, queued, and history lists — with a 💬 icon and Chat filter option.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_QUEUE_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoQueueTab.tsx'
);

const ACTIVITY_LIST_PANE_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'ActivityListPane.tsx'
);

describe('RepoQueueTab chat-type task inclusion', () => {
    let source: string;
    let listPaneSource: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_QUEUE_TAB_PATH, 'utf-8');
        listPaneSource = fs.readFileSync(ACTIVITY_LIST_PANE_PATH, 'utf-8');
    });

    describe('no isNonChat filter', () => {
        it('does not define isNonChat filter predicate', () => {
            expect(source).not.toContain('const isNonChat');
        });

        it('does not call .filter(isNonChat) anywhere', () => {
            expect(source).not.toContain('.filter(isNonChat)');
        });
    });

    describe('HTTP fetch includes chat tasks', () => {
        it('sets running tasks from HTTP response without filtering', () => {
            const fetchIdx = source.indexOf('const fetchQueue');
            const fetchBlock = source.slice(fetchIdx, source.indexOf('setLoading(false)', fetchIdx) + 50);
            expect(fetchBlock).toContain("data?.running || []");
            expect(fetchBlock).not.toContain("filter(isNonChat)");
        });

        it('sets queued tasks from HTTP response without filtering', () => {
            const fetchIdx = source.indexOf('const fetchQueue');
            const fetchBlock = source.slice(fetchIdx, source.indexOf('setLoading(false)', fetchIdx) + 50);
            expect(fetchBlock).toContain("data?.queued || []");
            expect(fetchBlock).not.toContain("filter(isNonChat)");
        });

        it('sets history tasks from HTTP response without filtering', () => {
            const fetchIdx = source.indexOf('const fetchQueue');
            const fetchBlock = source.slice(fetchIdx, source.indexOf('setLoading(false)', fetchIdx) + 50);
            expect(fetchBlock).toContain("historyData?.history || []");
            expect(fetchBlock).not.toContain("filter(isNonChat)");
        });
    });

    describe('WebSocket updates include chat tasks', () => {
        it('sets running tasks from repoQueue WS updates without filtering', () => {
            const wsIdx = source.indexOf('Apply per-repo WS updates');
            const wsBlock = source.slice(wsIdx, wsIdx + 400);
            expect(wsBlock).toContain('setRunning(repoQueue.running)');
            expect(wsBlock).not.toContain('filter(isNonChat)');
        });

        it('sets queued tasks from repoQueue WS updates without filtering', () => {
            const wsIdx = source.indexOf('Apply per-repo WS updates');
            const wsBlock = source.slice(wsIdx, wsIdx + 400);
            expect(wsBlock).toContain('setQueued(repoQueue.queued)');
            expect(wsBlock).not.toContain('filter(isNonChat)');
        });

        it('sets history tasks from repoQueue WS updates without filtering', () => {
            const wsIdx = source.indexOf('Apply per-repo WS updates');
            const wsBlock = source.slice(wsIdx, wsIdx + 400);
            expect(wsBlock).toContain('setHistory(repoQueue.history)');
            expect(wsBlock).not.toContain('filter(isNonChat)');
        });
    });

    describe('chat type in TASK_TYPE_LABELS', () => {
        it('includes chat as a primary filter option', () => {
            const labelsIdx = listPaneSource.indexOf('TASK_TYPE_LABELS');
            const labelsBlock = listPaneSource.slice(labelsIdx, listPaneSource.indexOf('};', labelsIdx) + 2);
            expect(labelsBlock).toContain("'chat'");
            expect(labelsBlock).toContain("'Chat'");
        });
    });

    describe('chat icon in QueueTaskItem', () => {
        it('uses getTaskTypeIcon(task) for icons in QueueTaskItem', () => {
            const itemIdx = listPaneSource.indexOf('function QueueTaskItem');
            const itemBlock = listPaneSource.slice(itemIdx, itemIdx + 500);
            expect(itemBlock).toContain('getTaskTypeIcon(task)');
        });

        it('getTaskTypeIcon maps chat type to 💬', () => {
            const helperIdx = listPaneSource.indexOf('function getTaskTypeIcon');
            const helperBlock = listPaneSource.slice(helperIdx, helperIdx + 600);
            expect(helperBlock).toContain("'chat'");
            expect(helperBlock).toContain("'💬'");
        });
    });

    describe('chat icon in history section', () => {
        it('uses getTaskTypeIcon(task) for icons in history list', () => {
            const historyIdx = listPaneSource.indexOf('Completed Tasks');
            const historyBlock = listPaneSource.slice(historyIdx, historyIdx + 1200);
            expect(historyBlock).toContain('getTaskTypeIcon(task)');
        });
    });

    describe('getTaskTypeIcon helper', () => {
        it('defines getTaskTypeIcon function in the source', () => {
            expect(listPaneSource).toContain('function getTaskTypeIcon');
        });

        it('maps follow-prompt with skillName to 🔧', () => {
            const helperIdx = listPaneSource.indexOf('function getTaskTypeIcon');
            const helperBlock = listPaneSource.slice(helperIdx, helperIdx + 600);
            expect(helperBlock).toContain("'🔧'");
            expect(helperBlock).toContain('skillName');
        });

        it('maps follow-prompt with promptFilePath to ↩️', () => {
            const helperIdx = listPaneSource.indexOf('function getTaskTypeIcon');
            const helperBlock = listPaneSource.slice(helperIdx, helperIdx + 600);
            expect(helperBlock).toContain("'↩️'");
            expect(helperBlock).toContain('promptFilePath');
        });

        it('maps code-review to 🔍', () => {
            const helperIdx = listPaneSource.indexOf('function getTaskTypeIcon');
            const helperBlock = listPaneSource.slice(helperIdx, helperIdx + 600);
            expect(helperBlock).toContain("'code-review'");
            expect(helperBlock).toContain("'🔍'");
        });

        it('maps run-workflow to ▶️', () => {
            const helperIdx = listPaneSource.indexOf('function getTaskTypeIcon');
            const helperBlock = listPaneSource.slice(helperIdx, helperIdx + 900);
            expect(helperBlock).toContain("'run-workflow'");
            expect(helperBlock).toContain("'▶️'");
        });

        it('has fallback icon 🤖 for unknown types', () => {
            const helperIdx = listPaneSource.indexOf('function getTaskTypeIcon');
            const helperBlock = listPaneSource.slice(helperIdx, helperIdx + 900);
            expect(helperBlock).toContain("'🤖'");
        });
    });

    describe('chat task click navigates to Chat tab', () => {
        it('imports useApp from AppContext', () => {
            expect(source).toContain("import { useApp } from '../context/AppContext'");
        });

        it('dispatches SET_SELECTED_CHAT_SESSION for chat tasks', () => {
            expect(source).toContain("type: 'SET_SELECTED_CHAT_SESSION'");
        });

        it('dispatches SET_REPO_SUB_TAB to switch to chat tab', () => {
            expect(source).toContain("type: 'SET_REPO_SUB_TAB'");
        });

        it('navigates to chat hash route for chat tasks', () => {
            const selectIdx = source.indexOf('const selectTask');
            const selectBlock = source.slice(selectIdx, selectIdx + 600);
            expect(selectBlock).toContain("/chat/");
        });
    });
});
