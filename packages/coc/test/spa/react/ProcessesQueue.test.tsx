/**
 * Tests for React Processes and Queue components.
 * Verifies rendering, filtering, and interaction behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { ProcessFilters } from '../../../src/server/spa/client/react/processes/ProcessFilters';
import { ProcessesSidebar } from '../../../src/server/spa/client/react/processes/ProcessesSidebar';
import { ProcessDetail } from '../../../src/server/spa/client/react/processes/ProcessDetail';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/processes/ConversationTurnBubble';
import { ProcessesView } from '../../../src/server/spa/client/react/processes/ProcessesView';
import { ToolCallView } from '../../../src/server/spa/client/react/processes/ToolCallView';
import { MarkdownView } from '../../../src/server/spa/client/react/processes/MarkdownView';
// QueuePanel merged into ProcessesSidebar
import { QueueView } from '../../../src/server/spa/client/react/queue/QueueView';
import { ActivityChatDetail } from '../../../src/server/spa/client/react/repos/ActivityChatDetail';

// Mock useDisplaySettings — controls report_intent visibility
const mockDisplaySettings = { showReportIntent: false };
vi.mock('../../../src/server/spa/client/react/hooks/useDisplaySettings', () => ({
    useDisplaySettings: () => mockDisplaySettings,
    invalidateDisplaySettings: vi.fn(),
}));

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider><QueueProvider>{children}</QueueProvider></AppProvider>;
}

function SeededProcessList({ processes, workspaces }: { processes: any[]; workspaces?: any[] }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_PROCESSES', processes });
        if (workspaces) {
            dispatch({ type: 'WORKSPACES_LOADED', workspaces });
        }
    }, [dispatch, processes, workspaces]);
    return <ProcessesSidebar />;
}

function SeededProcessDetail({ process, workspaces }: { process: any; workspaces?: any[] }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_PROCESSES', processes: [process] });
        dispatch({ type: 'SELECT_PROCESS', id: process.id });
        if (workspaces) {
            dispatch({ type: 'WORKSPACES_LOADED', workspaces });
        }
    }, [dispatch, process, workspaces]);
    return <ProcessDetail />;
}

function SeededQueuePanel({ historyItem }: { historyItem: any }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'SET_HISTORY', history: [historyItem] });
        dispatch({ type: 'TOGGLE_HISTORY' });
    }, [dispatch, historyItem]);
    return <ProcessesSidebar />;
}

function SeededQueueTaskDetail({ task }: { task: any }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'SET_HISTORY', history: [task] });
        dispatch({ type: 'SELECT_QUEUE_TASK', id: task.id });
    }, [dispatch, task]);
    return <ActivityChatDetail taskId={task.id} />;
}

describe('ProcessFilters', () => {
    it('renders search input', () => {
        render(<Wrap><ProcessFilters /></Wrap>);
        expect(screen.getByPlaceholderText('Search processes...')).toBeDefined();
    });

    it('renders status filter with all options', () => {
        render(<Wrap><ProcessFilters /></Wrap>);
        expect(screen.getByDisplayValue('All Statuses')).toBeDefined();
    });
});

describe('ProcessesSidebar (legacy process list)', () => {
    it('shows empty state when no processes', () => {
        render(<Wrap><ProcessesSidebar /></Wrap>);
        expect(screen.getByText('No processes yet')).toBeDefined();
    });

    it('updates hash route when selecting a process', async () => {
        window.location.hash = '#processes';
        render(
            <Wrap>
                <SeededProcessList
                    processes={[
                        { id: 'proc-route-1', status: 'completed', promptPreview: 'Route me to process detail' },
                    ]}
                />
            </Wrap>
        );

        const processCardText = await screen.findByText('Route me to process detail');
        fireEvent.click(processCardText);
        expect(window.location.hash).toBe('#process/proc-route-1');
    });

    it('shows repo name when process has workspaceId and workspaces are loaded', async () => {
        render(
            <Wrap>
                <SeededProcessList
                    processes={[
                        { id: 'proc-ws-1', status: 'completed', promptPreview: 'Test with repo', workspaceId: 'ws-abc' },
                    ]}
                    workspaces={[
                        { id: 'ws-abc', name: 'my-project', rootPath: '/home/user/my-project' },
                    ]}
                />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('my-project')).toBeDefined();
        });
        const repoButton = screen.getByTitle('Go to repo: my-project');
        expect(repoButton).toBeDefined();
    });

    it('repo name click navigates to repo page without selecting process', async () => {
        window.location.hash = '#processes';
        render(
            <Wrap>
                <SeededProcessList
                    processes={[
                        { id: 'proc-ws-nav', status: 'completed', promptPreview: 'Nav test', workspaceId: 'ws-nav' },
                    ]}
                    workspaces={[
                        { id: 'ws-nav', name: 'nav-project', rootPath: '/tmp/nav' },
                    ]}
                />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('nav-project')).toBeDefined();
        });
        fireEvent.click(screen.getByTitle('Go to repo: nav-project'));
        expect(window.location.hash).toBe('#repos/ws-nav');
    });

    it('does not show repo name when process has no workspaceId', async () => {
        render(
            <Wrap>
                <SeededProcessList
                    processes={[
                        { id: 'proc-no-ws', status: 'completed', promptPreview: 'No workspace' },
                    ]}
                    workspaces={[
                        { id: 'ws-abc', name: 'my-project', rootPath: '/home/user/my-project' },
                    ]}
                />
            </Wrap>
        );

        await screen.findByText('No workspace');
        expect(screen.queryByTitle(/Go to repo/)).toBeNull();
    });

    it('falls back to metadata.workspaceId for repo name', async () => {
        render(
            <Wrap>
                <SeededProcessList
                    processes={[
                        { id: 'proc-meta-ws', status: 'completed', promptPreview: 'Metadata ws', metadata: { workspaceId: 'ws-meta' } },
                    ]}
                    workspaces={[
                        { id: 'ws-meta', name: 'meta-project', rootPath: '/tmp/meta' },
                    ]}
                />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('meta-project')).toBeDefined();
        });
    });

    it('falls back to raw workspace ID when workspace not in list', async () => {
        render(
            <Wrap>
                <SeededProcessList
                    processes={[
                        { id: 'proc-unknown-ws', status: 'completed', promptPreview: 'Unknown ws', workspaceId: 'ws-unknown-id' },
                    ]}
                    workspaces={[]}
                />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('ws-unknown-id')).toBeDefined();
        });
    });
});

describe('ProcessDetail', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('shows empty state when no process selected', () => {
        render(<Wrap><ProcessDetail /></Wrap>);
        expect(screen.getByText('Select a process to view details')).toBeDefined();
    });

    it('toggles conversation metadata popover with model and session info', async () => {
        const processId = 'proc-meta-1';
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                process: {
                    id: processId,
                    type: 'clarification',
                    status: 'completed',
                    startTime: '2026-02-19T08:58:31.000Z',
                    endTime: '2026-02-19T08:58:35.000Z',
                    sdkSessionId: 'sess-meta-123',
                    metadata: { model: 'claude-haiku-4.5' },
                    conversationTurns: [
                        { role: 'user', content: "what's the time now?", timeline: [] },
                        { role: 'assistant', content: "It's 08:58 UTC", timeline: [] },
                    ],
                },
            }),
        });
        (global as any).fetch = fetchMock;

        render(
            <Wrap>
                <SeededProcessDetail
                    process={{
                        id: processId,
                        status: 'completed',
                        type: 'clarification',
                        promptPreview: "what's the time now?",
                    }}
                />
            </Wrap>
        );

        await screen.findByText("what's the time now?");
        const toggle = screen.getByRole('button', { name: 'Show conversation metadata' });
        fireEvent.click(toggle);

        expect(screen.getByText('Conversation metadata')).toBeDefined();
        expect(screen.getByText('Model')).toBeDefined();
        expect(screen.getAllByText('claude-haiku-4.5').length).toBeGreaterThan(0);
        expect(screen.getByText('Session ID')).toBeDefined();
        expect(screen.getByText('sess-meta-123')).toBeDefined();
    });

    it('dismisses metadata popover when clicking outside', async () => {
        const processId = 'proc-meta-dismiss-1';
        (global as any).fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                process: {
                    id: processId,
                    type: 'clarification',
                    status: 'completed',
                    metadata: { model: 'claude-haiku-4.5' },
                    sdkSessionId: 'sess-dismiss-1',
                    conversationTurns: [
                        { role: 'user', content: 'Q', timeline: [] },
                        { role: 'assistant', content: 'A', timeline: [] },
                    ],
                },
            }),
        });

        render(
            <Wrap>
                <SeededProcessDetail
                    process={{
                        id: processId,
                        status: 'completed',
                        type: 'clarification',
                        promptPreview: 'Q',
                    }}
                />
            </Wrap>
        );

        await screen.findByText('Q');
        fireEvent.click(screen.getByRole('button', { name: 'Show conversation metadata' }));
        expect(screen.getByText('Conversation metadata')).toBeDefined();

        fireEvent.mouseDown(document.body);
        await waitFor(() => {
            expect(screen.queryByText('Conversation metadata')).toBeNull();
        });
    });

    it('shows repo name link in detail header when process has workspaceId', async () => {
        const processId = 'proc-detail-ws-1';
        (global as any).fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                process: {
                    id: processId,
                    status: 'completed',
                    workspaceId: 'ws-detail',
                    metadata: { workspaceName: 'detail-project' },
                    conversationTurns: [
                        { role: 'user', content: 'Hello', timeline: [] },
                    ],
                },
            }),
        });

        render(
            <Wrap>
                <SeededProcessDetail
                    process={{
                        id: processId,
                        status: 'completed',
                        promptPreview: 'Hello',
                        workspaceId: 'ws-detail',
                    }}
                    workspaces={[
                        { id: 'ws-detail', name: 'detail-project', rootPath: '/tmp/detail' },
                    ]}
                />
            </Wrap>
        );

        await screen.findByText('Hello');
        const repoLink = screen.getByTitle('Go to repo: detail-project');
        expect(repoLink).toBeDefined();
        expect(repoLink.tagName.toLowerCase()).toBe('a');
        expect(repoLink.getAttribute('href')).toBe('#repos/ws-detail');
    });

    it('repo link in detail navigates to repo page on click', async () => {
        const processId = 'proc-detail-nav-1';
        window.location.hash = '#process/' + processId;
        (global as any).fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                process: {
                    id: processId,
                    status: 'completed',
                    workspaceId: 'ws-nav-detail',
                    conversationTurns: [
                        { role: 'user', content: 'Navigate test', timeline: [] },
                    ],
                },
            }),
        });

        render(
            <Wrap>
                <SeededProcessDetail
                    process={{
                        id: processId,
                        status: 'completed',
                        promptPreview: 'Navigate test',
                        workspaceId: 'ws-nav-detail',
                    }}
                    workspaces={[
                        { id: 'ws-nav-detail', name: 'nav-detail-project', rootPath: '/tmp/nav-detail' },
                    ]}
                />
            </Wrap>
        );

        await screen.findByText('Navigate test');
        const link = screen.getByTitle('Go to repo: nav-detail-project');
        fireEvent.click(link);
        expect(window.location.hash).toBe('#repos/ws-nav-detail');
    });

    it('does not show repo link when process has no workspaceId', async () => {
        const processId = 'proc-detail-no-ws';
        (global as any).fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                process: {
                    id: processId,
                    status: 'completed',
                    conversationTurns: [
                        { role: 'user', content: 'No repo', timeline: [] },
                    ],
                },
            }),
        });

        render(
            <Wrap>
                <SeededProcessDetail
                    process={{
                        id: processId,
                        status: 'completed',
                        promptPreview: 'No repo',
                    }}
                />
            </Wrap>
        );

        await screen.findByText('No repo');
        expect(screen.queryByTitle(/Go to repo/)).toBeNull();
    });

    it('launches interactive resume from process detail', async () => {
        const processId = 'proc-resume-ui-1';
        const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
            const requestUrl = String(input);
            if (requestUrl.includes(`/processes/${processId}/resume-cli`)) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        launched: true,
                        command: "cd '/tmp' && copilot --yolo --resume 'sess-resume-ui-1'",
                    }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    process: {
                        id: processId,
                        type: 'clarification',
                        status: 'completed',
                        metadata: { model: 'claude-haiku-4.5' },
                        sdkSessionId: 'sess-resume-ui-1',
                        conversationTurns: [
                            { role: 'user', content: 'Q', timeline: [] },
                            { role: 'assistant', content: 'A', timeline: [] },
                        ],
                    },
                }),
            };
        });
        (global as any).fetch = fetchMock;

        render(
            <Wrap>
                <SeededProcessDetail
                    process={{
                        id: processId,
                        status: 'completed',
                        type: 'clarification',
                        promptPreview: 'Q',
                    }}
                />
            </Wrap>
        );

        await screen.findByText('Q');
        fireEvent.click(screen.getByRole('button', { name: 'Resume CLI' }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining(`/processes/${processId}/resume-cli`),
                expect.objectContaining({ method: 'POST' })
            );
        });

        expect(screen.getByText('Opened Terminal with Copilot resume command.')).toBeDefined();
    });
});

describe('ConversationTurnBubble', () => {
    it('renders role label and message content', () => {
        render(
            <Wrap>
                <ConversationTurnBubble turn={{ role: 'user', content: 'Hello', timeline: [] }} />
            </Wrap>
        );
        expect(screen.getByText('You')).toBeDefined();
        expect(screen.getByText('Hello')).toBeDefined();
    });

    it('renders assistant tool calls and streaming indicator', () => {
        render(
            <Wrap>
                <ConversationTurnBubble
                    turn={{
                        role: 'assistant',
                        content: '<p>Working...</p>',
                        streaming: true,
                        timeline: [],
                        toolCalls: [{ id: '1', toolName: 'bash', status: 'running', args: {} }],
                    }}
                />
            </Wrap>
        );
        expect(screen.getByText('Assistant')).toBeDefined();
        expect(screen.getByText('Live')).toBeDefined();
        expect(screen.getByText('bash')).toBeDefined();
    });

    it('keeps task-scoped content ordered inside the task subtree', () => {
        render(
            <Wrap>
                <ConversationTurnBubble
                    turn={{
                        role: 'assistant',
                        content: '',
                        timeline: [
                            { type: 'content', timestamp: '2026-02-19T00:00:00.000Z', content: 'SEGMENT_ONE' },
                            {
                                type: 'tool-start',
                                timestamp: '2026-02-19T00:00:01.000Z',
                                toolCall: {
                                    id: 'task-1',
                                    toolName: 'task',
                                    args: { agent_type: 'explore', description: 'Explore tasks.ts SPA client' },
                                    startTime: '2026-02-19T00:00:01.000Z',
                                    endTime: '2026-02-19T00:00:10.000Z',
                                    status: 'completed',
                                },
                            },
                            { type: 'content', timestamp: '2026-02-19T00:00:02.000Z', content: 'SEGMENT_TWO' },
                            {
                                type: 'tool-start',
                                timestamp: '2026-02-19T00:00:03.000Z',
                                toolCall: {
                                    id: 'view-1',
                                    toolName: 'view',
                                    args: {
                                        path: '/Users/test/Documents/Projects/shortcuts/packages/coc/src/server/spa/client/tasks.ts',
                                    },
                                    startTime: '2026-02-19T00:00:03.000Z',
                                    endTime: '2026-02-19T00:00:04.000Z',
                                    status: 'completed',
                                },
                            },
                            {
                                type: 'tool-start',
                                timestamp: '2026-02-19T00:00:05.000Z',
                                toolCall: {
                                    id: 'glob-1',
                                    toolName: 'glob',
                                    args: { pattern: '**/tasks.ts' },
                                    startTime: '2026-02-19T00:00:05.000Z',
                                    endTime: '2026-02-19T00:00:06.000Z',
                                    status: 'completed',
                                },
                            },
                            { type: 'content', timestamp: '2026-02-19T00:00:07.000Z', content: 'SEGMENT_THREE' },
                        ],
                    }}
                />
            </Wrap>
        );

        const text = document.body.textContent || '';
        expect(text.indexOf('SEGMENT_ONE')).toBeLessThan(text.indexOf('task'));
        // SEGMENT_TWO and SEGMENT_THREE should stay inside task scope, not drift to conversation end.
        expect(text.indexOf('task')).toBeLessThan(text.indexOf('SEGMENT_TWO'));
        expect(text.indexOf('SEGMENT_TWO')).toBeLessThan(text.indexOf('view'));
        expect(text.indexOf('view')).toBeLessThan(text.indexOf('glob'));
        expect(text.indexOf('glob')).toBeLessThan(text.indexOf('SEGMENT_THREE'));

        const taskCard = document.querySelector('[data-tool-id="task-1"]') as HTMLElement | null;
        const taskChildrenText = taskCard?.querySelector('.tool-call-children')?.textContent || '';
        expect(taskChildrenText).toContain('SEGMENT_TWO');
        expect(taskChildrenText).toContain('SEGMENT_THREE');
    });

    it('renders content after task completion at root level', () => {
        render(
            <Wrap>
                <ConversationTurnBubble
                    turn={{
                        role: 'assistant',
                        content: '',
                        timeline: [
                            {
                                type: 'tool-start',
                                timestamp: '2026-02-19T00:00:00.000Z',
                                toolCall: {
                                    id: 'task-complete-1',
                                    toolName: 'task',
                                    args: { agent_type: 'explore', description: 'Trace renderer flow' },
                                    startTime: '2026-02-19T00:00:00.000Z',
                                    status: 'running',
                                },
                            },
                            { type: 'content', timestamp: '2026-02-19T00:00:01.000Z', content: 'INSIDE_TASK' },
                            {
                                type: 'tool-complete',
                                timestamp: '2026-02-19T00:00:02.000Z',
                                toolCall: {
                                    id: 'task-complete-1',
                                    toolName: 'task',
                                    args: { agent_type: 'explore', description: 'Trace renderer flow' },
                                    startTime: '2026-02-19T00:00:00.000Z',
                                    endTime: '2026-02-19T00:00:02.000Z',
                                    status: 'completed',
                                },
                            },
                            { type: 'content', timestamp: '2026-02-19T00:00:03.000Z', content: 'OUTSIDE_TASK' },
                        ],
                    }}
                />
            </Wrap>
        );

        const taskCard = document.querySelector('[data-tool-id="task-complete-1"]') as HTMLElement | null;
        const taskChildrenText = taskCard?.querySelector('.tool-call-children')?.textContent || '';
        expect(taskChildrenText).toContain('INSIDE_TASK');
        expect(taskChildrenText).not.toContain('OUTSIDE_TASK');

        expect(screen.getByText('OUTSIDE_TASK')).toBeDefined();
    });

    it('renders child tool calls under parent task depth', () => {
        render(
            <Wrap>
                <ConversationTurnBubble
                    turn={{
                        role: 'assistant',
                        content: '',
                        timeline: [
                            {
                                type: 'tool-start',
                                timestamp: '2026-02-19T00:00:00.000Z',
                                toolCall: {
                                    id: 'task-2',
                                    toolName: 'task',
                                    args: { agent_type: 'explore', description: 'Explore queue.ts SPA client' },
                                    startTime: '2026-02-19T00:00:00.000Z',
                                    endTime: '2026-02-19T00:00:10.000Z',
                                    status: 'completed',
                                },
                            },
                            {
                                type: 'tool-start',
                                timestamp: '2026-02-19T00:00:01.000Z',
                                toolCall: {
                                    id: 'view-2',
                                    toolName: 'view',
                                    args: { path: '/Users/test/Documents/Projects/shortcuts/packages/coc/src/server/spa/client/queue.ts' },
                                    startTime: '2026-02-19T00:00:01.000Z',
                                    endTime: '2026-02-19T00:00:02.000Z',
                                    status: 'completed',
                                },
                            },
                        ],
                    }}
                />
            </Wrap>
        );

        const taskCard = screen.getByText('task').closest('.my-1') as HTMLElement;
        const viewCard = screen.getByText('view').closest('.my-1') as HTMLElement;

        expect(taskCard.style.marginLeft || '0px').toBe('0px');
        expect(viewCard.style.marginLeft).toBe('12px');
    });

    it('supports collapsing and expanding subtools under task tool', () => {
        render(
            <Wrap>
                <ConversationTurnBubble
                    turn={{
                        role: 'assistant',
                        content: '',
                        timeline: [
                            {
                                type: 'tool-start',
                                timestamp: '2026-02-19T00:00:00.000Z',
                                toolCall: {
                                    id: 'task-collapse',
                                    toolName: 'task',
                                    args: { agent_type: 'explore', description: 'Explore websocket.ts SPA client' },
                                    startTime: '2026-02-19T00:00:00.000Z',
                                    endTime: '2026-02-19T00:00:10.000Z',
                                    status: 'completed',
                                },
                            },
                            {
                                type: 'tool-start',
                                timestamp: '2026-02-19T00:00:01.000Z',
                                toolCall: {
                                    id: 'view-collapse',
                                    toolName: 'view',
                                    args: { path: '/Users/test/Documents/Projects/shortcuts/packages/coc/src/server/spa/client/websocket.ts' },
                                    startTime: '2026-02-19T00:00:01.000Z',
                                    endTime: '2026-02-19T00:00:02.000Z',
                                    status: 'completed',
                                },
                            },
                        ],
                    }}
                />
            </Wrap>
        );

        expect(screen.getByText('view')).toBeDefined();
        // Subtools default to collapsed — verify initial state
        const childrenContainer = screen.getByText('view').closest('.tool-call-children');
        expect(childrenContainer?.classList.contains('subtree-collapsed')).toBe(true);
        // Click to expand
        fireEvent.click(screen.getByRole('button', { name: 'Expand subtools' }));
        expect(childrenContainer?.classList.contains('subtree-collapsed')).toBe(false);
        // Click to collapse again
        fireEvent.click(screen.getByRole('button', { name: 'Collapse subtools' }));
        expect(childrenContainer?.classList.contains('subtree-collapsed')).toBe(true);
    });

    describe('report_intent filtering', () => {
        const turnWithReportIntent = {
            role: 'assistant' as const,
            content: '',
            timeline: [
                {
                    type: 'tool-start',
                    timestamp: '2026-02-19T00:00:00.000Z',
                    toolCall: {
                        id: 'ri-1',
                        toolName: 'report_intent',
                        args: { intent: 'Exploring codebase' },
                        result: 'Intent logged',
                        startTime: '2026-02-19T00:00:00.000Z',
                        endTime: '2026-02-19T00:00:00.100Z',
                        status: 'completed',
                    },
                },
                {
                    type: 'tool-start',
                    timestamp: '2026-02-19T00:00:01.000Z',
                    toolCall: {
                        id: 'bash-1',
                        toolName: 'bash',
                        args: { command: 'ls' },
                        startTime: '2026-02-19T00:00:01.000Z',
                        endTime: '2026-02-19T00:00:02.000Z',
                        status: 'completed',
                    },
                },
            ],
        };

        it('hides report_intent tool calls when showReportIntent is false', () => {
            mockDisplaySettings.showReportIntent = false;
            render(
                <Wrap>
                    <ConversationTurnBubble turn={turnWithReportIntent} />
                </Wrap>
            );
            expect(screen.getByText('bash')).toBeDefined();
            expect(screen.queryByText('Exploring codebase')).toBeNull();
            expect(screen.queryByText('report_intent')).toBeNull();
        });

        it('shows report_intent as compact chip when showReportIntent is true', () => {
            mockDisplaySettings.showReportIntent = true;
            render(
                <Wrap>
                    <ConversationTurnBubble turn={turnWithReportIntent} />
                </Wrap>
            );
            expect(screen.getByText('bash')).toBeDefined();
            expect(screen.getByText('Exploring codebase')).toBeDefined();
            // Should render as chip with 🏷 emoji
            expect(screen.getByText('🏷')).toBeDefined();
        });

        it('renders other tool calls normally regardless of showReportIntent setting', () => {
            mockDisplaySettings.showReportIntent = false;
            render(
                <Wrap>
                    <ConversationTurnBubble turn={turnWithReportIntent} />
                </Wrap>
            );
            expect(screen.getByText('bash')).toBeDefined();
        });

        // Reset to default after tests
        afterEach(() => {
            mockDisplaySettings.showReportIntent = false;
        });
    });
});

