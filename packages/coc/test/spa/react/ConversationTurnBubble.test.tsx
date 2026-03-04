/**
 * Tests for ConversationTurnBubble — semantic CSS hook classes and copy button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/processes/ConversationTurnBubble';
import { mergeConsecutiveContentChunks } from '../../../src/server/spa/client/react/processes/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';
import * as formatUtils from '../../../src/server/spa/client/react/utils/format';

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

    it('renders .bubble-copy-btn for user messages', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        expect(container.querySelector('.bubble-copy-btn')).toBeTruthy();
    });

    it('copies turn.content to clipboard when .bubble-copy-btn is clicked', async () => {
        const spy = vi.spyOn(formatUtils, 'copyToClipboard').mockResolvedValue(undefined);

        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'assistant', content: 'Copy me!' })} />
        );
        const btn = container.querySelector('.bubble-copy-btn') as HTMLButtonElement;
        await act(async () => { fireEvent.click(btn); });
        expect(spy).toHaveBeenCalledWith('Copy me!');
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

describe('ConversationTurnBubble — timeline content merging', () => {
    it('renders merged content instead of one-per-chunk when timeline has consecutive content items', () => {
        const timeline = Array.from({ length: 10 }, (_, i) => ({
            type: 'content' as const,
            timestamp: `2026-01-15T10:30:0${i}Z`,
            content: `word${i} `,
        }));

        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    role: 'assistant',
                    content: 'word0 word1 word2 word3 word4 word5 word6 word7 word8 word9 ',
                    timeline,
                })}
            />
        );

        const markdownViews = container.querySelectorAll('[data-testid="markdown-view"]');
        // All 10 content items should be merged into 1 markdown view
        expect(markdownViews.length).toBe(1);
        // The merged content should contain all words
        const html = markdownViews[0].innerHTML;
        expect(html).toContain('word0');
        expect(html).toContain('word9');
    });

    it('preserves tool boundaries when merging content', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    role: 'assistant',
                    content: '',
                    timeline: [
                        { type: 'content', timestamp: '2026-01-15T10:30:00Z', content: 'before ' },
                        { type: 'content', timestamp: '2026-01-15T10:30:01Z', content: 'tool ' },
                        {
                            type: 'tool-start',
                            timestamp: '2026-01-15T10:30:02Z',
                            toolCall: { id: 'grep-1', toolName: 'grep', args: {}, status: 'running' },
                        },
                        {
                            type: 'tool-complete',
                            timestamp: '2026-01-15T10:30:03Z',
                            toolCall: { id: 'grep-1', toolName: 'grep', args: {}, status: 'completed', result: 'found' },
                        },
                        { type: 'content', timestamp: '2026-01-15T10:30:04Z', content: 'after ' },
                        { type: 'content', timestamp: '2026-01-15T10:30:05Z', content: 'tool' },
                    ],
                })}
            />
        );

        const markdownViews = container.querySelectorAll('[data-testid="markdown-view"]');
        // 2 content groups (before+tool and after+tool) — not 4 individual ones
        expect(markdownViews.length).toBe(2);

        // Tool call card should be present
        const toolCard = container.querySelector('[data-tool-id="grep-1"]');
        expect(toolCard).toBeTruthy();
    });
});

describe('ConversationTurnBubble — suggest_follow_ups hidden', () => {
    it('does not render suggest_follow_ups tool call in tool tree', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    role: 'assistant',
                    content: 'Here is my answer.',
                    timeline: [
                        { type: 'content', content: 'Here is my answer.' },
                        {
                            type: 'tool-start',
                            toolCall: {
                                id: 'suggest-1',
                                toolName: 'suggest_follow_ups',
                                args: {},
                                status: 'running',
                            },
                        },
                        {
                            type: 'tool-complete',
                            toolCall: {
                                id: 'suggest-1',
                                toolName: 'suggest_follow_ups',
                                args: {},
                                status: 'completed',
                                result: JSON.stringify({ suggestions: ['Q1', 'Q2'] }),
                            },
                        },
                    ],
                })}
            />
        );
        expect(container.querySelector('[data-tool-id="suggest-1"]')).toBeNull();
    });

    it('still renders other tool calls alongside suggest_follow_ups', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    role: 'assistant',
                    content: '',
                    timeline: [
                        {
                            type: 'tool-start',
                            toolCall: { id: 'grep-1', toolName: 'grep', args: {}, status: 'completed' },
                        },
                        {
                            type: 'tool-start',
                            toolCall: { id: 'suggest-1', toolName: 'suggest_follow_ups', args: {}, status: 'completed' },
                        },
                        {
                            type: 'tool-complete',
                            toolCall: { id: 'suggest-1', toolName: 'suggest_follow_ups', args: {}, status: 'completed' },
                        },
                    ],
                })}
            />
        );
        expect(container.querySelector('[data-tool-id="grep-1"]')).toBeTruthy();
        expect(container.querySelector('[data-tool-id="suggest-1"]')).toBeNull();
    });
});

import { afterEach } from 'vitest';

describe('ConversationTurnBubble — copy button feedback', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows ✓ after successful copy and resets after 1.5s', async () => {
        vi.spyOn(formatUtils, 'copyToClipboard').mockResolvedValue(undefined);

        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'user', content: 'Hello' })} />
        );
        const btn = container.querySelector('.bubble-copy-btn') as HTMLButtonElement;
        expect(btn.textContent).toBe('📋');

        await act(async () => { fireEvent.click(btn); });
        expect(btn.textContent).toBe('✓');

        // After 1.5s, should reset
        await act(async () => { vi.advanceTimersByTime(1500); });
        expect(btn.textContent).toBe('📋');
    });

    it('keeps 📋 when copy fails', async () => {
        vi.spyOn(formatUtils, 'copyToClipboard').mockRejectedValue(new Error('denied'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'user', content: 'Hello' })} />
        );
        const btn = container.querySelector('.bubble-copy-btn') as HTMLButtonElement;

        await act(async () => { fireEvent.click(btn); });
        expect(btn.textContent).toBe('📋');
        expect(consoleSpy).toHaveBeenCalledWith('Copy failed:', expect.any(Error));
    });

    it('uses copyToClipboard utility (not navigator.clipboard directly)', async () => {
        const spy = vi.spyOn(formatUtils, 'copyToClipboard').mockResolvedValue(undefined);

        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'assistant', content: 'test content' })} />
        );
        const btn = container.querySelector('.bubble-copy-btn') as HTMLButtonElement;
        await act(async () => { fireEvent.click(btn); });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('test content');
    });

    it('copies empty string when turn.content is undefined', async () => {
        const spy = vi.spyOn(formatUtils, 'copyToClipboard').mockResolvedValue(undefined);

        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'user', content: undefined as any })} />
        );
        const btn = container.querySelector('.bubble-copy-btn') as HTMLButtonElement;
        await act(async () => { fireEvent.click(btn); });
        expect(spy).toHaveBeenCalledWith('');
    });
});

describe('mergeConsecutiveContentChunks', () => {
    it('returns empty array unchanged', () => {
        expect(mergeConsecutiveContentChunks([])).toEqual([]);
    });

    it('passes through a single content chunk unchanged', () => {
        const chunks = [{ kind: 'content' as const, key: 'c1', html: '<p>hello</p>' }];
        const result = mergeConsecutiveContentChunks(chunks);
        expect(result).toHaveLength(1);
        expect(result[0].html).toBe('<p>hello</p>');
        expect(result[0].key).toBe('c1');
    });

    it('merges two consecutive content chunks into one', () => {
        const chunks = [
            { kind: 'content' as const, key: 'c1', html: '<p>first</p>' },
            { kind: 'content' as const, key: 'c2', html: '<p>second</p>' },
        ];
        const result = mergeConsecutiveContentChunks(chunks);
        expect(result).toHaveLength(1);
        expect(result[0].html).toBe('<p>first</p><p>second</p>');
        expect(result[0].key).toBe('c1');
    });

    it('merges multiple consecutive content chunks, using first key', () => {
        const chunks = [
            { kind: 'content' as const, key: 'c1', html: '<p>A</p>' },
            { kind: 'content' as const, key: 'c2', html: '<p>B</p>' },
            { kind: 'content' as const, key: 'c3', html: '<p>C</p>' },
        ];
        const result = mergeConsecutiveContentChunks(chunks);
        expect(result).toHaveLength(1);
        expect(result[0].html).toBe('<p>A</p><p>B</p><p>C</p>');
        expect(result[0].key).toBe('c1');
    });

    it('preserves tool chunks and does not merge content across them', () => {
        const chunks = [
            { kind: 'content' as const, key: 'c1', html: '<p>first</p>' },
            { kind: 'tool' as const, key: 'tool-1', toolId: 'tool-1' },
            { kind: 'content' as const, key: 'c2', html: '<p>second</p>' },
        ];
        const result = mergeConsecutiveContentChunks(chunks);
        expect(result).toHaveLength(3);
        expect(result[0].html).toBe('<p>first</p>');
        expect(result[1].kind).toBe('tool');
        expect(result[2].html).toBe('<p>second</p>');
    });

    it('merges consecutive content on both sides of a tool chunk independently', () => {
        const chunks = [
            { kind: 'content' as const, key: 'c1', html: '<p>A</p>' },
            { kind: 'content' as const, key: 'c2', html: '<p>B</p>' },
            { kind: 'tool' as const, key: 'tool-1', toolId: 'tool-1' },
            { kind: 'content' as const, key: 'c3', html: '<p>C</p>' },
            { kind: 'content' as const, key: 'c4', html: '<p>D</p>' },
        ];
        const result = mergeConsecutiveContentChunks(chunks);
        expect(result).toHaveLength(3);
        expect(result[0].html).toBe('<p>A</p><p>B</p>');
        expect(result[1].kind).toBe('tool');
        expect(result[2].html).toBe('<p>C</p><p>D</p>');
    });

    it('preserves parentToolId from the first chunk in a merged group', () => {
        const chunks = [
            { kind: 'content' as const, key: 'c1', html: '<p>A</p>', parentToolId: 'task-1' },
            { kind: 'content' as const, key: 'c2', html: '<p>B</p>', parentToolId: 'task-1' },
        ];
        const result = mergeConsecutiveContentChunks(chunks);
        expect(result).toHaveLength(1);
        expect(result[0].parentToolId).toBe('task-1');
    });
});

describe('ConversationTurnBubble — content chunk merging', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders content events separated by top-level report_intent as a single markdown-view', () => {
        const turn = makeTurn({
            role: 'assistant',
            content: '',
            timeline: [
                { type: 'content', timestamp: 't1', content: "I'll explore in parallel." },
                {
                    type: 'tool-start',
                    timestamp: 't2',
                    toolCall: { id: 'ri-1', toolName: 'report_intent', args: { intent: 'Exploring codebase' }, status: 'running' },
                },
                {
                    type: 'tool-complete',
                    timestamp: 't3',
                    toolCall: { id: 'ri-1', toolName: 'report_intent', args: { intent: 'Exploring codebase' }, status: 'completed' },
                },
                { type: 'content', timestamp: 't4', content: 'Let me look at the files.' },
            ] as any,
        });
        const { container } = render(<ConversationTurnBubble turn={turn} />);
        const markdownViews = container.querySelectorAll('[data-testid="markdown-view"]');
        expect(markdownViews.length).toBe(1);
    });

    it('renders content events inside a task separated by report_intent as a single markdown-view', () => {
        const turn = makeTurn({
            role: 'assistant',
            content: '',
            timeline: [
                {
                    type: 'tool-start',
                    timestamp: 't0',
                    toolCall: { id: 'task-1', toolName: 'task', args: { agent_type: 'explore', description: 'test' }, status: 'running' },
                },
                { type: 'content', timestamp: 't1', content: 'First line.' },
                {
                    type: 'tool-start',
                    timestamp: 't2',
                    toolCall: { id: 'ri-1', toolName: 'report_intent', args: { intent: 'Exploring' }, status: 'running', parentToolCallId: 'task-1' },
                },
                {
                    type: 'tool-complete',
                    timestamp: 't3',
                    toolCall: { id: 'ri-1', toolName: 'report_intent', args: { intent: 'Exploring' }, status: 'completed', parentToolCallId: 'task-1' },
                },
                { type: 'content', timestamp: 't4', content: 'Second line.' },
                {
                    type: 'tool-complete',
                    timestamp: 't5',
                    toolCall: { id: 'task-1', toolName: 'task', args: { agent_type: 'explore', description: 'test' }, status: 'completed' },
                },
            ] as any,
        });
        const { container } = render(<ConversationTurnBubble turn={turn} />);
        // Expand the task subtree to show children
        const toggleBtn = container.querySelector('.tool-call-header button[aria-label]') as HTMLButtonElement;
        if (toggleBtn) fireEvent.click(toggleBtn);
        const markdownViews = container.querySelectorAll('[data-testid="markdown-view"]');
        expect(markdownViews.length).toBe(1);
    });
});

describe('ConversationTurnBubble — retry button', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders .error class on outer wrapper for isError assistant turns', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'assistant', isError: true })} />
        );
        const outer = container.querySelector('.chat-message');
        expect(outer?.classList.contains('error')).toBe(true);
    });

    it('does not render .error class on non-error turns', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'assistant', isError: false })} />
        );
        expect(container.querySelector('.chat-message.error')).toBeNull();
    });

    it('renders .error-indicator on isError assistant turns', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'assistant', isError: true })} />
        );
        expect(container.querySelector('.error-indicator')).toBeTruthy();
    });

    it('does not render .error-indicator on non-error turns', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        expect(container.querySelector('.error-indicator')).toBeNull();
    });

    it('renders .bubble-retry-btn when turn.isError and onRetry is provided', () => {
        const onRetry = vi.fn();
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ role: 'assistant', isError: true })}
                onRetry={onRetry}
            />
        );
        expect(container.querySelector('.bubble-retry-btn')).toBeTruthy();
    });

    it('does not render .bubble-retry-btn when turn.isError is false', () => {
        const onRetry = vi.fn();
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ role: 'assistant', isError: false })}
                onRetry={onRetry}
            />
        );
        expect(container.querySelector('.bubble-retry-btn')).toBeNull();
    });

    it('does not render .bubble-retry-btn when onRetry is not provided', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'assistant', isError: true })} />
        );
        expect(container.querySelector('.bubble-retry-btn')).toBeNull();
    });

    it('does not render .bubble-retry-btn for user turns even with isError', () => {
        const onRetry = vi.fn();
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ role: 'user', isError: true })}
                onRetry={onRetry}
            />
        );
        expect(container.querySelector('.bubble-retry-btn')).toBeNull();
    });

    it('calls onRetry when .bubble-retry-btn is clicked', async () => {
        const onRetry = vi.fn();
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ role: 'assistant', isError: true })}
                onRetry={onRetry}
            />
        );
        const btn = container.querySelector('.bubble-retry-btn') as HTMLButtonElement;
        await act(async () => { fireEvent.click(btn); });
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('has data-testid="retry-turn-btn" on the retry button', () => {
        const onRetry = vi.fn();
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ role: 'assistant', isError: true })}
                onRetry={onRetry}
            />
        );
        expect(container.querySelector('[data-testid="retry-turn-btn"]')).toBeTruthy();
    });
});
