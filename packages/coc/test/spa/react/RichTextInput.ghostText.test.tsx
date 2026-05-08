/* @vitest-environment jsdom */
/**
 * Tests for the ghostText overlay rendered by RichTextInput.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { RichTextInput } from '../../../src/server/spa/client/react/shared/RichTextInput';

describe('RichTextInput ghostText', () => {
    it('renders the ghost suffix when ghostText is non-empty', () => {
        render(
            <RichTextInput
                value="fix the "
                ghostText="bug now"
                onChange={() => {}}
                data-testid="rich"
            />,
        );
        const suffix = screen.getByTestId('rich-ghost-suffix');
        expect(suffix.textContent).toBe('bug now');
    });

    it('does not render ghost overlay when ghostText is empty', () => {
        render(
            <RichTextInput
                value="fix the "
                ghostText=""
                onChange={() => {}}
                data-testid="rich"
            />,
        );
        expect(screen.queryByTestId('rich-ghost')).toBeNull();
    });

    it('does not render ghost overlay when ghostText is undefined', () => {
        render(
            <RichTextInput value="fix the " onChange={() => {}} data-testid="rich" />,
        );
        expect(screen.queryByTestId('rich-ghost')).toBeNull();
    });

    it('ghost overlay is non-interactive (pointer-events: none)', () => {
        render(
            <RichTextInput
                value="hi"
                ghostText="!"
                onChange={() => {}}
                data-testid="rich"
            />,
        );
        const overlay = screen.getByTestId('rich-ghost');
        expect(overlay.className).toContain('pointer-events-none');
        expect(overlay.getAttribute('aria-hidden')).toBe('true');
    });

    it('ghost overlay is hidden when component is disabled', () => {
        render(
            <RichTextInput
                disabled
                value="hi"
                ghostText="!"
                onChange={() => {}}
                data-testid="rich"
            />,
        );
        expect(screen.queryByTestId('rich-ghost')).toBeNull();
    });
});
