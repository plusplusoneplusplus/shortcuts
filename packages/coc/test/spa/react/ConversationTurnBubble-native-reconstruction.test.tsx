/**
 * Render integration test for the native Copilot session detail transcript.
 *
 * The `NativeCopilotSessionsPanel` suite stubs `ConversationTurnBubble` to keep
 * its focus on panel↔mapper wiring, so it never proves the *real* chat bubble
 * renders a native-reconstructed turn. This suite closes that AC-03 DoD gap:
 * it feeds a reconstructed conversation (shaped like real
 * `session-state/<id>/events.jsonl` output — tool-call timeline items, model
 * reasoning fold, a user image, and a failed tool call) through the real
 * `toClientConversationTurns` mapper into the real `ConversationTurnBubble`,
 * and asserts tool-call cards, markdown content, the reasoning fold, images,
 * and tool errors actually reach the DOM — with no component fork.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import { toClientConversationTurns } from '../../../src/server/spa/client/react/features/native-copilot-sessions/nativeConversationTurns';
import type { ReconstructedConversationTurn } from '@plusplusoneplusplus/coc-client';

// Mirror the established ConversationTurnBubble render harness: a passthrough
// MarkdownView (so assistant markdown HTML lands in the DOM verbatim), a stable
// display-settings hook, and a no-network coc client for the image gallery.
vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));
vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => (
        <div data-testid="markdown-view" className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    ),
}));
vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ queue: { images: vi.fn() } }),
}));

/**
 * A reconstructed conversation shaped like the real parser output for session
 * 09c6d69e: a user ask (with an attached image), an assistant turn that reasons,
 * answers in markdown, and runs a `bash` tool that succeeds, then a follow-up
 * assistant turn whose tool call fails.
 */
function makeReconstructedConversation(): ReconstructedConversationTurn[] {
    const ts = '2026-06-12T14:52:00.000Z';
    return [
        {
            role: 'user',
            content: 'can you check the session-store.db see what is inside?',
            timestamp: ts,
            turnIndex: 0,
            timeline: [],
            images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=='],
        },
        {
            role: 'assistant',
            content: '## Database overview\n\nThe `session-store.db` file is a SQLite database.',
            timestamp: '2026-06-12T14:52:10.000Z',
            turnIndex: 1,
            model: 'gpt-5.5',
            thinking: 'I should inspect the schema before dumping any rows.',
            toolCalls: [
                {
                    id: 'tc-bash-1',
                    toolName: 'bash',
                    args: { command: 'sqlite3 session-store.db .tables', description: 'list tables' },
                    result: 'sessions  turns  forge_trajectory_events  checkpoints',
                    status: 'completed',
                    startTime: '2026-06-12T14:52:11.000Z',
                    endTime: '2026-06-12T14:52:12.000Z',
                },
            ],
            timeline: [
                { type: 'content', timestamp: '2026-06-12T14:52:10.000Z', content: '## Database overview\n\nThe `session-store.db` file is a SQLite database.' },
                { type: 'tool-start', timestamp: '2026-06-12T14:52:11.000Z', toolCall: { id: 'tc-bash-1', toolName: 'bash', args: { command: 'sqlite3 session-store.db .tables' }, status: 'running' } },
                { type: 'tool-complete', timestamp: '2026-06-12T14:52:12.000Z', toolCall: { id: 'tc-bash-1', toolName: 'bash', args: { command: 'sqlite3 session-store.db .tables' }, result: 'sessions  turns  forge_trajectory_events  checkpoints', status: 'completed' } },
            ],
        },
        {
            // A normal assistant turn whose tool call fails mid-turn: the failed
            // tool renders as its own card (not a turn-level error banner).
            role: 'assistant',
            content: '',
            timestamp: '2026-06-12T14:52:20.000Z',
            turnIndex: 2,
            model: 'gpt-5.5',
            toolCalls: [
                {
                    id: 'tc-bash-2',
                    toolName: 'bash',
                    args: { command: 'cat /nope/missing.txt' },
                    error: 'ENOENT: no such file or directory',
                    status: 'failed',
                },
            ],
            timeline: [
                { type: 'tool-start', timestamp: '2026-06-12T14:52:20.000Z', toolCall: { id: 'tc-bash-2', toolName: 'bash', args: { command: 'cat /nope/missing.txt' }, status: 'running' } },
                { type: 'tool-failed', timestamp: '2026-06-12T14:52:21.000Z', toolCall: { id: 'tc-bash-2', toolName: 'bash', args: { command: 'cat /nope/missing.txt' }, error: 'ENOENT: no such file or directory', status: 'failed' } },
            ],
        },
        {
            // A turn-level error (e.g. the model stream errored): renders the
            // error-strip banner with the error detail, not a tool card.
            role: 'assistant',
            content: 'The session ended unexpectedly while reading the database.',
            timestamp: '2026-06-12T14:52:30.000Z',
            turnIndex: 3,
            model: 'gpt-5.5',
            isError: true,
            timeline: [
                { type: 'content', timestamp: '2026-06-12T14:52:30.000Z', content: 'The session ended unexpectedly while reading the database.' },
            ],
        },
    ];
}

