/**
 * Tests for ConversationTurnBubble — semantic CSS hook classes and copy button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/processes/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

// Mock useDisplaySettings — module-level cache, no provider needed
vi.mock('../../../src/server/spa/client/react/hooks/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

// Mock markdown renderer to avoid DOM-heavy dependencies
vi.mock('../../../src/server/spa/client/react/processes/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />,
}));

vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'user',
        content: 'Hello world',
        timestamp: '2026-01-15T10:30:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble — semantic hooks', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // --- chat-message class + role ---

    it('adds .chat-message.user on user turns', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const el = container.querySelector('.chat-message.user');
        expect(el).toBeTruthy();
        expect(container.querySelector('.chat-message.assistant')).toBeNull();
    });

    it('adds .chat-message.assistant on assistant turns', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const el = container.querySelector('.chat-message.assistant');
        expect(el).toBeTruthy();
        expect(container.querySelector('.chat-message.user')).toBeNull();
    });

    // --- streaming class ---

    it('adds .streaming class when turn.streaming is true', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ streaming: true })} />);
        const el = container.querySelector('.chat-message.streaming');
        expect(el).toBeTruthy();
    });

    it('does not add .streaming class when turn.streaming is false', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ streaming: false })} />);
        expect(container.querySelector('.chat-message.streaming')).toBeNull();
    });

    // --- role-label ---

    it('renders .role-label with "You" for user turns', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const label = container.querySelector('.role-label');
        expect(label).toBeTruthy();
        expect(label!.textContent).toBe('You');
    });

    it('renders .role-label with "Assistant" for assistant turns', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const label = container.querySelector('.role-label');
        expect(label).toBeTruthy();
        expect(label!.textContent).toBe('Assistant');
    });

    // --- timestamp ---

    it('renders .timestamp when turn.timestamp is set', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ timestamp: '2026-01-15T10:30:00Z' })} />);
        const ts = container.querySelector('.timestamp');
        expect(ts).toBeTruthy();
        expect(ts!.textContent!.length).toBeGreaterThan(0);
    });

    it('does not render .timestamp when turn.timestamp is undefined', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ timestamp: undefined })} />);
        expect(container.querySelector('.timestamp')).toBeNull();
    });

    // --- streaming-indicator ---

    it('renders .streaming-indicator on streaming turns', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ streaming: true })} />);
        const indicator = container.querySelector('.streaming-indicator');
        expect(indicator).toBeTruthy();
        expect(indicator!.textContent).toBe('Live');
    });

    it('does not render .streaming-indicator on non-streaming turns', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ streaming: false })} />);
        expect(container.querySelector('.streaming-indicator')).toBeNull();
    });

    // --- chat-message-content ---

    it('renders .chat-message-content wrapper', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn()} />);
        const content = container.querySelector('.chat-message-content');
        expect(content).toBeTruthy();
    });

    it('nests .markdown-body inside .chat-message-content for border styling', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn()} />);
        const md = container.querySelector('.chat-message-content .markdown-body');
        expect(md).toBeTruthy();
    });

    // --- bubble-copy-btn ---

    it('renders .bubble-copy-btn for assistant messages', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const btn = container.querySelector('.bubble-copy-btn');
        expect(btn).toBeTruthy();
    });

    it('does not render .bubble-copy-btn for user messages', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        expect(container.querySelector('.bubble-copy-btn')).toBeNull();
    });

    it('copies turn.content to clipboard when .bubble-copy-btn is clicked', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        });

        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'assistant', content: 'Copy me!' })} />
        );
        const btn = container.querySelector('.bubble-copy-btn') as HTMLButtonElement;
        fireEvent.click(btn);
        expect(writeText).toHaveBeenCalledWith('Copy me!');
    });

    // --- group class on inner bubble (for group-hover) ---

    it('adds group class on inner bubble div for hover support', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const outer = container.querySelector('.chat-message');
        const inner = outer?.querySelector('.group');
        expect(inner).toBeTruthy();
    });

    // --- no Tailwind classes removed ---

    it('preserves existing Tailwind classes on outer wrapper', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const outer = container.querySelector('.chat-message');
        expect(outer?.classList.contains('flex')).toBe(true);
        expect(outer?.classList.contains('justify-end')).toBe(true);
    });

    it('preserves justify-start on assistant outer wrapper', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const outer = container.querySelector('.chat-message');
        expect(outer?.classList.contains('justify-start')).toBe(true);
    });
});

describe('ConversationTurnBubble — whitespace-only content suppression', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('does not render empty markdown-body div for whitespace-only user content', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user', content: '   ' })} />);
        expect(container.querySelector('.markdown-body')).toBeNull();
    });

    it('does not render empty markdown-body div for newline-only user content', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user', content: '\n' })} />);
        expect(container.querySelector('.markdown-body')).toBeNull();
    });

    it('does not render empty markdown-body div for empty string user content', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user', content: '' })} />);
        expect(container.querySelector('.markdown-body')).toBeNull();
    });

    it('does not render markdown-body for whitespace-only timeline content event', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    role: 'assistant',
                    content: '',
                    timeline: [
                        { type: 'content', content: '  \n  ' },
                        {
                            type: 'tool-start',
                            toolCall: { id: 'tool-1', toolName: 'grep', args: {}, status: 'completed' },
                        },
                    ],
                })}
            />
        );
        expect(container.querySelector('.markdown-body')).toBeNull();
    });

    it('still renders markdown-body for non-whitespace content', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user', content: 'Hello' })} />);
        expect(container.querySelector('.markdown-body')).toBeTruthy();
    });
});

describe('ConversationTurnBubble — task boundary inference', () => {
    it('keeps tool calls after task-complete at root level without timestamps', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    role: 'assistant',
                    content: '',
                    timeline: [
                        {
                            type: 'tool-start',
                            toolCall: {
                                id: 'task-1',
                                toolName: 'task',
                                args: { agent_type: 'explore', description: 'Inspect wiki files' },
                                status: 'running',
                            },
                        },
                        {
                            type: 'tool-start',
                            toolCall: {
                                id: 'view-inside',
                                toolName: 'view',
                                args: { path: '/Users/test/Documents/Projects/shortcuts/packages/coc/src/server/wiki/wiki-data.ts' },
                                status: 'completed',
                            },
                        },
                        {
                            type: 'tool-complete',
                            toolCall: {
                                id: 'task-1',
                                toolName: 'task',
                                args: { agent_type: 'explore', description: 'Inspect wiki files' },
                                status: 'completed',
                            },
                        },
                        {
                            type: 'tool-start',
                            toolCall: {
                                id: 'view-outside',
                                toolName: 'view',
                                args: { path: '/Users/test/Documents/Projects/shortcuts/packages/coc/src/server/spa/client/react/wiki/WikiList.tsx' },
                                status: 'completed',
                            },
                        },
                    ],
                })}
            />
        );

        const taskCard = container.querySelector('[data-tool-id="task-1"]');
        const taskChildren = taskCard?.querySelector('.tool-call-children');
        const insideView = container.querySelector('[data-tool-id="view-inside"]');
        const outsideView = container.querySelector('[data-tool-id="view-outside"]');

        expect(taskCard).toBeTruthy();
        expect(taskChildren?.querySelector('[data-tool-id="view-inside"]')).toBeTruthy();
        expect(taskChildren?.querySelector('[data-tool-id="view-outside"]')).toBeNull();
        expect(insideView).toBeTruthy();
        expect(outsideView).toBeTruthy();
        expect(taskCard?.contains(outsideView as HTMLElement)).toBe(false);
    });

    it('keeps tool calls after task-complete at root level with timestamps', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    role: 'assistant',
                    content: '',
                    timeline: [
                        {
                            type: 'tool-start',
                            timestamp: '2026-02-23T10:00:00.000Z',
                            toolCall: {
                                id: 'task-2',
                                toolName: 'task',
                                args: { agent_type: 'explore', description: 'Inspect task renderer' },
                                startTime: '2026-02-23T10:00:00.000Z',
                                status: 'running',
                            },
                        },
                        {
                            type: 'tool-start',
                            timestamp: '2026-02-23T10:00:01.000Z',
                            toolCall: {
                                id: 'view-inside-timed',
                                toolName: 'view',
                                args: { path: '/Users/test/Documents/Projects/shortcuts/packages/coc/src/server/wiki/wiki-manager.ts' },
                                startTime: '2026-02-23T10:00:01.000Z',
                                endTime: '2026-02-23T10:00:02.000Z',
                                status: 'completed',
                            },
                        },
                        {
                            type: 'tool-complete',
                            timestamp: '2026-02-23T10:00:03.000Z',
                            toolCall: {
                                id: 'task-2',
                                toolName: 'task',
                                args: { agent_type: 'explore', description: 'Inspect task renderer' },
                                startTime: '2026-02-23T10:00:00.000Z',
                                endTime: '2026-02-23T10:00:03.000Z',
                                status: 'completed',
                            },
                        },
                        {
                            type: 'tool-start',
                            timestamp: '2026-02-23T10:00:04.000Z',
                            toolCall: {
                                id: 'view-outside-timed',
                                toolName: 'view',
                                args: { path: '/Users/test/Documents/Projects/shortcuts/packages/coc/src/server/spa/client/react/wiki/WikiList.tsx' },
                                startTime: '2026-02-23T10:00:04.000Z',
                                endTime: '2026-02-23T10:00:05.000Z',
                                status: 'completed',
                            },
                        },
                    ],
                })}
            />
        );

        const taskCard = container.querySelector('[data-tool-id="task-2"]');
        const taskChildren = taskCard?.querySelector('.tool-call-children');
        const outsideView = container.querySelector('[data-tool-id="view-outside-timed"]');

        expect(taskCard).toBeTruthy();
        expect(taskChildren?.querySelector('[data-tool-id="view-inside-timed"]')).toBeTruthy();
        expect(taskChildren?.querySelector('[data-tool-id="view-outside-timed"]')).toBeNull();
        expect(outsideView).toBeTruthy();
        expect(taskCard?.contains(outsideView as HTMLElement)).toBe(false);
    });
});
