import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
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

const CHAT_STYLE_BLOCK = [
    '<chat-style>',
    'Selected style: Structured.',
    'Focus on clear sections.',
    '</chat-style>',
].join('\n');

const CHAT_MODE_BLOCK = [
    '<coc-chat-mode>',
    'Current mode: ask.',
    '</coc-chat-mode>',
].join('\n');

const REPO_GROUP_CONTEXT = [
    '<repo_group_context>',
    'Repo group "My Team" members:',
    '- Repo A: /home/me/repos/a',
    '</repo_group_context>',
].join('\n');

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

const SELECTED_SKILLS_BLOCK = [
    '<selected_skills>',
    'The user explicitly selected these skills: impl, submit-commits-as-pr.',
    'Load the selected skill instructions from these SKILL.md files before proceeding:',
    '- impl: /skills/impl/SKILL.md',
    '- submit-commits-as-pr: /skills/submit-commits-as-pr/SKILL.md',
    'Apply the selected skill(s) to the request that follows.',
    '</selected_skills>',
].join('\n');

function skillsBlockFor(names: string[]): string {
    return [
        '<selected_skills>',
        `The user explicitly selected these skills: ${names.join(', ')}.`,
        '</selected_skills>',
    ].join('\n');
}

function chipLabels(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('[data-testid="injected-block-chip"]'))
        .map(chip => chip.textContent);
}