describe('ProcessesView', () => {
    it('renders the two-pane layout', async () => {
        render(<Wrap><ProcessesView /></Wrap>);
        await waitFor(() => {
            const view = document.getElementById('view-processes');
            expect(view).not.toBeNull();
        });
    });

    it('renders ActivityListPane and ActivityDetailPane in split layout', async () => {
        render(<Wrap><ProcessesView /></Wrap>);
        await waitFor(() => {
            const view = document.getElementById('view-processes');
            expect(view).not.toBeNull();
            expect(view!.getAttribute('data-testid')).toBe('activity-split-panel');
        });
    });

    it('left panel has fixed width and does not shrink', async () => {
        render(<Wrap><ProcessesView /></Wrap>);
        await waitFor(() => {
            const view = document.getElementById('view-processes');
            expect(view).not.toBeNull();
            const leftPanel = view!.querySelector(':scope > div.flex-shrink-0');
            expect(leftPanel).not.toBeNull();
        });
    });

    it('right panel fills remaining space', async () => {
        render(<Wrap><ProcessesView /></Wrap>);
        await waitFor(() => {
            const view = document.getElementById('view-processes');
            expect(view).not.toBeNull();
            const rightPanel = view!.querySelector(':scope > div.flex-1');
            expect(rightPanel).not.toBeNull();
            expect(rightPanel!.className).toContain('min-w-0');
        });
    });
});

