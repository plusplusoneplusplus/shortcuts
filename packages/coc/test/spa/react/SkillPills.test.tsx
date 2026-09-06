import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { SkillPills } from '../../../src/server/spa/client/react/features/chat/conversation/SkillPills';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => (
        <div data-testid="markdown-view" className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    ),
}));

vi.mock('../../../src/server/spa/client/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (text: string) => `<p>${text}</p>`,
}));

const SELECTED_SKILLS_BLOCK = [
    '<selected_skills>',
    'The user explicitly selected these skills: impl, submit-commits-as-pr.',
    'Load the selected skill instructions from these SKILL.md files before proceeding:',
    '- impl: /skills/impl/SKILL.md',
    '- submit-commits-as-pr: /skills/submit-commits-as-pr/SKILL.md',
    'Apply the selected skill(s) to the request that follows.',
    '</selected_skills>',
].join('\n');

const CHAT_MODE_BLOCK = ['<coc-chat-mode>', 'Current mode: ask.', '</coc-chat-mode>'].join('\n');

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'user',
        content: 'Explain the change.',
        timestamp: '2026-01-15T14:19:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('SkillPills', () => {
    it('renders one pill per name, in order', () => {
        const { getByTestId, getAllByTestId } = render(
            <SkillPills names={['impl', 'code-review', 'submit-commits-as-pr']} />,
        );

        const pills = getAllByTestId('selected-skill-pill');
        expect(pills.map(pill => pill.textContent)).toEqual(['impl', 'code-review', 'submit-commits-as-pr']);
        expect(pills.map(pill => pill.getAttribute('title'))).toEqual(['impl', 'code-review', 'submit-commits-as-pr']);
        expect(getByTestId('selected-skills-pills').textContent).toContain('Skills');
    });

    it('renders nothing for an empty list', () => {
        const { queryByTestId, container } = render(<SkillPills names={[]} />);

        expect(queryByTestId('selected-skills-pills')).toBeNull();
        expect(container.innerHTML).toBe('');
    });
});

describe('ConversationTurnBubble — selected skills', () => {
    it('renders the pills above the message body and strips the block from the text', () => {
        const content = `${SELECTED_SKILLS_BLOCK}\n\n${CHAT_MODE_BLOCK}\n\nOpen a PR for the last commit.`;
        const { getByTestId, getAllByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        expect(getAllByTestId('selected-skill-pill').map(pill => pill.textContent))
            .toEqual(['impl', 'submit-commits-as-pr']);

        const message = getByTestId('user-plain-text');
        expect(message.textContent).toBe('Open a PR for the last commit.');
        expect(message.textContent).not.toContain('<selected_skills>');
        // Regression: the chat-mode block after the skills block used to leak into the body.
        expect(message.textContent).not.toContain('<coc-chat-mode>');

        const pills = getByTestId('selected-skills-pills');
        expect(pills.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('offers the raw skills block as a disclosure', () => {
        const content = `${SELECTED_SKILLS_BLOCK}\n\nOpen a PR.`;
        const { getByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        const toggle = getByTestId('selected-skills-block-toggle');
        expect(toggle.textContent).toContain('Selected skills');
        fireEvent.click(toggle);
        expect(getByTestId('selected-skills-block-body').textContent).toBe(SELECTED_SKILLS_BLOCK);
    });

    it('renders no pills when the turn has no skills block', () => {
        const { queryByTestId } = render(<ConversationTurnBubble turn={makeTurn()} />);

        expect(queryByTestId('selected-skills-pills')).toBeNull();
        expect(queryByTestId('selected-skills-block-disclosure')).toBeNull();
    });

    it('hides the pills and keeps the original content in raw view', () => {
        const content = `${SELECTED_SKILLS_BLOCK}\n\nOpen a PR.`;
        const { container, queryByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        fireEvent.click(container.querySelector('.bubble-raw-btn') as HTMLButtonElement);
        expect(container.querySelector('.raw-content-view')?.textContent).toBe(content);
        expect(queryByTestId('selected-skills-pills')).toBeNull();
    });
});