describe('ConversationTurnBubble — injected block chips', () => {
    it('strips leading injected blocks from the user bubble while preserving the message', () => {
        const content = `${CHAT_STYLE_BLOCK}\n\n${CHAT_MODE_BLOCK}\n\nKeep **my words** intact.`;
        const { getByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        const message = getByTestId('user-plain-text');
        expect(message.textContent).toBe('Keep my words intact.');
        expect(message.textContent).not.toContain('<chat-style>');
        expect(message.textContent).not.toContain('<coc-chat-mode>');
    });

    it('renders nothing at all when the turn carries no injected block', () => {
        const { queryByTestId } = render(<ConversationTurnBubble turn={makeTurn()} />);

        expect(queryByTestId('injected-block-chips')).toBeNull();
        expect(queryByTestId('injected-block-panel')).toBeNull();
    });

    it('renders one labelled chip per present block, and none for absent ones', () => {
        const content = `${CHAT_MODE_BLOCK}\n\n${CHAT_STYLE_BLOCK}\n\n${SELECTED_SKILLS_BLOCK}\n\nExplain the change.`;
        const { container, queryByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        expect(chipLabels(container)).toEqual(['Ask', 'Structured', 'impl', 'submit-commits-as-pr']);
        expect(queryByTestId('injected-block-panel')).toBeNull();
    });

    it('renders only the chips whose blocks the turn actually carried', () => {
        const content = `${CHAT_STYLE_BLOCK}\n\nExplain the change.`;
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        expect(chipLabels(container)).toEqual(['Structured']);
    });

    it('colour-codes each chip kind so the three block types are distinguishable', () => {
        const content = `${CHAT_MODE_BLOCK}\n\n${CHAT_STYLE_BLOCK}\n\n${SELECTED_SKILLS_BLOCK}\n\nExplain.`;
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        const kinds = Array.from(container.querySelectorAll('[data-testid="injected-block-chip"]'))
            .map(chip => chip.getAttribute('data-chip-kind'));
        expect(kinds).toEqual(['mode', 'style', 'skill', 'skill']);

        const classes = Array.from(container.querySelectorAll('[data-testid="injected-block-chip"]'))
            .map(chip => chip.className);
        expect(new Set(classes).size).toBe(3);
    });

    it('reveals the verbatim block when a chip is clicked, and closes on a second click', () => {
        const content = `${CHAT_STYLE_BLOCK}\n\nExplain the change.`;
        const { container, getByTestId, queryByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ content })} />,
        );
        const chip = container.querySelector('[data-chip-id="chat-style"]') as HTMLButtonElement;

        expect(chip.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(chip);
        expect(chip.getAttribute('aria-expanded')).toBe('true');
        expect(getByTestId('injected-block-body').textContent).toBe(CHAT_STYLE_BLOCK);

        fireEvent.click(chip);
        expect(chip.getAttribute('aria-expanded')).toBe('false');
        expect(queryByTestId('injected-block-panel')).toBeNull();
    });

    it('switches the single panel when a different chip is clicked', () => {
        const content = `${CHAT_MODE_BLOCK}\n\n${CHAT_STYLE_BLOCK}\n\nExplain the change.`;
        const { container, getAllByTestId, getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ content })} />,
        );
        const mode = container.querySelector('[data-chip-id="chat-mode"]') as HTMLButtonElement;
        const style = container.querySelector('[data-chip-id="chat-style"]') as HTMLButtonElement;

        fireEvent.click(mode);
        expect(getByTestId('injected-block-body').textContent).toBe(CHAT_MODE_BLOCK);

        fireEvent.click(style);
        expect(getAllByTestId('injected-block-panel')).toHaveLength(1);
        expect(getByTestId('injected-block-body').textContent).toBe(CHAT_STYLE_BLOCK);
        expect(mode.getAttribute('aria-expanded')).toBe('false');
        expect(style.getAttribute('aria-expanded')).toBe('true');
    });

    it('offers a copy button as the panel\'s only affordance', () => {
        const content = `${CHAT_STYLE_BLOCK}\n\nExplain.`;
        const { container, getByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        fireEvent.click(container.querySelector('[data-chip-id="chat-style"]') as HTMLButtonElement);
        const panel = getByTestId('injected-block-panel');
        expect(panel.querySelectorAll('button')).toHaveLength(1);
        expect(getByTestId('injected-block-copy')).toBeTruthy();
    });

    it('shows any skill chip the verbatim skills block', () => {
        const content = `${SELECTED_SKILLS_BLOCK}\n\nOpen a PR.`;
        const { container, getByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        fireEvent.click(container.querySelector('[data-chip-id="skill:impl"]') as HTMLButtonElement);
        expect(getByTestId('injected-block-body').textContent).toBe(SELECTED_SKILLS_BLOCK);
    });

    it('folds skills past the fourth behind a +N chip that expands the row', () => {
        const names = ['one', 'two', 'three', 'four', 'five', 'six'];
        const content = `${skillsBlockFor(names)}\n\nGo.`;
        const { container, getByTestId, queryByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ content })} />,
        );

        expect(chipLabels(container)).toEqual(['one', 'two', 'three', 'four']);
        expect(getByTestId('injected-block-chips-more').textContent).toBe('+2');

        fireEvent.click(getByTestId('injected-block-chips-more'));
        expect(chipLabels(container)).toEqual(names);
        expect(queryByTestId('injected-block-chips-more')).toBeNull();
    });

    it('shows no +N chip at exactly four skills', () => {
        const content = `${skillsBlockFor(['one', 'two', 'three', 'four'])}\n\nGo.`;
        const { queryByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        expect(queryByTestId('injected-block-chips-more')).toBeNull();
    });

    it('renders the chip row above the repo group context disclosure', () => {
        const content = `${CHAT_STYLE_BLOCK}\n\n${CHAT_MODE_BLOCK}\n\nExplain the change.`;
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ content, repoGroupContext: REPO_GROUP_CONTEXT })} />,
        );

        const chips = getByTestId('injected-block-chips');
        const repoGroup = getByTestId('repo-group-context-disclosure');
        expect(chips.compareDocumentPosition(repoGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders chips when the user content contains only injected blocks', () => {
        const content = `${CHAT_MODE_BLOCK}\n\n${CHAT_STYLE_BLOCK}`;
        const { container, queryByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        expect(queryByTestId('user-plain-text')).toBeNull();
        expect(chipLabels(container)).toEqual(['Ask', 'Structured']);
    });

    it('does not strip supported tags from assistant turns', () => {
        const content = `${CHAT_MODE_BLOCK}\n\nAssistant response.`;
        const { getByTestId, queryByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'assistant', content })} />,
        );

        expect(getByTestId('markdown-view').textContent).toContain('<coc-chat-mode>');
        expect(getByTestId('markdown-view').textContent).toContain('Assistant response.');
        expect(queryByTestId('injected-block-chips')).toBeNull();
    });

    it('hides the chips and keeps the complete original user content in raw view', () => {
        const content = `${CHAT_MODE_BLOCK}\n\nExplain the change.`;
        const { container, queryByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        fireEvent.click(container.querySelector('.bubble-raw-btn') as HTMLButtonElement);
        expect(container.querySelector('.raw-content-view')?.textContent).toBe(content);
        expect(queryByTestId('injected-block-chips')).toBeNull();
    });
});