describe('ProcessesSidebar – unified layout', () => {
    it('empty state uses compact non-expanding style', () => {
        const { container } = render(<Wrap><ProcessesSidebar /></Wrap>);
        const emptyDiv = screen.getByText('No processes yet').closest('div');
        expect(emptyDiv).not.toBeNull();
        expect(emptyDiv!.className).toContain('py-6');
        expect(emptyDiv!.className).toContain('text-center');
        // Should NOT have flex-1 that expands to fill container
        expect(emptyDiv!.className).not.toContain('flex-1');
    });

    it('list container does not have flex-1 or overflow-y-auto', () => {
        render(
            <Wrap>
                <SeededProcessList
                    processes={[{ id: 'p1', status: 'completed', promptPreview: 'test' }]}
                />
            </Wrap>
        );
        // The list container wrapping cards should not have flex-1 or overflow
        const cards = screen.getByText('test').closest('div.flex.flex-col');
        expect(cards).not.toBeNull();
        expect(cards!.className).not.toContain('flex-1');
        expect(cards!.className).not.toContain('overflow-y-auto');
    });
});

describe('ProcessesSidebar – no border-t styling', () => {
    it('does not have border-t on its root element', () => {
        const { container } = render(<Wrap><ProcessesSidebar /></Wrap>);
        const root = container.firstElementChild as HTMLElement;
        expect(root).not.toBeNull();
        expect(root!.className).not.toContain('border-t');
        expect(root!.className).toContain('p-2');
    });
});

