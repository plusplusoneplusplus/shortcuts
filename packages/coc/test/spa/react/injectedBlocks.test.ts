import { describe, expect, it } from 'vitest';
import { extractInjectedBlocks, parseSelectedSkillNames, projectChatModeContextForDisplay } from '../../../src/server/spa/client/react/features/chat/conversation/injectedBlocks';

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

const SELECTED_SKILLS_BLOCK = [
    '<selected_skills>',
    'The user explicitly selected these skills: submit-commits-as-pr.',
    'Load the selected skill instructions from these SKILL.md files before proceeding:',
    '- submit-commits-as-pr: /home/me/.claude/skills/submit-commits-as-pr/SKILL.md',
    'Apply the selected skill(s) to the request that follows.',
    '</selected_skills>',
].join('\n');

describe('extractInjectedBlocks', () => {
    it('extracts both supported blocks and trims blank lines before the message', () => {
        const message = 'Keep **my words** intact.';

        expect(extractInjectedBlocks(`${CHAT_STYLE_BLOCK}\n\n${CHAT_MODE_BLOCK}\n\n\n${message}`)).toEqual({
            text: message,
            chatStyle: CHAT_STYLE_BLOCK,
            chatMode: CHAT_MODE_BLOCK,
        });
    });

    it('extracts only a leading chat style block', () => {
        expect(extractInjectedBlocks(`${CHAT_STYLE_BLOCK}\n\nExplain the change.`)).toEqual({
            text: 'Explain the change.',
            chatStyle: CHAT_STYLE_BLOCK,
        });
    });

    it('extracts only a leading chat mode block', () => {
        expect(extractInjectedBlocks(`${CHAT_MODE_BLOCK}\r\n\r\nExplain the change.`)).toEqual({
            text: 'Explain the change.',
            chatMode: CHAT_MODE_BLOCK,
        });
    });

    it('returns text without supported blocks byte-for-byte', () => {
        const text = '\n  Ordinary text with trailing whitespace.  \n';

        expect(extractInjectedBlocks(text)).toEqual({ text });
    });

    it('extracts the blocks in reversed order', () => {
        expect(extractInjectedBlocks(`${CHAT_MODE_BLOCK}\n\n${CHAT_STYLE_BLOCK}\n\nProceed.`)).toEqual({
            text: 'Proceed.',
            chatStyle: CHAT_STYLE_BLOCK,
            chatMode: CHAT_MODE_BLOCK,
        });
    });

    it('does not strip a supported block that appears mid-message', () => {
        const text = `Here is a quoted block:\n\n${CHAT_STYLE_BLOCK}`;

        expect(extractInjectedBlocks(text)).toEqual({ text });
    });

    it('leaves an unterminated leading block unchanged', () => {
        const text = '<chat-style>\nSelected style: Direct.\nExplain the change.';

        expect(extractInjectedBlocks(text)).toEqual({ text });
    });

    it('returns an empty message when the text contains only supported blocks', () => {
        expect(extractInjectedBlocks(`${CHAT_STYLE_BLOCK}\n\n${CHAT_MODE_BLOCK}`)).toEqual({
            text: '',
            chatStyle: CHAT_STYLE_BLOCK,
            chatMode: CHAT_MODE_BLOCK,
        });
    });

    it('extracts all three blocks in the production order and keeps the message intact', () => {
        const message = 'Ship it.';

        expect(extractInjectedBlocks(
            `${CHAT_STYLE_BLOCK}\n\n${SELECTED_SKILLS_BLOCK}\n\n${CHAT_MODE_BLOCK}\n\n${message}`,
        )).toEqual({
            text: message,
            chatStyle: CHAT_STYLE_BLOCK,
            chatMode: CHAT_MODE_BLOCK,
            selectedSkills: SELECTED_SKILLS_BLOCK,
            selectedSkillNames: ['submit-commits-as-pr'],
        });
    });

    // Regression: the skills block used to stop the loop, leaking the chat-mode
    // block into the rendered message as raw text.
    it('still strips the chat mode block that follows the skills block', () => {
        const extracted = extractInjectedBlocks(
            `${CHAT_STYLE_BLOCK}\n\n${SELECTED_SKILLS_BLOCK}\n\n${CHAT_MODE_BLOCK}\n\nProceed.`,
        );

        expect(extracted.text).toBe('Proceed.');
        expect(extracted.text).not.toContain('coc-chat-mode');
    });

    it('extracts only a leading selected skills block', () => {
        expect(extractInjectedBlocks(`${SELECTED_SKILLS_BLOCK}\n\nOpen a PR.`)).toEqual({
            text: 'Open a PR.',
            selectedSkills: SELECTED_SKILLS_BLOCK,
            selectedSkillNames: ['submit-commits-as-pr'],
        });
    });

    it('does not strip a selected skills block that appears mid-message', () => {
        const text = `Here is a quoted block:\n\n${SELECTED_SKILLS_BLOCK}`;

        expect(extractInjectedBlocks(text)).toEqual({ text });
    });

    it('omits the parsed names when the skills block sentence is missing', () => {
        const block = '<selected_skills>\n- example\n</selected_skills>';

        expect(extractInjectedBlocks(`${block}\n\nProceed.`)).toEqual({
            text: 'Proceed.',
            selectedSkills: block,
        });
    });
});

