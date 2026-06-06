import { describe, expect, it } from 'vitest';
import {
    deriveRalphTitle,
    RALPH_FALLBACK_TITLE,
} from '../../../../src/server/spa/client/react/features/chat/ralph-title';

describe('deriveRalphTitle', () => {
    it('returns the fallback for missing/empty/whitespace goals', () => {
        expect(deriveRalphTitle(undefined)).toBe(RALPH_FALLBACK_TITLE);
        expect(deriveRalphTitle(null)).toBe(RALPH_FALLBACK_TITLE);
        expect(deriveRalphTitle('')).toBe(RALPH_FALLBACK_TITLE);
        expect(deriveRalphTitle('   \n\t  \n')).toBe(RALPH_FALLBACK_TITLE);
        expect(deriveRalphTitle(123 as unknown as string)).toBe(RALPH_FALLBACK_TITLE);
    });

    it('uses a plain-text goal verbatim', () => {
        expect(deriveRalphTitle('Reviewing Codex skill access...')).toBe('Reviewing Codex skill access...');
    });

    it('extracts the first sentence of a multi-sentence plain goal', () => {
        expect(deriveRalphTitle('Fix the flaky test. Then refactor the runner.')).toBe('Fix the flaky test.');
    });

    it('keeps short goals without a sentence terminator intact', () => {
        expect(deriveRalphTitle('Fix bug')).toBe('Fix bug');
    });

    it('skips the `## Goal` section label and strips the `[decision]` tag', () => {
        const goal = [
            '## Goal',
            '[decision] Improve Ralph session group titles in the chat list.',
            '',
            '## Acceptance Criteria',
            '- AC-01: ...',
        ].join('\n');
        expect(deriveRalphTitle(goal)).toBe('Improve Ralph session group titles in the chat list.');
    });

    it('strips YAML frontmatter before parsing', () => {
        const goal = [
            '---',
            'name: ralph-session-goal-titles',
            'created: 2026-06-05',
            '---',
            '## Goal',
            'Implement goal-derived Ralph titles.',
        ].join('\n');
        expect(deriveRalphTitle(goal)).toBe('Implement goal-derived Ralph titles.');
    });

    it('skips multiple structural labels and blank lines to reach content', () => {
        const goal = [
            '',
            '# Goal',
            '',
            '   ',
            'Add a concise title to grouped Ralph rows.',
        ].join('\n');
        expect(deriveRalphTitle(goal)).toBe('Add a concise title to grouped Ralph rows.');
    });

    it('treats a meaningful heading as the title when there is no separate body', () => {
        expect(deriveRalphTitle('# Reviewing Codex skill access')).toBe('Reviewing Codex skill access');
    });

    it('strips list bullets and assumption tags', () => {
        expect(deriveRalphTitle('- [assumption] Prefer small pure helper functions')).toBe('Prefer small pure helper functions');
    });

    it('collapses excess internal whitespace', () => {
        expect(deriveRalphTitle('Improve    Ralph\t\ttitles')).toBe('Improve Ralph titles');
    });

    it('truncates long titles with an ellipsis at the default max length', () => {
        const long = 'Improve Ralph session group titles in the CoC chat list so repeated generic rows instead show concise goal text';
        const result = deriveRalphTitle(long);
        expect(result.length).toBe(80);
        expect(result.endsWith('…')).toBe(true);
        expect(long.startsWith(result.slice(0, -1).trimEnd())).toBe(true);
    });

    it('honors a custom max length', () => {
        expect(deriveRalphTitle('Improve Ralph session titles everywhere', 10)).toBe('Improve R…');
    });

    it('returns the fallback when the goal contains only structural labels', () => {
        const goal = ['## Goal', '', '## Acceptance Criteria', '## Out of Scope'].join('\n');
        expect(deriveRalphTitle(goal)).toBe(RALPH_FALLBACK_TITLE);
    });
});