describe('ToolCallView', () => {
    it('renders tool name', () => {
        render(<Wrap><ToolCallView toolCall={{ toolName: 'grep', status: 'completed' }} /></Wrap>);
        expect(screen.getByText('grep')).toBeDefined();
    });

    it('renders status indicator for running', () => {
        render(<Wrap><ToolCallView toolCall={{ toolName: 'bash', status: 'running' }} /></Wrap>);
        expect(screen.getByText('🔄')).toBeDefined();
    });

    it('shows completed indicator', () => {
        render(<Wrap><ToolCallView toolCall={{ toolName: 'view', status: 'completed' }} /></Wrap>);
        expect(screen.getByText('✅')).toBeDefined();
    });

    it('shows failed indicator', () => {
        render(<Wrap><ToolCallView toolCall={{ toolName: 'bash', status: 'failed', error: 'fail' }} /></Wrap>);
        expect(screen.getByText('❌')).toBeDefined();
    });

    it('expands to show args on click', () => {
        render(<Wrap><ToolCallView toolCall={{ toolName: 'grep', args: { pattern: 'test' }, status: 'completed' }} /></Wrap>);
        fireEvent.click(screen.getByText('grep'));
        expect(screen.getByText('Arguments')).toBeDefined();
    });

    it('shows error when present', () => {
        render(<Wrap><ToolCallView toolCall={{ toolName: 'bash', error: 'Command failed', status: 'failed' }} /></Wrap>);
        fireEvent.click(screen.getByText('bash'));
        expect(screen.getByText('Error')).toBeDefined();
        expect(screen.getByText('Command failed')).toBeDefined();
    });

    it('shows result when present', () => {
        render(<Wrap><ToolCallView toolCall={{ toolName: 'grep', result: 'found 3 matches', status: 'completed' }} /></Wrap>);
        fireEvent.click(screen.getByText('grep'));
        expect(screen.getByText('Result')).toBeDefined();
        expect(screen.getByText('found 3 matches')).toBeDefined();
    });

    it('handles name field instead of toolName', () => {
        render(<Wrap><ToolCallView toolCall={{ name: 'custom-tool', status: 'completed' }} /></Wrap>);
        expect(screen.getByText('custom-tool')).toBeDefined();
    });

    it('shows unknown when neither name nor toolName', () => {
        render(<Wrap><ToolCallView toolCall={{ status: 'completed' }} /></Wrap>);
        expect(screen.getByText('unknown')).toBeDefined();
    });

    it('toggles collapsed state', () => {
        render(<Wrap><ToolCallView toolCall={{ toolName: 'grep', args: { pattern: 'test' }, status: 'completed' }} /></Wrap>);
        const body = screen.getByText('Arguments').closest('.tool-call-body');
        expect(body?.classList.contains('collapsed')).toBe(true);
        fireEvent.click(screen.getByText('grep'));
        expect(body?.classList.contains('collapsed')).toBe(false);
        fireEvent.click(screen.getByText('grep'));
        expect(body?.classList.contains('collapsed')).toBe(true);
    });

    it('shows inline summary for view tool calls', () => {
        render(
            <Wrap>
                <ToolCallView
                    toolCall={{
                        toolName: 'view',
                        status: 'completed',
                        args: {
                            path: '/Users/test/Documents/Projects/shortcuts/src/server/spa/client/index.tsx',
                            view_range: [10, 40],
                        },
                    }}
                />
            </Wrap>
        );
        expect(screen.getByText('shortcuts/src/server/spa/client/index.tsx L10-L40')).toBeDefined();
    });

    it('renders bash description and command sections', () => {
        render(
            <Wrap>
                <ToolCallView
                    toolCall={{
                        toolName: 'bash',
                        status: 'completed',
                        args: {
                            description: 'Run tests',
                            command: 'npm run test:run',
                            working_directory: 'packages/coc',
                        },
                    }}
                />
            </Wrap>
        );
        fireEvent.click(screen.getByText('bash'));
        expect(screen.getByText('Description')).toBeDefined();
        expect(screen.getByText('Run tests')).toBeDefined();
        expect(screen.getByText('Command')).toBeDefined();
        expect(screen.getByText('$ npm run test:run')).toBeDefined();
        expect(screen.getByText('Options')).toBeDefined();
    });

    it('shows skill name summary when args.skill is present', () => {
        render(
            <Wrap>
                <ToolCallView toolCall={{ toolName: 'skill', status: 'completed', args: { skill: 'impl' } }} />
            </Wrap>
        );
        expect(screen.getByText('impl')).toBeDefined();
    });
});

