/**
 * PromptCard — unit tests for the read-only prompt card component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PromptCard } from '../../../../src/server/spa/client/react/admin/PromptCard';

describe('PromptCard', () => {
    const defaultProps = {
        title: 'Read-only Mode',
        source: 'forge/copilot-sdk-wrapper/types.ts',
        description: 'System message injected in ask/plan modes blocking file edits',
        text: 'You are in read-only mode.',
    };

    it('renders the card with all fields', () => {
        render(<PromptCard {...defaultProps} />);

        expect(screen.getByText('Read-only Mode')).toBeDefined();
        expect(screen.getByText('forge/copilot-sdk-wrapper/types.ts')).toBeDefined();
        expect(screen.getByText('System message injected in ask/plan modes blocking file edits')).toBeDefined();
        expect(screen.getByTestId('prompt-text').textContent).toContain('You are in read-only mode.');
    });

    it('renders the prompt text in a pre element', () => {
        render(<PromptCard {...defaultProps} />);

        const pre = screen.getByTestId('prompt-text');
        expect(pre.tagName).toBe('PRE');
    });

    it('applies monospace font class to source badge', () => {
        render(<PromptCard {...defaultProps} />);

        const badge = screen.getByText('forge/copilot-sdk-wrapper/types.ts');
        // The redesigned PromptCard uses the `ar-mono` class (which maps to JetBrains Mono
        // in `admin-redesign.css`) instead of Tailwind's `font-mono`.
        expect(badge.className).toMatch(/\bar-mono\b/);
    });

    it('sets data-testid on the card container', () => {
        render(<PromptCard {...defaultProps} />);

        expect(screen.getByTestId('prompt-card')).toBeDefined();
    });
});
