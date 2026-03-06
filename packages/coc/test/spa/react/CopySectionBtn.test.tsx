/**
 * Tests for CopySectionBtn — per-section copy button in assistant bubbles.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { CopySectionBtn } from '../../../src/server/spa/client/react/processes/CopySectionBtn';

// Mock copyToClipboard
vi.mock('../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

import { copyToClipboard } from '../../../src/server/spa/client/react/utils/format';

describe('CopySectionBtn', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the copy icon by default', () => {
        render(<CopySectionBtn sectionMarkdown="## Hello\nWorld" />);
        const btn = screen.getByTestId('section-copy-btn');
        expect(btn.textContent).toBe('📋');
    });

    it('calls copyToClipboard with the section markdown on click', async () => {
        const md = '## My Section\n\nSome content here.';
        render(<CopySectionBtn sectionMarkdown={md} />);
        const btn = screen.getByTestId('section-copy-btn');

        await act(async () => {
            fireEvent.click(btn);
        });

        expect(copyToClipboard).toHaveBeenCalledWith(md);
    });

    it('shows checkmark after successful copy', async () => {
        render(<CopySectionBtn sectionMarkdown="## Test\nBody" />);
        const btn = screen.getByTestId('section-copy-btn');

        await act(async () => {
            fireEvent.click(btn);
        });

        expect(btn.textContent).toBe('✓');
    });

    it('reverts to copy icon after timeout', async () => {
        vi.useFakeTimers();
        render(<CopySectionBtn sectionMarkdown="## Test\nBody" />);
        const btn = screen.getByTestId('section-copy-btn');

        await act(async () => {
            fireEvent.click(btn);
        });

        expect(btn.textContent).toBe('✓');

        act(() => {
            vi.advanceTimersByTime(1500);
        });

        expect(btn.textContent).toBe('📋');
        vi.useRealTimers();
    });

    it('has the correct CSS class', () => {
        render(<CopySectionBtn sectionMarkdown="## X" />);
        const btn = screen.getByTestId('section-copy-btn');
        expect(btn.classList.contains('section-copy-btn')).toBe(true);
    });

    it('has title for accessibility', () => {
        render(<CopySectionBtn sectionMarkdown="## X" />);
        const btn = screen.getByTestId('section-copy-btn');
        expect(btn.getAttribute('title')).toBe('Copy to clipboard');
    });

    it('stops event propagation on click', async () => {
        const parentHandler = vi.fn();
        render(
            <div onClick={parentHandler}>
                <CopySectionBtn sectionMarkdown="## X" />
            </div>
        );
        const btn = screen.getByTestId('section-copy-btn');

        await act(async () => {
            fireEvent.click(btn);
        });

        expect(parentHandler).not.toHaveBeenCalled();
    });
});