describe('MarkdownView', () => {
    it('renders HTML content', () => {
        render(<Wrap><MarkdownView html="<p>Hello world</p>" /></Wrap>);
        expect(screen.getByText('Hello world')).toBeDefined();
    });

    it('renders with markdown-body class', () => {
        const { container } = render(<Wrap><MarkdownView html="<p>test</p>" /></Wrap>);
        expect(container.querySelector('.markdown-body')).not.toBeNull();
    });
});

describe('ProcessesSidebar (queue panel)', () => {
    it('renders stats bar', () => {
        render(<Wrap><ProcessesSidebar /></Wrap>);
        expect(screen.getByText(/0 queued/)).toBeDefined();
        expect(screen.getByText(/0 running/)).toBeDefined();
    });

    it('renders enqueue button', () => {
        render(<Wrap><ProcessesSidebar /></Wrap>);
        expect(screen.getByText('+ Enqueue')).toBeDefined();
    });

    it('renders history toggle', () => {
        render(<Wrap><ProcessesSidebar /></Wrap>);
        expect(screen.getByText(/History/)).toBeDefined();
    });

    it('updates hash route when selecting a history task', async () => {
        window.location.hash = '#processes';
        render(
            <Wrap>
                <SeededQueuePanel
                    historyItem={{
                        id: 'task-route-1',
                        status: 'completed',
                        type: 'chat',
                        prompt: 'History route test',
                    }}
                />
            </Wrap>
        );

        const taskCardText = await screen.findByText('History route test');
        fireEvent.click(taskCardText);
        expect(window.location.hash).toBe('#process/queue_task-route-1');
    });

    it('renders history cards in compact single-line format without status label', async () => {
        render(
            <Wrap>
                <SeededQueuePanel
                    historyItem={{
                        id: 'task-compact-1',
                        status: 'completed',
                        type: 'chat',
                        prompt: 'Compact history item should stay on one line',
                    }}
                />
            </Wrap>
        );

        const card = await screen.findByLabelText(/Task completed: Compact history item should stay on one line/);
        expect(card.className).toContain('px-2');
        expect(card.className).toContain('py-1.5');
        expect((card as HTMLElement).querySelector('.line-clamp-1')).toBeNull();
        expect(card.textContent).not.toContain('Completed');
        expect(card.textContent).toContain('chat');
    });

    it('shows repo name in compact history card when repoId is present', async () => {
        render(
            <Wrap>
                <SeededQueuePanel
                    historyItem={{
                        id: 'task-repo-1',
                        status: 'completed',
                        type: 'chat',
                        prompt: 'Task with repo',
                        repoId: '/Users/dev/projects/my-awesome-repo',
                    }}
                />
            </Wrap>
        );

        const card = await screen.findByLabelText(/Task completed: Task with repo/);
        expect(card.textContent).toContain('[my-awesome-repo]');
        const repoSpan = card.querySelector('.queue-task-repo-name');
        expect(repoSpan).toBeTruthy();
        expect(repoSpan?.getAttribute('title')).toBe('/Users/dev/projects/my-awesome-repo');
        const text = card.textContent || '';
        expect(text.indexOf('[my-awesome-repo]')).toBeLessThan(text.indexOf('chat'));
    });

    it('does not show repo name when repoId is absent', async () => {
        render(
            <Wrap>
                <SeededQueuePanel
                    historyItem={{
                        id: 'task-no-repo-1',
                        status: 'completed',
                        type: 'chat',
                        prompt: 'No repo task',
                    }}
                />
            </Wrap>
        );

        const card = await screen.findByLabelText(/Task completed: No repo task/);
        const repoSpan = card.querySelector('.queue-task-repo-name');
        expect(repoSpan).toBeNull();
    });

    it('shows repo name for failed history items without status label', async () => {
        render(
            <Wrap>
                <SeededQueuePanel
                    historyItem={{
                        id: 'task-failed-repo-1',
                        status: 'failed',
                        type: 'chat',
                        prompt: 'Review the auth module',
                        repoId: '/home/user/workspace/backend-api',
                    }}
                />
            </Wrap>
        );

        const card = await screen.findByLabelText(/Task failed: Review the auth module/);
        expect(card.textContent).not.toContain('Failed');
        expect(card.textContent).toContain('[backend-api]');
        expect(card.textContent).toContain('chat');
        const text = card.textContent || '';
        expect(text.indexOf('[backend-api]')).toBeLessThan(text.indexOf('chat'));
    });

    it('falls back to workingDirectory when repoId is absent', async () => {
        render(
            <Wrap>
                <SeededQueuePanel
                    historyItem={{
                        id: 'task-wd-1',
                        status: 'completed',
                        type: 'chat',
                        prompt: 'Task with working dir',
                        workingDirectory: '/Users/dev/projects/frontend-app',
                    }}
                />
            </Wrap>
        );

        const card = await screen.findByLabelText(/Task completed: Task with working dir/);
        expect(card.textContent).toContain('[frontend-app]');
    });

    it('falls back to payload.workingDirectory when both repoId and workingDirectory are absent', async () => {
        render(
            <Wrap>
                <SeededQueuePanel
                    historyItem={{
                        id: 'task-payload-wd-1',
                        status: 'completed',
                        type: 'chat',
                        prompt: 'Task with payload wd',
                        payload: { workingDirectory: '/home/user/code/api-server' },
                    }}
                />
            </Wrap>
        );

        const card = await screen.findByLabelText(/Task completed: Task with payload wd/);
        expect(card.textContent).toContain('[api-server]');
    });

    it('prefers repoId over workingDirectory', async () => {
        render(
            <Wrap>
                <SeededQueuePanel
                    historyItem={{
                        id: 'task-prefer-repo-1',
                        status: 'completed',
                        type: 'chat',
                        prompt: 'Task with both',
                        repoId: '/path/to/repo-from-id',
                        workingDirectory: '/path/to/repo-from-wd',
                    }}
                />
            </Wrap>
        );

        const card = await screen.findByLabelText(/Task completed: Task with both/);
        expect(card.textContent).toContain('[repo-from-id]');
        expect(card.textContent).not.toContain('repo-from-wd');
    });
});