describe('parseSelectedSkillNames', () => {
    it('parses a single name', () => {
        expect(parseSelectedSkillNames(SELECTED_SKILLS_BLOCK)).toEqual(['submit-commits-as-pr']);
    });

    it('parses three hyphenated names and ignores the reference lines', () => {
        const block = [
            '<selected_skills>',
            'The user explicitly selected these skills: impl, code-review, submit-commits-as-pr.',
            'Load the selected skill instructions from these SKILL.md files before proceeding:',
            '- impl: /skills/impl/SKILL.md',
            '- code-review: /skills/code-review/SKILL.md',
            '- submit-commits-as-pr: /skills/submit-commits-as-pr/SKILL.md',
            'Apply the selected skill(s) to the request that follows.',
            '</selected_skills>',
        ].join('\n');

        expect(parseSelectedSkillNames(block)).toEqual(['impl', 'code-review', 'submit-commits-as-pr']);
    });

    it('dedupes names and drops empty entries', () => {
        const block = 'The user explicitly selected these skills: impl, , impl, run.';

        expect(parseSelectedSkillNames(block)).toEqual(['impl', 'run']);
    });

    it('tolerates a missing trailing period', () => {
        expect(parseSelectedSkillNames('The user explicitly selected these skills: impl')).toEqual(['impl']);
    });

    it('returns an empty list when the sentence is absent', () => {
        expect(parseSelectedSkillNames('<selected_skills>\n- impl\n</selected_skills>')).toEqual([]);
    });

    it('returns an empty list when the sentence is reworded', () => {
        expect(parseSelectedSkillNames('The user picked these skills: impl.')).toEqual([]);
    });
});

describe('projectChatModeContextForDisplay', () => {
    const READ_ONLY_WITH_PLAN = [
        '<coc-chat-mode>',
        '<coc-read-only-mode>',
        'You are in read-only mode.',
        '',
        'If the user asks you to save a plan:',
        '- Save location: `/data/repos/ws-a/notes/Plans/<chosen-folder>/<descriptive-name>.plan.md`',
        '- Existing folder options: right-panel',
        '- Pick the most relevant folder or create a new one (kebab-case, ≤3 words); do not save to the root directory directly.',
        '</coc-read-only-mode>',
        '</coc-chat-mode>',
    ].join('\n');

    it('keeps the read-only section and its nested plan destination', () => {
        const projected = projectChatModeContextForDisplay(READ_ONLY_WITH_PLAN);

        expect(projected).toContain('<coc-read-only-mode>');
        expect(projected).toContain('- Existing folder options: right-panel');
        expect(projected).toContain('.plan.md');
        expect(projected!.startsWith('<coc-chat-mode>')).toBe(true);
        expect(projected!.endsWith('</coc-chat-mode>')).toBe(true);
    });

    it('drops the repo mode instructions that trail the read-only section', () => {
        const marker = READ_ONLY_WITH_PLAN.replace(
            '</coc-read-only-mode>\n</coc-chat-mode>',
            '</coc-read-only-mode>\n\nPRIVATE-REPO-INSTRUCTIONS\n</coc-chat-mode>',
        );

        const projected = projectChatModeContextForDisplay(marker)!;

        expect(projected).toContain('<coc-read-only-mode>');
        expect(projected).not.toContain('PRIVATE-REPO-INSTRUCTIONS');
    });

    it('returns undefined for a missing marker so the caller falls back to stored content', () => {
        expect(projectChatModeContextForDisplay(undefined)).toBeUndefined();
        expect(projectChatModeContextForDisplay('')).toBeUndefined();
    });

    it('returns undefined for an autopilot transition marker', () => {
        const marker = '<coc-chat-mode>\nThis chat has been switched to autopilot mode.\n</coc-chat-mode>';

        expect(projectChatModeContextForDisplay(marker)).toBeUndefined();
    });

    it('returns undefined for a read-only section that never closes', () => {
        const marker = '<coc-chat-mode>\n<coc-read-only-mode>\ntruncated\n</coc-chat-mode>';

        expect(projectChatModeContextForDisplay(marker)).toBeUndefined();
    });
});
