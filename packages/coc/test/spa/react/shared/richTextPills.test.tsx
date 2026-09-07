/**
 * @vitest-environment jsdom
 *
 * Path-pill styling for the composer (AC-04, second half).
 *
 * The pill is painted by a transparent-text overlay above the contentEditable,
 * never by injecting DOM into it — so these tests check both the pure splitter
 * and that `RichTextInput` still hands back plain `innerText`.
 */
import { render, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import {
    hasFilePathPill,
    isFilePathCodeSpan,
    splitFilePathPills,
} from '../../../../src/server/spa/client/react/shared/richTextPills';
import {
    RichTextInput,
    type RichTextInputHandle,
} from '../../../../src/server/spa/client/react/shared/RichTextInput';

describe('splitFilePathPills', () => {
    it('returns nothing for empty text', () => {
        expect(splitFilePathPills('')).toEqual([]);
    });

    it('marks a backticked path as a pill and keeps the backticks', () => {
        expect(splitFilePathPills('see `src/foo.ts` please')).toEqual([
            { text: 'see ', pill: false },
            { text: '`src/foo.ts`', pill: true },
            { text: ' please', pill: false },
        ]);
    });

    it('marks a bare filename with an extension', () => {
        expect(splitFilePathPills('`README.md`')).toEqual([
            { text: '`README.md`', pill: true },
        ]);
    });

    it('leaves ordinary inline code alone', () => {
        expect(splitFilePathPills('run `npm test` now')).toEqual([
            { text: 'run `npm test` now', pill: false },
        ]);
        expect(splitFilePathPills('`index`')).toEqual([
            { text: '`index`', pill: false },
        ]);
    });

    it('handles two pills and merges the plain runs between them', () => {
        expect(splitFilePathPills('`a/b.ts` and `c/d.ts`')).toEqual([
            { text: '`a/b.ts`', pill: true },
            { text: ' and ', pill: false },
            { text: '`c/d.ts`', pill: true },
        ]);
    });

    it('concatenates back to the original text', () => {
        const text = 'x `npm test` `src/a.ts` y `b.md`';
        expect(splitFilePathPills(text).map((s) => s.text).join('')).toBe(text);
    });

    it('never spans a newline or an unclosed backtick', () => {
        expect(splitFilePathPills('`src/a.ts\nb`')).toEqual([
            { text: '`src/a.ts\nb`', pill: false },
        ]);
        expect(splitFilePathPills('`src/a.ts')).toEqual([
            { text: '`src/a.ts', pill: false },
        ]);
    });

    it('classifies code spans the same way the mention trigger does', () => {
        expect(isFilePathCodeSpan('src/foo')).toBe(true);
        expect(isFilePathCodeSpan('foo.ts')).toBe(true);
        expect(isFilePathCodeSpan('foo bar/baz.ts')).toBe(false);
        expect(isFilePathCodeSpan('index')).toBe(false);
        expect(isFilePathCodeSpan('')).toBe(false);
        expect(hasFilePathPill('nothing here')).toBe(false);
        expect(hasFilePathPill('a `src/x.ts` b')).toBe(true);
    });
});

describe('RichTextInput pillPaths', () => {
    it('renders a pill span for each backticked path', () => {
        render(
            <RichTextInput
                data-testid="composer"
                pillPaths
                value="see `src/foo.ts` and `docs/b.md` ok"
                onChange={() => {}}
            />,
        );
        const pills = screen.getAllByTestId('composer-pill');
        expect(pills.map((p) => p.textContent)).toEqual([
            '`src/foo.ts`',
            '`docs/b.md`',
        ]);
        // The overlay repeats the whole value so the pills stay aligned with
        // the real characters underneath.
        expect(screen.getByTestId('composer-ghost').textContent)
            .toBe('see `src/foo.ts` and `docs/b.md` ok');
    });

    it('does not mount the overlay without a pill or ghost text', () => {
        render(
            <RichTextInput
                data-testid="composer"
                pillPaths
                value="run `npm test` now"
                onChange={() => {}}
            />,
        );
        expect(screen.queryByTestId('composer-ghost')).toBeNull();
    });

    it('draws pills and ghost text together in one overlay', () => {
        render(
            <RichTextInput
                data-testid="composer"
                pillPaths
                value="check `src/foo.ts`"
                ghostText=" for details"
                onChange={() => {}}
            />,
        );
        expect(screen.getAllByTestId('composer-pill')).toHaveLength(1);
        expect(screen.getByTestId('composer-ghost-suffix').textContent)
            .toBe(' for details');
    });

    it('still renders ghost text when pillPaths is off', () => {
        render(
            <RichTextInput
                data-testid="composer"
                value="check `src/foo.ts`"
                ghostText=" more"
                onChange={() => {}}
            />,
        );
        expect(screen.queryByTestId('composer-pill')).toBeNull();
        expect(screen.getByTestId('composer-ghost-suffix').textContent).toBe(' more');
    });

    it('hides the overlay while disabled', () => {
        render(
            <RichTextInput
                data-testid="composer"
                pillPaths
                disabled
                value="see `src/foo.ts`"
                onChange={() => {}}
            />,
        );
        expect(screen.queryByTestId('composer-ghost')).toBeNull();
    });

    it('keeps the editable plain text — getValue() is unchanged by pills', () => {
        const ref = createRef<RichTextInputHandle>();
        render(
            <RichTextInput
                ref={ref}
                data-testid="composer"
                pillPaths
                value="see `src/foo.ts`"
                onChange={() => {}}
            />,
        );
        const editable = screen.getByTestId('composer');
        // The pill lives in the aria-hidden overlay, not in the editable.
        expect(editable.querySelector('[data-testid="composer-pill"]')).toBeNull();
        expect(editable.innerHTML).toBe('');
        ref.current!.setValue('see `src/foo.ts`');
        expect(ref.current!.getValue()).toBe('see `src/foo.ts`');
    });
});
