/**
 * Heading anchor slugs — the shared rule behind both the same-note `#heading`
 * jump and the cross-note `[[note:path#heading]]` jump.
 *
 * Regression cover for the cross-note jump, whose old inline rule
 * (`toLowerCase().replace(/\s+/g, '-')`) kept every colon, ampersand and dash
 * in the slug, so a link to any punctuated heading silently landed at the top
 * of the note instead.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    slugifyHeading,
    scrollToHeadingByText,
} from '../../../../../../src/server/spa/client/react/features/notes/editor/noteTocUtils';

describe('slugifyHeading', () => {
    it('slugs a plain heading', () => {
        expect(slugifyHeading('Getting Started')).toBe('getting-started');
    });

    it('drops the em-dash and ampersand, leaving GitHub\'s doubled dash', () => {
        expect(slugifyHeading('Answer 1: Roofline — Matmul & MoE TopK'))
            .toBe('answer-1-roofline-matmul--moe-topk');
    });

    it('drops punctuation in place so "Fun & Games" doubles the dash', () => {
        expect(slugifyHeading('Fun & Games')).toBe('fun--games');
    });

    it('keeps letters, digits, underscores and literal hyphens', () => {
        expect(slugifyHeading("Don't Panic (v2)")).toBe('dont-panic-v2');
        expect(slugifyHeading('well-known snake_case')).toBe('well-known-snake_case');
    });

    it('trims surrounding whitespace', () => {
        expect(slugifyHeading('  Setup  ')).toBe('setup');
    });

    it('is idempotent on an already-slugged fragment', () => {
        const slug = slugifyHeading('Answer 1: Roofline — Matmul & MoE TopK');
        expect(slugifyHeading(slug)).toBe(slug);
    });
});

// ── scrollToHeadingByText ────────────────────────────────────────────────────

const scrolled: string[] = [];

function mountNote(headings: string[]): void {
    document.body.innerHTML = `<div class="ProseMirror">${headings
        .map((h) => `<h2>${h}</h2>`)
        .join('')}</div>`;
    for (const el of document.querySelectorAll('h2')) {
        (el as HTMLElement).scrollIntoView = () => {
            scrolled.push(el.textContent ?? '');
        };
    }
}

describe('scrollToHeadingByText', () => {
    beforeEach(() => {
        scrolled.length = 0;
    });
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('scrolls to a punctuated heading a raw text match would miss', () => {
        mountNote(['Intro', 'Answer 1: Roofline — Matmul & MoE TopK', 'Outro']);
        expect(scrollToHeadingByText('answer-1-roofline-matmul--moe-topk')).toBe(true);
        expect(scrolled).toEqual(['Answer 1: Roofline — Matmul & MoE TopK']);
    });

    it('matches a heading given as raw text too', () => {
        mountNote(['Intro', 'Deep Dive']);
        expect(scrollToHeadingByText('Deep Dive')).toBe(true);
        expect(scrolled).toEqual(['Deep Dive']);
    });

    it('falls back to the top of the note when nothing matches', () => {
        mountNote(['Intro', 'Deep Dive']);
        expect(scrollToHeadingByText('nope')).toBe(false);
        expect(scrolled).toEqual(['Intro']);
    });

    it('does nothing when the note has no headings', () => {
        document.body.innerHTML = '<div class="ProseMirror"><p>text</p></div>';
        expect(scrollToHeadingByText('anything')).toBe(false);
        expect(scrolled).toEqual([]);
    });
});
