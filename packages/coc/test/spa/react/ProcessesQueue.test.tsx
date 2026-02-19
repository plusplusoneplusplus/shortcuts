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
import { ProcessList } from '../../../src/server/spa/client/react/processes/ProcessList';
import { ProcessDetail } from '../../../src/server/spa/client/react/processes/ProcessDetail';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/processes/ConversationTurnBubble';
import { ProcessesView } from '../../../src/server/spa/client/react/processes/ProcessesView';
import { ToolCallView } from '../../../src/server/spa/client/react/processes/ToolCallView';
import { MarkdownView } from '../../../src/server/spa/client/react/processes/MarkdownView';
import { QueuePanel } from '../../../src/server/spa/client/react/queue/QueuePanel';
import { QueueView } from '../../../src/server/spa/client/react/queue/QueueView';
import { QueueTaskDetail } from '../../../src/server/spa/client/react/queue/QueueTaskDetail';

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider><QueueProvider>{children}</QueueProvider></AppProvider>;
}

function SeededProcessList({ processes }: { processes: any[] }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_PROCESSES', processes });
    }, [dispatch, processes]);
    return <ProcessList />;
}

function SeededProcessDetail({ process }: { process: any }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_PROCESSES', processes: [process] });
        dispatch({ type: 'SELECT_PROCESS', id: process.id });
    }, [dispatch, process]);
    return <ProcessDetail />;
}

function SeededQueuePanel({ historyItem }: { historyItem: any }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'SET_HISTORY', history: [historyItem] });
        dispatch({ type: 'TOGGLE_HISTORY' });
    }, [dispatch, historyItem]);
    return <QueuePanel />;
}

function SeededQueueTaskDetail({ task }: { task: any }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'SET_HISTORY', history: [task] });
        dispatch({ type: 'SELECT_QUEUE_TASK', id: task.id });
    }, [dispatch, task]);
    return <QueueTaskDetail />;
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

describe('ProcessList', () => {
    it('shows empty state when no processes', () => {
        render(<Wrap><ProcessList /></Wrap>);
        expect(screen.getByText('No processes found')).toBeDefined();
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
        expect(screen.getByText('claude-haiku-4.5')).toBeDefined();
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
});

describe('ConversationTurnBubble', () => {
    it('renders role label and message content', () => {
        render(
            <Wrap>
                <ConversationTurnBubble turn={{ role: 'user', content: '<p>Hello</p>', timeline: [] }} />
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

    it('interleaves content and tool calls based on timeline order', () => {
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
        expect(text.indexOf('task')).toBeLessThan(text.indexOf('SEGMENT_TWO'));
        expect(text.indexOf('SEGMENT_TWO')).toBeLessThan(text.indexOf('view'));
        expect(text.indexOf('view')).toBeLessThan(text.indexOf('glob'));
        expect(text.indexOf('glob')).toBeLessThan(text.indexOf('SEGMENT_THREE'));
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
        fireEvent.click(screen.getByRole('button', { name: 'Collapse subtools' }));
        expect(screen.queryByText('view')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Expand subtools' }));
        expect(screen.getByText('view')).toBeDefined();
    });
});

describe('ProcessesView', () => {
    it('renders the two-pane layout', () => {
        render(<Wrap><ProcessesView /></Wrap>);
        const view = document.getElementById('view-processes');
        expect(view).not.toBeNull();
    });

    it('keeps sidebar width fixed with a non-shrinking layout', () => {
        const { container } = render(<Wrap><ProcessesView /></Wrap>);
        const aside = container.querySelector('#view-processes > aside');
        const main = container.querySelector('#view-processes > main');

        expect(aside).not.toBeNull();
        expect(main).not.toBeNull();
        expect(aside!.className).toContain('w-[320px]');
        expect(aside!.className).toContain('min-w-[320px]');
        expect(aside!.className).toContain('max-w-[320px]');
        expect(aside!.className).toContain('shrink-0');
        expect(main!.className).toContain('min-w-0');
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
        render(<Wrap><ToolCallView toolCall={{ toolName: 'edit', args: { path: '/test.ts' }, status: 'completed' }} /></Wrap>);
        fireEvent.click(screen.getByText('edit'));
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
        render(<Wrap><ToolCallView toolCall={{ toolName: 'edit', args: { a: 1 }, status: 'completed' }} /></Wrap>);
        expect(screen.queryByText('Arguments')).toBeNull();
        fireEvent.click(screen.getByText('edit'));
        expect(screen.getByText('Arguments')).toBeDefined();
        fireEvent.click(screen.getByText('edit'));
        expect(screen.queryByText('Arguments')).toBeNull();
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

describe('QueuePanel', () => {
    it('renders stats bar', () => {
        render(<Wrap><QueuePanel /></Wrap>);
        expect(screen.getByText(/0 queued/)).toBeDefined();
        expect(screen.getByText(/0 running/)).toBeDefined();
    });

    it('renders enqueue button', () => {
        render(<Wrap><QueuePanel /></Wrap>);
        expect(screen.getByText('+ Enqueue')).toBeDefined();
    });

    it('renders history toggle', () => {
        render(<Wrap><QueuePanel /></Wrap>);
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
                        type: 'ai-clarification',
                        prompt: 'History route test',
                    }}
                />
            </Wrap>
        );

        const taskCardText = await screen.findByText('History route test');
        fireEvent.click(taskCardText);
        expect(window.location.hash).toBe('#process/queue_task-route-1');
    });

    it('renders history cards in compact single-line format', async () => {
        render(
            <Wrap>
                <SeededQueuePanel
                    historyItem={{
                        id: 'task-compact-1',
                        status: 'completed',
                        type: 'follow-prompt',
                        prompt: 'Compact history item should stay on one line',
                    }}
                />
            </Wrap>
        );

        const card = await screen.findByLabelText(/Task completed: Compact history item should stay on one line/);
        expect(card.className).toContain('px-2');
        expect(card.className).toContain('py-1.5');
        expect((card as HTMLElement).querySelector('.line-clamp-1')).toBeNull();
        expect(card.textContent).toContain('Completed');
        expect(card.textContent).toContain('follow-prompt');
    });
});

describe('QueueTaskDetail metadata popover', () => {
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
                        type: 'ai-clarification',
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

describe('QueueTaskDetail follow-up input', () => {
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
                        type: 'ai-clarification',
                        prompt: 'First question',
                    }}
                />
            </Wrap>
        );

        await screen.findByText('First answer');

        const input = screen.getByPlaceholderText('Continue this conversation...');
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
                        type: 'ai-clarification',
                        prompt: 'Start',
                    }}
                />
            </Wrap>
        );

        await screen.findByText('Done');

        const input = screen.getByPlaceholderText('Continue this conversation...');
        fireEvent.change(input, { target: { value: 'Need more' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() => {
            expect(screen.getByText('Session expired. Start a new task to continue.')).toBeDefined();
        });

        expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByPlaceholderText('Session expired. Start a new task to continue.') as HTMLTextAreaElement).disabled).toBe(true);
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
