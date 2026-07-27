// @vitest-environment jsdom
/**
 * Tests for ConversationTurnBubble — scoping NoteEditCards to the open note.
 *
 * A chat process accumulates note-edit snapshots for every note it has touched.
 * When rendered inside the notes panel, `openNotePath` is supplied so only the
 * card whose recorded `notePath` matches the open note is shown. Elsewhere
 * (`openNotePath` undefined) every card renders, preserving prior behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />,
}));

vi.mock('../../../src/server/spa/client/react/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({}),
}));

function makeAssistantTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'assistant',
        content: 'Done editing.',
        timestamp: '2026-01-15T10:30:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

const noteEdits = [
    {
        editId: 'edit-open',
        notePath: 'training-papers.md',
        preEditContent: 'before A',
        postEditContent: 'after A',
        timestamp: '2026-01-15T10:30:01Z',
        turnIndex: 0,
    },
    {
        editId: 'edit-other',
        notePath: '12-2026 Cruise Trip.md',
        preEditContent: 'before B',
        postEditContent: 'after B',
        timestamp: '2026-01-15T10:30:02Z',
        turnIndex: 0,
    },
];

describe('ConversationTurnBubble — NoteEditCard scope', () => {
    it('renders only the card matching openNotePath', () => {
        render(
            <ConversationTurnBubble
                turn={makeAssistantTurn()}
                turnIndex={0}
                wsId="ws1"
                processId="proc1"
                noteEdits={noteEdits}
                openNotePath="training-papers.md"
            />
        );
        const cards = screen.getAllByTestId('note-edit-card');
        expect(cards).toHaveLength(1);
        expect(screen.getByText('training-papers.md')).toBeTruthy();
        expect(screen.queryByText('12-2026 Cruise Trip.md')).toBeNull();
    });

    it('renders no card when the open note has no edits', () => {
        render(
            <ConversationTurnBubble
                turn={makeAssistantTurn()}
                turnIndex={0}
                wsId="ws1"
                processId="proc1"
                noteEdits={noteEdits}
                openNotePath="unrelated.md"
            />
        );
        expect(screen.queryByTestId('note-edit-card')).toBeNull();
    });

    it('renders all cards when openNotePath is undefined (existing behavior)', () => {
        render(
            <ConversationTurnBubble
                turn={makeAssistantTurn()}
                turnIndex={0}
                wsId="ws1"
                processId="proc1"
                noteEdits={noteEdits}
            />
        );
        expect(screen.getAllByTestId('note-edit-card')).toHaveLength(2);
    });
});
