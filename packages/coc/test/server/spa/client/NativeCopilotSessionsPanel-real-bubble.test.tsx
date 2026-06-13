/**
 * @vitest-environment jsdom
 *
 * End-to-end render integration for the native Copilot session detail view.
 *
 * Two existing suites each cover one half of AC-03 but leave a seam between
 * them untested:
 *   - `NativeCopilotSessionsPanel.test.tsx` STUBS `ConversationTurnBubble`, so it
 *     proves the panel's fetch→prop wiring but never the real chat bubble.
 *   - `ConversationTurnBubble-native-reconstruction.test.tsx` renders the REAL
 *     bubble but feeds `toClientConversationTurns` DIRECTLY, bypassing the panel
 *     and its detail fetch.
 *
 * Neither exercises the actual production path AC-03's "demo shows a rich
 * transcript" relies on:
 *
 *     NativeCopilotSessionsPanel → cocClient.get() → SessionDetailView
 *       → toClientConversationTurns(detail.conversation) → real ConversationTurnBubble → DOM
 *
 * This suite renders the REAL panel with the REAL bubble (no component stub) and
 * a mocked detail fetch returning a rich reconstructed conversation shaped like
 * real `session-state/<id>/events.jsonl` output, then asserts the genuine
 * tool-call cards, assistant markdown, the reasoning fold, the user image
 * gallery, and tool errors all reach the DOM through the panel — the
 * deterministic equivalent of the live screenshot.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────────
// One coc client serves BOTH the panel (nativeCliSessions.list/get) and the
// real bubble's image gallery (queue.images). Everything else — the `ui` barrel,
// the chat bubble, ToolCallView, the mapper — is the REAL module.

const mockList = vi.fn();
const mockGet = vi.fn();

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        nativeCliSessions: { list: mockList, get: mockGet },
        queue: { images: vi.fn() },
    }),
}));

// Passthrough markdown so assistant markdown HTML lands verbatim in the DOM, and
// a stable display-settings hook — mirrors the established bubble render harness.
vi.mock('../../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => (
        <div data-testid="markdown-view" className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

import { NativeCopilotSessionsPanel } from '../../../../src/server/spa/client/react/features/native-copilot-sessions/NativeCopilotSessionsPanel';

// ── Helpers ──────────────────────────────────────────────────────────────────

function setFlag(enabled: boolean): void {
    (window as any).__DASHBOARD_CONFIG__ = {
        apiBasePath: '/api',
        wsPath: '/ws',
        features: { nativeCliSessionsEnabled: enabled },
    };
}

function makeListItem() {
    return {
        id: 'session-rich-1',
        repository: 'owner/repo',
        cwd: '/workspace/path',
        hostType: 'github',
        branch: 'main',
        summaryPreview: 'Inspect the native session store',
        createdAt: '2026-06-12T14:51:00.000Z',
        updatedAt: '2026-06-12T14:53:00.000Z',
        turnCount: 3,
        matchSnippets: [],
        provider: 'codex',
        storePath: '/home/me/.codex/sessions',
        searchIndexAvailable: false,
    };
}

function makeListResponse(items: unknown[]) {
    return {
        enabled: true,
        available: true,
        items,
        total: items.length,
        searchIndexAvailable: true,
        limit: 50,
        offset: 0,
    };
}

/**
 * A rich reconstructed conversation modeled on real session 09c6d69e: a user ask
 * with an attached image, an assistant turn that reasons (folded into content),
 * answers in markdown, and runs a `bash` tool that succeeds, then a follow-up
 * assistant turn whose `bash` tool call fails with an error.
 */
function makeRichDetailResponse() {
    return {
        enabled: true,
        available: true,
        session: {
            id: 'session-rich-1',
            repository: 'owner/repo',
            cwd: '/workspace/path',
            hostType: 'github',
            branch: 'main',
            summary: 'Inspect the native session store and report its schema.',
            createdAt: '2026-06-12T14:51:00.000Z',
            updatedAt: '2026-06-12T14:53:00.000Z',
            turns: [],
            provider: 'codex',
            storePath: '/home/me/.codex/sessions',
            searchIndexAvailable: false,
            conversation: [
                {
                    role: 'user',
                    content: 'can you check the session-store.db and see what is inside?',
                    timestamp: '2026-06-12T14:52:00.000Z',
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
            ],
        },
    };
}

async function openDetail() {
    mockList.mockResolvedValue(makeListResponse([makeListItem()]));
    mockGet.mockResolvedValue(makeRichDetailResponse());
    render(<NativeCopilotSessionsPanel workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByTestId('native-sessions-table')).toBeTruthy());
    fireEvent.click(screen.getAllByTestId('native-session-row')[0]);
    const detail = await screen.findByTestId('native-session-detail');
    return detail;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NativeCopilotSessionsPanel — real ConversationTurnBubble integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setFlag(true);
        window.location.hash = '';
    });

    afterEach(() => {
        cleanup();
        window.location.hash = '';
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    it('renders the rich transcript through the panel fetch→mapper→real bubble path', async () => {
        const detail = await openDetail();
        expect(mockGet).toHaveBeenCalledWith('ws-1', 'session-rich-1', 'codex');

        // Metadata header preserved alongside the transcript.
        expect(detail.textContent).toContain('Inspect the native session store and report its schema.');
        expect(screen.getByTestId('native-session-conversation').textContent).toContain('Conversation (3)');

        // The GENUINE ToolCallView surface rendered (not the panel suite's stub):
        // both bash calls render as full cards with their names.
        const cards = detail.querySelectorAll('.tool-call-card');
        expect(cards.length).toBe(2);
        const toolNames = Array.from(detail.querySelectorAll('.tool-call-name')).map(n => n.textContent);
        expect(toolNames).toContain('bash');

        // Rich result + error fidelity reaches the DOM through the real card body.
        expect(detail.textContent).toContain('forge_trajectory_events');
        expect(detail.textContent).toContain('ENOENT: no such file or directory');
    });

    it('renders assistant markdown and the folded reasoning blockquote via the real bubble', async () => {
        const detail = await openDetail();
        const md = Array.from(detail.querySelectorAll('[data-testid="markdown-view"]'))
            .map(n => n.textContent)
            .join('\n');
        // Assistant markdown body.
        expect(md).toContain('Database overview');
        expect(md).toContain('session-store.db');
        // Model reasoning folded into the content stream (the chat type has no
        // dedicated thinking slot — the mapper prepends a blockquote).
        expect(md).toContain('Reasoning');
        expect(md).toContain('inspect the schema');
    });

    it('renders the user image gallery for the attached image', async () => {
        const detail = await openDetail();
        expect(detail.querySelector('[data-testid="image-gallery"]')).toBeTruthy();
    });

    it('stays strictly read-only: no CoC chat action controls anywhere in the panel', async () => {
        await openDetail();
        for (const action of ['follow-up', 'follow up', 'archive', 'pin', 'delete', 'resume', 'retry conversation']) {
            const pattern = new RegExp(`^${action}$`, 'i');
            expect(screen.queryByRole('button', { name: pattern })).toBeNull();
        }
    });
});