// ============================================================================
// Chat mode chip sourced from the recorded directive
// ============================================================================

const RECORDED_ASK_DIRECTIVE = [
    '<coc-chat-mode>',
    '<coc-read-only-mode>',
    'You are in read-only mode.',
    '',
    'If the user asks you to save a plan:',
    '- Save location: `/data/repos/ws-a/notes/Plans/<chosen-folder>/<descriptive-name>.plan.md`',
    '- Existing folder options: right-panel',
    '- Pick the most relevant folder or create a new one (kebab-case, ≤3 words); do not save to the root directory directly.',
    '</coc-read-only-mode>',
    '',
    'PRIVATE-REPO-INSTRUCTIONS',
    '</coc-chat-mode>',
].join('\n');

const PROJECTED_ASK_DIRECTIVE = RECORDED_ASK_DIRECTIVE
    .replace('</coc-read-only-mode>\n\nPRIVATE-REPO-INSTRUCTIONS\n', '</coc-read-only-mode>\n');

describe('ConversationTurnBubble — chat mode chip source', () => {
    it('shows the recorded directive, including the plan destination, over the stored prefix', () => {
        const content = `${CHAT_MODE_BLOCK}\n\nExplain the change.`;
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ content, chatModeContext: RECORDED_ASK_DIRECTIVE })} />,
        );

        fireEvent.click(getByTestId('injected-block-chip'));
        const body = getByTestId('injected-block-body');
        expect(body.textContent).toContain('.plan.md');
        expect(body.textContent).toContain('Existing folder options: right-panel');
        expect(body.textContent).toBe(PROJECTED_ASK_DIRECTIVE);
    });

    it('never reveals the repo mode instructions the directive carried', () => {
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ chatModeContext: RECORDED_ASK_DIRECTIVE })} />,
        );

        fireEvent.click(getByTestId('injected-block-chip'));
        expect(getByTestId('injected-block-body').textContent).not.toContain('PRIVATE-REPO-INSTRUCTIONS');
    });

    it('renders a single chip when both sources are present', () => {
        const content = `${CHAT_MODE_BLOCK}\n\nExplain the change.`;
        const { getAllByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ content, chatModeContext: RECORDED_ASK_DIRECTIVE })} />,
        );

        expect(getAllByTestId('injected-block-chip')).toHaveLength(1);
    });

    it('shows a drift-only re-injection the stored content never recorded', () => {
        // Folder drift re-sends the directive on a turn whose stored prefix has
        // no mode block, because the route could not predict it.
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({
                content: 'Explain the change.',
                chatModeContext: RECORDED_ASK_DIRECTIVE,
            })} />,
        );

        fireEvent.click(getByTestId('injected-block-chip'));
        expect(getByTestId('injected-block-body').textContent).toContain('Existing folder options: right-panel');
    });

    it('falls back to the stored prefix for a turn with no recorded directive yet', () => {
        const content = `${CHAT_MODE_BLOCK}\n\nExplain the change.`;
        const { getByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        fireEvent.click(getByTestId('injected-block-chip'));
        expect(getByTestId('injected-block-body').textContent).toBe(CHAT_MODE_BLOCK);
    });

    it('falls back to the stored prefix for an autopilot transition marker', () => {
        const transition = '<coc-chat-mode>\nThis chat has been switched to autopilot mode.\n</coc-chat-mode>';
        const content = `${transition}\n\nNow fix it.`;
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({
                content,
                chatModeContext: `${transition.slice(0, -'\n</coc-chat-mode>'.length)}\n\nPRIVATE-REPO-INSTRUCTIONS\n</coc-chat-mode>`,
            })} />,
        );

        fireEvent.click(getByTestId('injected-block-chip'));
        const body = getByTestId('injected-block-body');
        expect(body.textContent).toBe(transition);
        expect(body.textContent).not.toContain('PRIVATE-REPO-INSTRUCTIONS');
    });

    it('shows no chip on a turn that carried neither', () => {
        const { queryByTestId } = render(<ConversationTurnBubble turn={makeTurn()} />);

        expect(queryByTestId('injected-block-chips')).toBeNull();
    });

    it('leaves the user message text untouched by the recorded directive', () => {
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({
                content: 'Explain the change.',
                chatModeContext: RECORDED_ASK_DIRECTIVE,
            })} />,
        );

        expect(getByTestId('user-plain-text').textContent).toBe('Explain the change.');
    });
});