describe('ActivityChatDetail metadata popover', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('shows model and session metadata for queue conversations', async () => {
        const processId = 'queue_task-meta-1';
        const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method || 'GET';
            if (url.endsWith(`/api/processes/${processId}`) && method === 'GET') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        process: {
                            id: processId,
                            type: 'queue-ai-clarification',
                            status: 'completed',
                            startTime: '2026-02-19T08:58:31.000Z',
                            endTime: '2026-02-19T08:59:06.000Z',
                            sdkSessionId: 'sess-queue-meta',
                            metadata: {
                                model: 'claude-haiku-4.5',
                                queueTaskId: 'task-meta-1',
                            },
                            conversationTurns: [
                                { role: 'user', content: 'what was my last question?', timeline: [] },
                                { role: 'assistant', content: 'Your last question was ...', timeline: [] },
                            ],
                        },
                    }),
                });
            }
            if (url.endsWith('/api/queue/task-meta-1') && method === 'GET') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ task: { id: 'task-meta-1', processId, status: 'completed', type: 'chat' } }),
                });
            }
            return Promise.resolve({
                ok: false,
                status: 404,
                json: async () => ({ error: 'not found' }),
            });
        });
        (global as any).fetch = fetchMock;
        (global as any).EventSource = undefined;

        render(
            <Wrap>
                <SeededQueueTaskDetail
                    task={{
                        id: 'task-meta-1',
                        processId,
                        status: 'completed',
                        type: 'chat',
                        prompt: 'what was my last question?',
                    }}
                />
            </Wrap>
        );

        await screen.findByText('Your last question was ...');
        fireEvent.click(screen.getByRole('button', { name: 'Show conversation metadata' }));

        expect(screen.getByText('Conversation metadata')).toBeDefined();
        expect(screen.getByText('claude-haiku-4.5')).toBeDefined();
        expect(screen.getByText('sess-queue-meta')).toBeDefined();
        expect(screen.getByText('task-meta-1')).toBeDefined();
    });
});

