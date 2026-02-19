/**
 * Tests for React Processes and Queue components.
 * Verifies rendering, filtering, and interaction behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ProcessFilters } from '../../../src/server/spa/client/react/processes/ProcessFilters';
import { ProcessList } from '../../../src/server/spa/client/react/processes/ProcessList';
import { ProcessDetail } from '../../../src/server/spa/client/react/processes/ProcessDetail';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/processes/ConversationTurnBubble';
import { ProcessesView } from '../../../src/server/spa/client/react/processes/ProcessesView';
import { ToolCallView } from '../../../src/server/spa/client/react/processes/ToolCallView';
import { MarkdownView } from '../../../src/server/spa/client/react/processes/MarkdownView';
import { QueuePanel } from '../../../src/server/spa/client/react/queue/QueuePanel';
import { QueueView } from '../../../src/server/spa/client/react/queue/QueueView';

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider><QueueProvider>{children}</QueueProvider></AppProvider>;
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
});

describe('ProcessDetail', () => {
    it('shows empty state when no process selected', () => {
        render(<Wrap><ProcessDetail /></Wrap>);
        expect(screen.getByText('Select a process to view details')).toBeDefined();
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
});

describe('ProcessesView', () => {
    it('renders the two-pane layout', () => {
        render(<Wrap><ProcessesView /></Wrap>);
        const view = document.getElementById('view-processes');
        expect(view).not.toBeNull();
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
