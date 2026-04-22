// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PastePreview } from '../../../src/server/spa/client/react/ui/PastePreview';

describe('PastePreview', () => {
    it('renders nothing when charCount is 0', () => {
        const { container } = render(
            <PastePreview charCount={0} previewLines={[]} onDismiss={vi.fn()} />,
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders paste info with char count', () => {
        render(
            <PastePreview charCount={24581} previewLines={['line 1']} onDismiss={vi.fn()} />,
        );
        expect(screen.getByTestId('paste-preview')).toBeTruthy();
        expect(screen.getByText(/24\.6K chars/)).toBeTruthy();
    });

    it('formats large char counts', () => {
        render(
            <PastePreview charCount={1_500_000} previewLines={['line 1']} onDismiss={vi.fn()} />,
        );
        expect(screen.getByText(/1\.5M chars/)).toBeTruthy();
    });

    it('formats small char counts without abbreviation', () => {
        render(
            <PastePreview charCount={500} previewLines={['line 1']} onDismiss={vi.fn()} />,
        );
        expect(screen.getByText(/500 chars/)).toBeTruthy();
    });

    it('calls onDismiss when dismiss button is clicked', () => {
        const onDismiss = vi.fn();
        render(
            <PastePreview charCount={20000} previewLines={['line 1']} onDismiss={onDismiss} />,
        );
        fireEvent.click(screen.getByTestId('paste-preview-dismiss'));
        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('starts collapsed, shows preview lines on expand', () => {
        render(
            <PastePreview
                charCount={20000}
                previewLines={['first line', 'second line', 'third line']}
                onDismiss={vi.fn()}
            />,
        );
        // Content should not be visible initially
        expect(screen.queryByTestId('paste-preview-content')).toBeNull();

        // Click to expand
        fireEvent.click(screen.getByTestId('paste-preview-toggle'));

        // Now preview content should be visible
        const content = screen.getByTestId('paste-preview-content');
        expect(content).toBeTruthy();
        expect(content.textContent).toContain('first line');
        expect(content.textContent).toContain('second line');
        expect(content.textContent).toContain('third line');
    });

    it('collapses preview on second click', () => {
        render(
            <PastePreview
                charCount={20000}
                previewLines={['line 1']}
                onDismiss={vi.fn()}
            />,
        );

        // Expand
        fireEvent.click(screen.getByTestId('paste-preview-toggle'));
        expect(screen.queryByTestId('paste-preview-content')).not.toBeNull();

        // Collapse
        fireEvent.click(screen.getByTestId('paste-preview-toggle'));
        expect(screen.queryByTestId('paste-preview-content')).toBeNull();
    });

    it('renders the 📎 icon', () => {
        render(
            <PastePreview charCount={20000} previewLines={[]} onDismiss={vi.fn()} />,
        );
        expect(screen.getByText('📎')).toBeTruthy();
    });

    it('applies custom className', () => {
        render(
            <PastePreview charCount={20000} previewLines={[]} onDismiss={vi.fn()} className="my-class" />,
        );
        const el = screen.getByTestId('paste-preview');
        expect(el.classList.contains('my-class')).toBe(true);
    });
});