describe('ActivityChatDetail follow-up input', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders a follow-up input and sends a message', async () => {
        const processId = 'queue_task-follow-1';
        let conversationFetchCount = 0;
        const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method || 'GET';

            if (url.endsWith(`/api/processes/${processId}`) && method === 'GET') {
                conversationFetchCount += 1;
                if (conversationFetchCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: async () => ({
                            process: {
                                id: processId,
                                status: 'completed',
                                sdkSessionId: 'test-session-follow-1',
                                sessionId: 'test-session-follow-1',
                                conversationTurns: [
                                    { role: 'user', content: 'First question', timeline: [] },
                                    { role: 'assistant', content: 'First answer', timeline: [] },
                                ],
                            },
                        }),
                    });
                }

                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        process: {
                            id: processId,
                            status: 'completed',
                            sdkSessionId: 'test-session-follow-1',
                            sessionId: 'test-session-follow-1',
                            conversationTurns: [
                                { role: 'user', content: 'First question', timeline: [] },
                                { role: 'assistant', content: 'First answer', timeline: [] },
                                { role: 'user', content: 'Follow-up question', timeline: [] },
                                { role: 'assistant', content: 'Follow-up answer', timeline: [] },
                            ],
                        },
                    }),
                });
            }

            if (url.endsWith(`/api/processes/${processId}/message`) && method === 'POST') {
                return Promise.resolve({
                    ok: true,
                    status: 202,
                    json: async () => ({ processId, turnIndex: 2 }),
                });
            }

            if (url.endsWith('/api/queue/task-follow-1') && method === 'GET') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ task: { id: 'task-follow-1', processId, status: 'completed', type: 'chat' } }),
                });
            }

            return Promise.resolve({
                ok: false,
                status: 404,
                json: async () => ({ error: 'not found' }),
            });
        });

        (global as any).fetch = fetchMock;
        (global as any).EventSource = undefined;

        render(
            <Wrap>
                <SeededQueueTaskDetail
                    task={{
                        id: 'task-follow-1',
                        processId,
                        status: 'completed',
                        type: 'chat',
                        prompt: 'First question',
                    }}
                />
            </Wrap>
        );

        await screen.findByText('First answer');

        const input = screen.getByPlaceholderText('Send a message... (type / for skills)');
        fireEvent.change(input, { target: { value: 'Follow-up question' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining(`/api/processes/${processId}/message`),
                expect.objectContaining({ method: 'POST' })
            );
        });

        await waitFor(() => {
            expect(screen.getByText('Follow-up answer')).toBeDefined();
        });
    });

    it('disables input when follow-up session expires', async () => {
        const processId = 'queue_task-expired-1';
        const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method || 'GET';

            if (url.endsWith(`/api/processes/${processId}`) && method === 'GET') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        process: {
                            id: processId,
                            status: 'completed',
                            sdkSessionId: 'test-session-expired-1',
                            sessionId: 'test-session-expired-1',
                            conversationTurns: [
                                { role: 'user', content: 'Start', timeline: [] },
                                { role: 'assistant', content: 'Done', timeline: [] },
                            ],
                        },
                    }),
                });
            }

            if (url.endsWith(`/api/processes/${processId}/message`) && method === 'POST') {
                return Promise.resolve({
                    ok: false,
                    status: 410,
                    json: async () => ({ error: 'session_expired' }),
                });
            }

            if (url.endsWith('/api/queue/task-expired-1') && method === 'GET') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ task: { id: 'task-expired-1', processId, status: 'completed', type: 'chat' } }),
                });
            }

            return Promise.resolve({
                ok: false,
                status: 404,
                json: async () => ({ error: 'not found' }),
            });
        });

        (global as any).fetch = fetchMock;
        (global as any).EventSource = undefined;

        render(
            <Wrap>
                <SeededQueueTaskDetail
                    task={{
                        id: 'task-expired-1',
                        processId,
                        status: 'completed',
                        type: 'chat',
                        prompt: 'Start',
                    }}
                />
            </Wrap>
        );

        await screen.findByText('Done');

        const input = screen.getByPlaceholderText('Send a message... (type / for skills)');
        fireEvent.change(input, { target: { value: 'Need more' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() => {
            expect(screen.getByText('Session expired.')).toBeDefined();
        });

        expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByPlaceholderText('Session expired.') as HTMLTextAreaElement).disabled).toBe(true);
    });
});