function renderConversation() {
    const turns = toClientConversationTurns(makeReconstructedConversation());
    const { container } = render(
        <div>
            {turns.map((turn, i) => (
                <ConversationTurnBubble key={i} turn={turn} wsId="ws-test" provider="copilot" />
            ))}
        </div>,
    );
    return { container, turns };
}

describe('ConversationTurnBubble — native reconstructed transcript', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('maps a reconstructed conversation into one bubble per turn, in order', () => {
        const { turns } = renderConversation();
        expect(turns.map(t => t.role)).toEqual(['user', 'assistant', 'assistant', 'assistant']);
    });

    it('renders the real tool-call card with the tool name and result (not a mocked stub)', () => {
        const { container } = renderConversation();
        // The genuine ToolCallView surface, not the panel suite's stub.
        expect(container.querySelector('.tool-call-card')).toBeTruthy();
        const names = Array.from(container.querySelectorAll('.tool-call-name')).map(n => n.textContent);
        expect(names).toContain('bash');
        // The tool result reaches the card body (rich fidelity, not just the name).
        expect(container.textContent).toContain('forge_trajectory_events');
    });

    it('renders assistant markdown content through the markdown view', () => {
        const { container } = renderConversation();
        const md = Array.from(container.querySelectorAll('[data-testid="markdown-view"]'))
            .map(n => n.textContent)
            .join('\n');
        expect(md).toContain('Database overview');
        expect(md).toContain('session-store.db');
    });

    it('folds model reasoning into the rendered assistant content (no thinking slot in the chat type)', () => {
        const { container, turns } = renderConversation();
        // The mapper prepends the reasoning as a markdown blockquote in content + timeline…
        expect(turns[1].content).toContain('Reasoning');
        expect(turns[1].content).toContain('inspect the schema');
        // …and it reaches the DOM via the real bubble's markdown rendering.
        const md = Array.from(container.querySelectorAll('[data-testid="markdown-view"]'))
            .map(n => n.textContent)
            .join('\n');
        expect(md).toContain('Reasoning');
        expect(md).toContain('inspect the schema');
    });

    it('renders the user image gallery for an attached image', () => {
        const { container } = renderConversation();
        expect(container.querySelector('[data-testid="image-gallery"]')).toBeTruthy();
    });

    it('surfaces a failed tool call as a card with its error text', () => {
        const { container } = renderConversation();
        // Both the succeeding and failing tool calls render as full cards.
        const cards = container.querySelectorAll('.tool-call-card');
        expect(cards.length).toBe(2);
        // The failure error message reaches the DOM (rich error fidelity).
        expect(container.textContent).toContain('ENOENT: no such file or directory');
    });

    it('renders a turn-level error as the error-strip banner with its detail', () => {
        const { container } = renderConversation();
        const strip = container.querySelector('[data-testid="error-strip"]');
        expect(strip).toBeTruthy();
        expect(container.querySelector('[data-testid="error-strip-detail"]')?.textContent)
            .toContain('session ended unexpectedly');
    });
});
