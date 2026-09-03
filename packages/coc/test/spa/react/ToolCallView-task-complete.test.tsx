/**
 * Tests for ToolCallView — task_complete and suggest_follow_ups tool rendering.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';
import { ToolCallVariantProvider } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallVariant';
import { ChatRenderContextProvider } from '../../../src/server/spa/client/react/features/chat/conversation/ChatRenderContext';
import { chatMarkdownToHtml } from '../../../src/server/spa/client/react/features/chat/conversation/markdownHtml';

vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

function makeTaskCompleteCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-complete-1',
        toolName: 'task_complete',
        args: { summary: 'Added **new feature** with tests.' },
        status: 'completed',
        result: 'Added **new feature** with tests.',
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
        ...overrides,
    };
}

function makeSuggestFollowUpsCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-followups-1',
        toolName: 'suggest_follow_ups',
        args: { suggestions: ['Run the tests', 'Review the diff', 'Deploy to staging'] },
        status: 'completed',
        result: '',
        ...overrides,
    };
}

function makeAskUserCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-ask-user-1',
        toolName: 'ask_user',
        args: {
            questions: [
                { question: 'Which git tab should render this question?', type: 'select' },
            ],
        },
        status: 'completed',
        result: JSON.stringify([{ questionId: 'q1', answer: 'activity' }]),
        ...overrides,
    };
}

function getHeader(container: HTMLElement) {
    return container.querySelector('.tool-call-header');
}

function getBody(container: HTMLElement) {
    return container.querySelector('.tool-call-body');
}

describe('ToolCallView — task_complete rendering', () => {
    it('shows summary text in the collapsed header', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall()} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('Added **new feature** with tests.');
    });

    it('shows truncated summary in header for long summaries', () => {
        const longSummary = 'A'.repeat(100);
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall({ args: { summary: longSummary }, result: longSummary })} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('A'.repeat(77) + '...');
    });

    it('shows "Task completed" when summary is empty', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall({ args: {}, result: '' })} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('Task completed');
    });

    it('defaults to expanded state', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall()} />
        );
        const body = getBody(container);
        expect(body).toBeTruthy();
        expect(body!.classList.contains('hidden')).toBe(false);
    });

    it('renders result as markdown, not plain text', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall()} />
        );
        const mdEl = container.querySelector('[data-testid="task-complete-markdown"]');
        expect(mdEl).toBeTruthy();
        expect(mdEl!.innerHTML).toContain('<p>');
        // MarkdownView owns the rendered body, so the `markdown-body` surface
        // (and with it hljs, mermaid/svg, tables, canvas embeds, lightbox)
        // lives inside the task-complete wrapper.
        expect(mdEl!.querySelector('.markdown-body')).toBeTruthy();
        expect(mdEl!.querySelector('strong')?.textContent).toBe('new feature');
    });

    it('does not render generic Arguments or Result sections', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall()} />
        );
        const body = getBody(container)!;
        const labels = body.querySelectorAll('.text-\\[10px\\]');
        const labelTexts = Array.from(labels).map(el => el.textContent);
        expect(labelTexts).not.toContain('Arguments');
        expect(labelTexts).not.toContain('Result');
    });

    it('falls back to args.summary when result is empty', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall({ result: '' })} />
        );
        const mdEl = container.querySelector('[data-testid="task-complete-markdown"]');
        expect(mdEl).toBeTruthy();
        expect(mdEl!.textContent).toContain('Added new feature with tests.');
        expect(mdEl!.querySelector('strong')?.textContent).toBe('new feature');
    });

    it('can be collapsed by clicking the header', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall()} />
        );
        // Initially expanded
        let body = getBody(container)!;
        expect(body.classList.contains('hidden')).toBe(false);

        // Click to collapse
        const header = getHeader(container)!;
        fireEvent.click(header);
        body = getBody(container)!;
        expect(body.classList.contains('hidden')).toBe(true);
    });
});

/**
 * The expanded task_complete body must go through the same markdown pipeline as
 * an assistant chat message (`chatMarkdownToHtml` + `MarkdownView`), so the
 * rendered HTML is compared against that renderer's output directly.
 */
describe('ToolCallView — task_complete markdown parity with chat messages', () => {
    function renderSummary(summary: string, ctx?: Record<string, any>) {
        const call = makeTaskCompleteCall({ args: { summary }, result: summary });
        const { container } = ctx
            ? render(
                <ChatRenderContextProvider value={ctx}>
                    <ToolCallView toolCall={call} />
                </ChatRenderContextProvider>
            )
            : render(<ToolCallView toolCall={call} />);
        return container.querySelector('[data-testid="task-complete-markdown"] .markdown-body')!;
    }

    const cases: Array<[string, string]> = [
        ['paragraphs and line breaks', 'First line\nsecond line\n\nSecond paragraph.'],
        ['bulleted lists', '- one\n- two\n- three'],
        ['ordered lists', '1. first\n2. second'],
        ['inline code', 'Call `buildToolCallRenderModel()` first.'],
        ['fenced code blocks', 'Done:\n\n```ts\nconst x: number = 1;\n```'],
        ['links', 'See [the docs](https://example.com/docs).'],
        ['raw HTML', 'Careful: <script>alert(1)</script> and <b>bold</b>.'],
        ['headings and emphasis', '## Summary\n\nShipped *the* **thing**.'],
    ];

    for (const [label, markdown] of cases) {
        it(`renders ${label} exactly like a chat message`, () => {
            const el = renderSummary(markdown);
            expect(el.innerHTML).toBe(chatMarkdownToHtml(markdown));
        });
    }

    it('escapes raw HTML instead of executing it', () => {
        const el = renderSummary('Careful: <script>alert(1)</script>');
        expect(el.querySelector('script')).toBeNull();
        expect(el.textContent).toContain('<script>alert(1)</script>');
    });

    it('keeps the shared safe-link attributes on external links', () => {
        const el = renderSummary('See [the docs](https://example.com/docs).');
        const link = el.querySelector('a[href="https://example.com/docs"]')!;
        expect(link).toBeTruthy();
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toContain('noopener');
    });

    it('resolves workspace-local image paths from the surrounding conversation', () => {
        const markdown = '![shot](docs/shot.png)';
        const el = renderSummary(markdown, { wsId: 'ws-42' });
        const img = el.querySelector('img')!;
        expect(img).toBeTruthy();
        expect(img.getAttribute('src')).toContain('ws-42');
        expect(el.innerHTML).toBe(chatMarkdownToHtml(markdown, 'ws-42', {}));
    });

    it('does not resolve workspace-local images without a workspace in context', () => {
        const markdown = '![shot](docs/shot.png)';
        const el = renderSummary(markdown);
        expect(el.innerHTML).not.toContain('ws-42');
        expect(el.innerHTML).toBe(chatMarkdownToHtml(markdown));
    });

    it('passes the conversation embed options through to the renderer', () => {
        const markdown = 'canvas://my-canvas';
        const el = renderSummary(markdown, { wsId: 'ws-9', canvasEmbedEnabled: true });
        const embed = el.querySelector('.md-canvas-embed')!;
        expect(embed).toBeTruthy();
        expect(embed.getAttribute('data-canvas-id')).toBe('my-canvas');
        expect(embed.getAttribute('data-ws-id')).toBe('ws-9');
    });
});

