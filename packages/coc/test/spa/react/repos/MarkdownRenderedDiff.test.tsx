// @vitest-environment jsdom
/**
 * Tests for MarkdownRenderedDiff — the read-only Rendered mode body.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MarkdownRenderedDiff } from '../../../../src/server/spa/client/react/features/git/diff/MarkdownRenderedDiff';

const blocks = (type: string) => Array.from(screen.getByTestId('markdown-rendered-diff').querySelectorAll(`[data-md-diff="${type}"]`));

describe('MarkdownRenderedDiff', () => {
    it('renders markdown with added and removed blocks marked', () => {
        const base = '# Title\n\nold text\n\n| a | b |\n|---|---|\n| 1 | 2 |';
        const head = '# Title\n\nnew text\n\n| a | b |\n|---|---|\n| 1 | 2 |';
        render(<MarkdownRenderedDiff base={base} head={head} />);
        const root = screen.getByTestId('markdown-rendered-diff');
        expect(root.querySelector('.markdown-body')).toBeTruthy();
        expect(root.querySelector('.md-h1')?.textContent).toContain('Title');
        expect(root.querySelector('table')).toBeTruthy();

        const [removed] = blocks('removed');
        const [added] = blocks('added');
        expect(removed.textContent).toContain('old text');
        expect(removed.className).toContain('line-through');
        expect(removed.className).toContain('border-red-500');
        expect(added.textContent).toContain('new text');
        expect(added.className).toContain('border-green-500');
        expect(blocks('unchanged')).toHaveLength(2);
    });

    it('renders an added file all green', () => {
        render(<MarkdownRenderedDiff base="" head={'# New\n\nbody'} />);
        expect(blocks('added')).toHaveLength(2);
        expect(blocks('removed')).toHaveLength(0);
    });

    it('renders a deleted file all red from base', () => {
        render(<MarkdownRenderedDiff base={'# Gone\n\nbody'} head="" />);
        expect(blocks('removed').map(b => b.textContent)).toEqual([expect.stringContaining('Gone'), 'body']);
        expect(blocks('added')).toHaveLength(0);
    });

    it('escapes raw HTML in markdown', () => {
        render(<MarkdownRenderedDiff base="" head="<img src=x onerror=alert(1)>" />);
        expect(screen.getByTestId('markdown-rendered-diff').querySelector('img')).toBeNull();
    });
});