describe('ActivityChatDetail semantic hooks', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders root div with id="detail-panel" and class "chat-layout"', async () => {
        const processId = 'queue_task-hooks-1';
        (global as any).fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith(`/api/processes/${processId}`)) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        process: {
                            id: processId,
                            status: 'completed',
                            conversationTurns: [
                                { role: 'user', content: 'Hello', timeline: [] },
                                { role: 'assistant', content: 'Hi', timeline: [] },
                            ],
                        },
                    }),
                });
            }
            if (url.endsWith('/api/queue/task-hooks-1')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ task: { id: 'task-hooks-1', processId, status: 'completed', type: 'chat' } }),
                });
            }
            return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
        });
        (global as any).EventSource = undefined;

        const { container } = render(
            <Wrap>
                <SeededQueueTaskDetail
                    task={{ id: 'task-hooks-1', processId, status: 'completed', type: 'chat', prompt: 'Hello' }}
                />
            </Wrap>
        );

        await screen.findByText('Hi');
        const panel = container.querySelector('[data-testid="activity-chat-detail"]');
        expect(panel).toBeDefined();
        expect(panel!.classList.contains('flex-1')).toBe(true);
    });

    it('shows chat-error-bubble and bubble-error classes on follow-up error', async () => {
        const processId = 'queue_task-err-1';
        (global as any).fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method || 'GET';
            if (url.endsWith(`/api/processes/${processId}`) && method === 'GET') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        process: {
                            id: processId,
                            status: 'completed',
                            sdkSessionId: 'test-session-err-1',
                            sessionId: 'test-session-err-1',
                            conversationTurns: [
                                { role: 'user', content: 'Q', timeline: [] },
                                { role: 'assistant', content: 'A', timeline: [] },
                            ],
                        },
                    }),
                });
            }
            if (url.endsWith(`/api/processes/${processId}/message`) && method === 'POST') {
                return Promise.resolve({
                    ok: false,
                    status: 500,
                    json: async () => ({ error: 'Internal server error' }),
                });
            }
            if (url.endsWith('/api/queue/task-err-1') && method === 'GET') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ task: { id: 'task-err-1', processId, status: 'completed', type: 'chat' } }),
                });
            }
            return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
        });
        (global as any).EventSource = undefined;

        const { container } = render(
            <Wrap>
                <SeededQueueTaskDetail
                    task={{ id: 'task-err-1', processId, status: 'completed', type: 'chat', prompt: 'Q' }}
                />
            </Wrap>
        );

        await screen.findByText('A');
        const input = screen.getByPlaceholderText('Send a message... (type / for skills)');
        fireEvent.change(input, { target: { value: 'follow up' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() => {
            const errorBubble = container.querySelector('.chat-error-bubble');
            expect(errorBubble).toBeDefined();
            expect(errorBubble!.classList.contains('bubble-error')).toBe(true);
        });
    });

    it('shows retry-btn after follow-up network error', async () => {
        const processId = 'queue_task-retry-1';
        (global as any).fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method || 'GET';
            if (url.endsWith(`/api/processes/${processId}`) && method === 'GET') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        process: {
                            id: processId,
                            status: 'completed',
                            sdkSessionId: 'test-session-retry-1',
                            sessionId: 'test-session-retry-1',
                            conversationTurns: [
                                { role: 'user', content: 'Q', timeline: [] },
                                { role: 'assistant', content: 'A', timeline: [] },
                            ],
                        },
                    }),
                });
            }
            if (url.endsWith(`/api/processes/${processId}/message`) && method === 'POST') {
                return Promise.reject(new Error('Network error'));
            }
            if (url.endsWith('/api/queue/task-retry-1') && method === 'GET') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ task: { id: 'task-retry-1', processId, status: 'completed', type: 'chat' } }),
                });
            }
            return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
        });
        (global as any).EventSource = undefined;

        const { container } = render(
            <Wrap>
                <SeededQueueTaskDetail
                    task={{ id: 'task-retry-1', processId, status: 'completed', type: 'chat', prompt: 'Q' }}
                />
            </Wrap>
        );

        await screen.findByText('A');
        const input = screen.getByPlaceholderText('Send a message... (type / for skills)');
        fireEvent.change(input, { target: { value: 'retry me' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() => {
            const retryBtn = container.querySelector('.retry-btn');
            expect(retryBtn).toBeDefined();
            expect(retryBtn!.textContent).toBe('Retry');
        });
    });

    it('renders scroll-to-bottom-btn in DOM (hidden by default)', async () => {
        const processId = 'queue_task-scroll-1';
        (global as any).fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith(`/api/processes/${processId}`)) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        process: {
                            id: processId,
                            status: 'completed',
                            conversationTurns: [
                                { role: 'user', content: 'X', timeline: [] },
                                { role: 'assistant', content: 'Y', timeline: [] },
                            ],
                        },
                    }),
                });
            }
            if (url.endsWith('/api/queue/task-scroll-1')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ task: { id: 'task-scroll-1', processId, status: 'completed', type: 'chat' } }),
                });
            }
            return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
        });
        (global as any).EventSource = undefined;

        const { container } = render(
            <Wrap>
                <SeededQueueTaskDetail
                    task={{ id: 'task-scroll-1', processId, status: 'completed', type: 'chat', prompt: 'X' }}
                />
            </Wrap>
        );

        await screen.findByText('Y');
        const btn = container.querySelector('[title="Scroll to bottom"]');
        expect(btn).toBeDefined();
        // Not scrolled up so should not have visible class
        expect(btn!.classList.contains('visible')).toBe(false);
    });

    it('renders conversation container with wrapper that has relative class', async () => {
        const processId = 'queue_task-rel-1';
        (global as any).fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith(`/api/processes/${processId}`)) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        process: {
                            id: processId,
                            status: 'completed',
                            conversationTurns: [
                                { role: 'user', content: 'Hi', timeline: [] },
                                { role: 'assistant', content: 'There', timeline: [] },
                            ],
                        },
                    }),
                });
            }
            if (url.endsWith('/api/queue/task-rel-1')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ task: { id: 'task-rel-1', processId, status: 'completed', type: 'chat' } }),
                });
            }
            return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
        });
        (global as any).EventSource = undefined;

        const { container } = render(
            <Wrap>
                <SeededQueueTaskDetail
                    task={{ id: 'task-rel-1', processId, status: 'completed', type: 'chat', prompt: 'Hi' }}
                />
            </Wrap>
        );

        await screen.findByText('There');
        const conv = container.querySelector('.overflow-y-auto.space-y-3');
        expect(conv).toBeDefined();
        // The scrollable container itself should NOT have 'relative'
        expect(conv!.classList.contains('relative')).toBe(false);
        // Its parent wrapper should have 'relative' for positioning the scroll-to-bottom button
        expect(conv!.parentElement!.classList.contains('relative')).toBe(true);
    });

    it('shows streaming placeholder when task is running with non-streaming turns', async () => {
        const processId = 'queue_task-stream-1';
        (global as any).fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith(`/api/processes/${processId}`)) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        process: {
                            id: processId,
                            status: 'running',
                            conversationTurns: [
                                { role: 'user', content: 'Go', timeline: [] },
                            ],
                        },
                    }),
                });
            }
            if (url.endsWith('/api/queue/task-stream-1')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ task: { id: 'task-stream-1', processId, status: 'running', type: 'chat' } }),
                });
            }
            return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
        });
        (global as any).EventSource = vi.fn().mockImplementation(() => ({
            addEventListener: vi.fn(),
            close: vi.fn(),
            onmessage: null,
            onerror: null,
        }));

        const { container } = render(
            <Wrap>
                <SeededQueueTaskDetail
                    task={{ id: 'task-stream-1', processId, status: 'running', type: 'chat', prompt: 'Go' }}
                />
            </Wrap>
        );

        await screen.findByText('Go');
        // Should render 2 bubbles: user + streaming placeholder
        await waitFor(() => {
            const bubbles = container.querySelectorAll('.space-y-3 > .space-y-3 > *');
            expect(bubbles.length).toBe(2);
        });
    });

    it('shows chat-error-bubble with Session text on 410 response', async () => {
        const processId = 'queue_task-410-1';
        (global as any).fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method || 'GET';
            if (url.endsWith(`/api/processes/${processId}`) && method === 'GET') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        process: {
                            id: processId,
                            status: 'completed',
                            sdkSessionId: 'test-session-410-1',
                            sessionId: 'test-session-410-1',
                            conversationTurns: [
                                { role: 'user', content: 'Q', timeline: [] },
                                { role: 'assistant', content: 'A', timeline: [] },
                            ],
                        },
                    }),
                });
            }
            if (url.endsWith(`/api/processes/${processId}/message`) && method === 'POST') {
                return Promise.resolve({
                    ok: false,
                    status: 410,
                    json: async () => ({ error: 'session_expired' }),
                });
            }
            if (url.endsWith('/api/queue/task-410-1') && method === 'GET') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ task: { id: 'task-410-1', processId, status: 'completed', type: 'chat' } }),
                });
            }
            return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
        });
        (global as any).EventSource = undefined;

        const { container } = render(
            <Wrap>
                <SeededQueueTaskDetail
                    task={{ id: 'task-410-1', processId, status: 'completed', type: 'chat', prompt: 'Q' }}
                />
            </Wrap>
        );

        await screen.findByText('A');
        const input = screen.getByPlaceholderText('Send a message... (type / for skills)');
        fireEvent.change(input, { target: { value: 'More' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() => {
            const errorBubble = container.querySelector('.chat-error-bubble');
            expect(errorBubble).toBeDefined();
            expect(errorBubble!.textContent).toContain('Session');
        });
    });
});

describe('QueueView', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ queued: [], running: [], stats: {}, history: [] }),
        });
    });

    it('renders without crashing', () => {
        const { container } = render(<Wrap><QueueView /></Wrap>);
        expect(container).toBeDefined();
    });
});