describe('ToolCallView — task_complete body in the whisper-row variant', () => {
    it('uses the same shared markdown body as the card variant', () => {
        const summary = '- one\n- two';
        const call = makeTaskCompleteCall({ args: { summary }, result: summary });

        const card = render(<ToolCallView toolCall={call} />);
        const whisper = render(
            <ToolCallVariantProvider value="whisper-row">
                <ToolCallView toolCall={call} />
            </ToolCallVariantProvider>
        );

        const cardBody = card.container.querySelector('[data-testid="task-complete-markdown"] .markdown-body')!;
        const whisperBody = whisper.container.querySelector('[data-testid="task-complete-markdown"] .markdown-body')!;
        expect(whisperBody).toBeTruthy();
        expect(whisperBody.innerHTML).toBe(cardBody.innerHTML);
        expect(whisperBody.querySelectorAll('li')).toHaveLength(2);
    });

    it('keeps the whisper header plain text and truncated', () => {
        const summary = 'Added **new feature** with tests.';
        const { container } = render(
            <ToolCallVariantProvider value="whisper-row">
                <ToolCallView toolCall={makeTaskCompleteCall({ args: { summary }, result: summary })} />
            </ToolCallVariantProvider>
        );
        const path = container.querySelector('.tool-call-row-path')!;
        expect(path.textContent).toContain('Added **new feature** with tests.');
        expect(path.querySelector('strong')).toBeNull();
        expect(path.className).toContain('truncate');
    });
});

describe('ToolCallView — task_complete summary source and empty handling', () => {
    it('prefers the tool result over args.summary', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall({
                args: { summary: 'From args' },
                result: 'From result',
            })} />
        );
        const mdEl = container.querySelector('[data-testid="task-complete-markdown"]')!;
        expect(mdEl.textContent).toContain('From result');
        expect(mdEl.textContent).not.toContain('From args');
    });

    it('renders no markdown body and a plain header when the summary is empty', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall({ args: {}, result: '' })} />
        );
        expect(container.querySelector('[data-testid="task-complete-markdown"]')).toBeNull();
        expect(getHeader(container)!.textContent).toContain('Task completed');
    });

    it('leaves the card header as plain, unrendered text', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskCompleteCall()} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('Added **new feature** with tests.');
        expect(header.querySelector('strong')).toBeNull();
        expect(header.querySelector('.markdown-body')).toBeNull();
    });
});

describe('ToolCallView — suggest_follow_ups summary', () => {
    it('shows suggestions joined with · in header', () => {
        const { container } = render(
            <ToolCallView toolCall={makeSuggestFollowUpsCall()} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('Run the tests · Review the diff · Deploy to staging');
    });
});

describe('ToolCallView — ask_user summary', () => {
    it('shows the first args.questions question in the collapsed header', () => {
        const { container } = render(
            <ToolCallView toolCall={makeAskUserCall()} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('Which git tab should render this question?');
        expect(header.textContent).not.toContain('Ask user');
    });

    it('shows how many additional questions are present', () => {
        const { container } = render(
            <ToolCallView toolCall={makeAskUserCall({
                args: {
                    questions: [
                        { question: 'First question?', type: 'text' },
                        { question: 'Second question?', type: 'text' },
                    ],
                },
            })} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('First question? (+1 more)');
    });
});

describe('ToolCallView — read_agent summary', () => {
    it('shows agent ID in header summary', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'ra-1',
                toolName: 'read_agent',
                args: { agent_id: 'agent-0', wait: true, timeout: 10 },
                status: 'completed',
                result: 'agent completed',
            }} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('Agent agent-0 (wait)');
    });

    it('shows agent ID without wait flag when wait is false', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'ra-2',
                toolName: 'read_agent',
                args: { agent_id: 'agent-5' },
                status: 'completed',
            }} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('Agent agent-5');
        expect(header.textContent).not.toContain('(wait)');
    });

    it('shows empty summary when agent_id is missing', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'ra-3',
                toolName: 'read_agent',
                args: {},
                status: 'completed',
            }} />
        );
        const header = getHeader(container)!;
        expect(header.textContent).toContain('read_agent');
        expect(header.textContent).not.toContain('Agent');
    });
});
