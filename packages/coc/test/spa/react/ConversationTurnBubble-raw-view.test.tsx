/**
 * Tests for ConversationTurnBubble — raw content view toggle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ConversationTurnBubble, _buildRawContent } from '../../../src/server/spa/client/react/processes/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

vi.mock('../../../src/server/spa/client/react/processes/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />,
}));

vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'assistant',
        content: 'Hello world',
        timestamp: '2026-01-15T10:30:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble — raw view toggle', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // --- Toggle button rendering ---

    it('renders .bubble-raw-btn for assistant messages', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn()} />);
        const btn = container.querySelector('.bubble-raw-btn');
        expect(btn).toBeTruthy();
    });

    it('renders .bubble-raw-btn for user messages', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        expect(container.querySelector('.bubble-raw-btn')).toBeTruthy();
    });

    it('renders .bubble-copy-btn for user messages', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        expect(container.querySelector('.bubble-copy-btn')).toBeTruthy();
    });

    it('raw button has title "View raw content" by default', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn()} />);
        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        expect(btn.title).toBe('View raw content');
    });

    it('raw button text contains </>', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn()} />);
        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        expect(btn.textContent).toBe('</>');
    });

    // --- Toggle behavior ---

    it('does not show raw-content-view by default', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn()} />);
        expect(container.querySelector('.raw-content-view')).toBeNull();
    });

    it('shows rendered content by default (markdown-body visible)', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ content: 'Some text' })} />);
        expect(container.querySelector('.markdown-body')).toBeTruthy();
    });

    it('shows raw-content-view after clicking toggle', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ content: 'Hello' })} />);
        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(btn);
        expect(container.querySelector('.raw-content-view')).toBeTruthy();
    });

    it('hides rendered content when raw view is active', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ content: 'Hello' })} />);
        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(btn);
        // markdown-body should not appear in chat-message-content at top level
        // (it may still be in the raw view's child elements, but not as the rendered view)
        const rawView = container.querySelector('.raw-content-view');
        expect(rawView).toBeTruthy();
        // The markdown-body from MarkdownView should not be rendered
        expect(container.querySelector('[data-testid="markdown-view"]')).toBeNull();
    });

    it('toggles back to rendered view on second click', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ content: 'Hello' })} />);
        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(btn); // ON
        expect(container.querySelector('.raw-content-view')).toBeTruthy();
        fireEvent.click(btn); // OFF
        expect(container.querySelector('.raw-content-view')).toBeNull();
        expect(container.querySelector('[data-testid="markdown-view"]')).toBeTruthy();
    });

    it('updates button title when toggled to raw mode', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn()} />);
        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(btn);
        expect(btn.title).toBe('View rendered content');
    });

    // --- Raw content display ---

    it('displays turn.content in raw view', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: 'Raw markdown **text**' })} />
        );
        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(btn);
        const rawView = container.querySelector('.raw-content-view');
        expect(rawView?.textContent).toContain('Raw markdown **text**');
    });

    it('displays tool calls in raw view from timeline', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    content: 'Some text',
                    timeline: [
                        {
                            type: 'tool-start',
                            timestamp: '2026-01-15T10:30:01Z',
                            toolCall: {
                                id: 'tc-1',
                                toolName: 'grep',
                                args: { pattern: 'foo' },
                                status: 'completed',
                            },
                        },
                        {
                            type: 'tool-complete',
                            timestamp: '2026-01-15T10:30:02Z',
                            toolCall: {
                                id: 'tc-1',
                                toolName: 'grep',
                                args: { pattern: 'foo' },
                                status: 'completed',
                                result: 'file.ts:10:foo',
                            },
                        },
                    ],
                })}
            />
        );
        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(btn);
        const rawView = container.querySelector('.raw-content-view');
        expect(rawView?.textContent).toContain('--- tool: grep [completed] ---');
        expect(rawView?.textContent).toContain('Args:');
        expect(rawView?.textContent).toContain('Result: file.ts:10:foo');
    });

    it('displays tool calls in raw view from toolCalls fallback', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    content: 'Response',
                    timeline: [],
                    toolCalls: [
                        {
                            id: 'tc-2',
                            toolName: 'view',
                            args: { path: '/some/file.ts' },
                            status: 'completed',
                            result: 'file contents',
                        },
                    ],
                })}
            />
        );
        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(btn);
        const rawView = container.querySelector('.raw-content-view');
        expect(rawView?.textContent).toContain('--- tool: view [completed] ---');
        expect(rawView?.textContent).toContain('Result: file contents');
    });

    it('displays error in raw view', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    content: '',
                    timeline: [
                        {
                            type: 'tool-failed',
                            timestamp: '2026-01-15T10:30:01Z',
                            toolCall: {
                                id: 'tc-err',
                                toolName: 'bash',
                                args: { command: 'exit 1' },
                                status: 'failed',
                                error: 'Command failed with exit code 1',
                            },
                        },
                    ],
                })}
            />
        );
        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(btn);
        const rawView = container.querySelector('.raw-content-view');
        expect(rawView?.textContent).toContain('Error: Command failed with exit code 1');
    });

    // --- Copy button behavior in raw mode ---

    it('copy button copies raw content when in raw mode', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        });

        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    content: 'Raw text',
                    timeline: [
                        {
                            type: 'tool-start',
                            timestamp: '2026-01-15T10:30:01Z',
                            toolCall: {
                                id: 'tc-copy',
                                toolName: 'grep',
                                args: { pattern: 'test' },
                                status: 'completed',
                            },
                        },
                    ],
                })}
            />
        );

        // Toggle to raw mode
        const rawBtn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(rawBtn);

        // Click copy
        const copyBtn = container.querySelector('.bubble-copy-btn') as HTMLButtonElement;
        fireEvent.click(copyBtn);

        // Should contain the raw content including tool info
        expect(writeText).toHaveBeenCalledTimes(1);
        const copied = writeText.mock.calls[0][0];
        expect(copied).toContain('Raw text');
        expect(copied).toContain('--- tool: grep');
    });

    it('copy button copies turn.content when in rendered mode', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        });

        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: 'Just content' })} />
        );

        const copyBtn = container.querySelector('.bubble-copy-btn') as HTMLButtonElement;
        fireEvent.click(copyBtn);

        expect(writeText).toHaveBeenCalledWith('Just content');
    });

    // --- User message raw view ---

    it('user message: clicking raw button shows raw content instead of markdown', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'user', content: 'Hello **bold**' })} />
        );
        // Initially shows markdown, not raw
        expect(container.querySelector('[data-testid="markdown-view"]')).toBeTruthy();
        expect(container.querySelector('.raw-content-view')).toBeNull();

        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(btn);

        // Now shows raw content, not markdown
        expect(container.querySelector('.raw-content-view')).toBeTruthy();
        expect(container.querySelector('[data-testid="markdown-view"]')).toBeNull();
    });

    it('user message: raw view shows turn.content verbatim', () => {
        const rawText = '[Skill Guidance: impl]\n# Some heading\n**bold** text';
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'user', content: rawText })} />
        );
        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(btn);
        const rawView = container.querySelector('.raw-content-view');
        expect(rawView?.textContent).toBe(rawText);
    });

    it('user message: toggling back shows markdown view again', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'user', content: 'Hello' })} />
        );
        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(btn); // ON
        expect(container.querySelector('.raw-content-view')).toBeTruthy();
        fireEvent.click(btn); // OFF
        expect(container.querySelector('.raw-content-view')).toBeNull();
        expect(container.querySelector('[data-testid="markdown-view"]')).toBeTruthy();
    });

    it('user message: copy button copies raw text when in raw mode', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        });

        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'user', content: 'User raw text' })} />
        );
        const rawBtn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(rawBtn);

        const copyBtn = container.querySelector('.bubble-copy-btn') as HTMLButtonElement;
        fireEvent.click(copyBtn);

        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText.mock.calls[0][0]).toContain('User raw text');
    });

    // --- Visual indicator ---

    it('raw button gets highlighted style when active', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn()} />);
        const btn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;

        // Before toggle - no inline style
        expect(btn.style.color).toBe('');

        // After toggle - highlighted
        fireEvent.click(btn);
        expect(btn.style.color).toBe('rgb(0, 120, 212)');
    });
});

describe('buildRawContent', () => {
    it('returns content only when no tool calls', () => {
        const result = _buildRawContent(makeTurn({ content: 'Hello world', timeline: [], toolCalls: [] }));
        expect(result).toBe('Hello world');
    });

    it('returns empty string when no content and no tools', () => {
        const result = _buildRawContent(makeTurn({ content: '', timeline: [], toolCalls: [] }));
        expect(result).toBe('');
    });

    it('includes tool call from timeline', () => {
        const result = _buildRawContent(makeTurn({
            content: 'Before',
            timeline: [
                {
                    type: 'tool-start',
                    timestamp: '2026-01-15T10:30:00Z',
                    toolCall: {
                        id: 't1',
                        toolName: 'grep',
                        args: { pattern: 'hello' },
                        status: 'completed',
                        result: 'match found',
                    },
                },
            ],
        }));
        expect(result).toContain('Before');
        expect(result).toContain('--- tool: grep [completed] ---');
        expect(result).toContain('"pattern": "hello"');
        expect(result).toContain('Result: match found');
    });

    it('merges duplicate tool call IDs from timeline', () => {
        const result = _buildRawContent(makeTurn({
            content: '',
            timeline: [
                {
                    type: 'tool-start',
                    timestamp: '2026-01-15T10:30:00Z',
                    toolCall: {
                        id: 't1',
                        toolName: 'grep',
                        args: { pattern: 'hello' },
                        status: 'running',
                    },
                },
                {
                    type: 'tool-complete',
                    timestamp: '2026-01-15T10:30:01Z',
                    toolCall: {
                        id: 't1',
                        toolName: 'grep',
                        args: { pattern: 'hello' },
                        status: 'completed',
                        result: 'done',
                    },
                },
            ],
        }));
        // Should only have one tool block, with merged status
        const toolBlocks = result.match(/--- tool: grep/g);
        expect(toolBlocks).toHaveLength(1);
        expect(result).toContain('[completed]');
        expect(result).toContain('Result: done');
    });

    it('falls back to toolCalls when timeline has no tool events', () => {
        const result = _buildRawContent(makeTurn({
            content: 'Content',
            timeline: [],
            toolCalls: [
                {
                    id: 'tc-1',
                    toolName: 'view',
                    args: { path: '/file.ts' },
                    status: 'completed',
                    result: 'file text',
                },
            ],
        }));
        expect(result).toContain('--- tool: view [completed] ---');
        expect(result).toContain('Result: file text');
    });

    it('includes error field when present', () => {
        const result = _buildRawContent(makeTurn({
            content: '',
            timeline: [
                {
                    type: 'tool-failed',
                    timestamp: '2026-01-15T10:30:00Z',
                    toolCall: {
                        id: 'e1',
                        toolName: 'bash',
                        args: { command: 'bad' },
                        status: 'failed',
                        error: 'exit code 1',
                    },
                },
            ],
        }));
        expect(result).toContain('[failed]');
        expect(result).toContain('Error: exit code 1');
    });

    it('truncates large results to 2000 chars', () => {
        const longResult = 'x'.repeat(3000);
        const result = _buildRawContent(makeTurn({
            content: '',
            timeline: [
                {
                    type: 'tool-complete',
                    timestamp: '2026-01-15T10:30:00Z',
                    toolCall: {
                        id: 'big',
                        toolName: 'view',
                        args: { path: '/big.ts' },
                        status: 'completed',
                        result: longResult,
                    },
                },
            ],
        }));
        expect(result).toContain('... (truncated)');
        expect(result.length).toBeLessThan(3000);
    });

    it('handles string args', () => {
        const result = _buildRawContent(makeTurn({
            content: '',
            timeline: [
                {
                    type: 'tool-start',
                    timestamp: '2026-01-15T10:30:00Z',
                    toolCall: {
                        id: 'str-args',
                        toolName: 'custom',
                        args: 'raw string args' as any,
                        status: 'pending',
                    },
                },
            ],
        }));
        expect(result).toContain('Args: raw string args');
    });

    it('handles multiple tool calls', () => {
        const result = _buildRawContent(makeTurn({
            content: 'Start',
            timeline: [
                {
                    type: 'tool-start',
                    timestamp: '2026-01-15T10:30:00Z',
                    toolCall: { id: 'a', toolName: 'grep', args: {}, status: 'completed' },
                },
                {
                    type: 'tool-start',
                    timestamp: '2026-01-15T10:30:01Z',
                    toolCall: { id: 'b', toolName: 'view', args: {}, status: 'completed' },
                },
            ],
        }));
        expect(result).toContain('--- tool: grep [completed] ---');
        expect(result).toContain('--- tool: view [completed] ---');
    });
});
