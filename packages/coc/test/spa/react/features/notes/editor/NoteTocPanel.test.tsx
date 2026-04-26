import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteTocPanel } from '../../../../../../src/server/spa/client/react/features/notes/editor/NoteTocPanel';
import type { TocEntry } from '../../../../../../src/server/spa/client/react/features/notes/editor/noteTocUtils';

// ── Test data ────────────────────────────────────────────────────────────────

const ENTRIES: TocEntry[] = [
    { index: 0, level: 1, text: 'Introduction', pos: 1 },
    { index: 1, level: 2, text: 'Background', pos: 20 },
    { index: 2, level: 3, text: 'Details', pos: 40 },
    { index: 3, level: 2, text: 'Conclusion', pos: 60 },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NoteTocPanel', () => {
    it('renders the panel with heading "Table of Contents"', () => {
        render(<NoteTocPanel entries={ENTRIES} activeIndex={null} onJump={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText('Table of Contents')).toBeDefined();
    });

    it('renders all entries', () => {
        render(<NoteTocPanel entries={ENTRIES} activeIndex={null} onJump={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText('Introduction')).toBeDefined();
        expect(screen.getByText('Background')).toBeDefined();
        expect(screen.getByText('Details')).toBeDefined();
        expect(screen.getByText('Conclusion')).toBeDefined();
    });

    it('shows count badge with number of entries', () => {
        render(<NoteTocPanel entries={ENTRIES} activeIndex={null} onJump={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText('4')).toBeDefined();
    });

    it('renders empty state when entries is empty', () => {
        render(<NoteTocPanel entries={[]} activeIndex={null} onJump={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByTestId('toc-empty')).toBeDefined();
        expect(screen.getByText('No headings in this note')).toBeDefined();
    });

    it('does not render entry list when entries is empty', () => {
        render(<NoteTocPanel entries={[]} activeIndex={null} onJump={vi.fn()} onClose={vi.fn()} />);
        expect(screen.queryByTestId('toc-entry-0')).toBeNull();
    });

    it('calls onJump with the correct entry when clicking an item', () => {
        const onJump = vi.fn();
        render(<NoteTocPanel entries={ENTRIES} activeIndex={null} onJump={onJump} onClose={vi.fn()} />);
        fireEvent.click(screen.getByTestId('toc-entry-1'));
        expect(onJump).toHaveBeenCalledWith(ENTRIES[1]);
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        render(<NoteTocPanel entries={ENTRIES} activeIndex={null} onJump={vi.fn()} onClose={onClose} />);
        fireEvent.click(screen.getByTestId('toc-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when Escape key is pressed', () => {
        const onClose = vi.fn();
        render(<NoteTocPanel entries={ENTRIES} activeIndex={null} onJump={vi.fn()} onClose={onClose} />);
        fireEvent.keyDown(screen.getByTestId('toc-panel'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('highlights active entry with blue styles', () => {
        render(<NoteTocPanel entries={ENTRIES} activeIndex={1} onJump={vi.fn()} onClose={vi.fn()} />);
        const activeBtn = screen.getByTestId('toc-entry-1');
        expect(activeBtn.className).toContain('text-[#0078d4]');
        expect(activeBtn.className).toContain('border-l-2');
    });

    it('does not highlight non-active entries', () => {
        render(<NoteTocPanel entries={ENTRIES} activeIndex={1} onJump={vi.fn()} onClose={vi.fn()} />);
        const inactiveBtn = screen.getByTestId('toc-entry-0');
        expect(inactiveBtn.className).not.toContain('text-[#0078d4]');
    });

    it('applies pl-4 indentation for H2 entries', () => {
        render(<NoteTocPanel entries={ENTRIES} activeIndex={null} onJump={vi.fn()} onClose={vi.fn()} />);
        // H2 entry (index 1 = 'Background')
        const h2Btn = screen.getByTestId('toc-entry-1');
        expect(h2Btn.className).toContain('pl-4');
    });

    it('applies pl-8 indentation for H3 entries', () => {
        render(<NoteTocPanel entries={ENTRIES} activeIndex={null} onJump={vi.fn()} onClose={vi.fn()} />);
        // H3 entry (index 2 = 'Details')
        const h3Btn = screen.getByTestId('toc-entry-2');
        expect(h3Btn.className).toContain('pl-8');
    });

    it('applies no extra indentation for H1 entries', () => {
        render(<NoteTocPanel entries={ENTRIES} activeIndex={null} onJump={vi.fn()} onClose={vi.fn()} />);
        // H1 entry (index 0 = 'Introduction')
        const h1Btn = screen.getByTestId('toc-entry-0');
        expect(h1Btn.className).not.toContain('pl-4');
        expect(h1Btn.className).not.toContain('pl-8');
    });

    it('renders with data-testid="toc-panel"', () => {
        render(<NoteTocPanel entries={ENTRIES} activeIndex={null} onJump={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByTestId('toc-panel')).toBeDefined();
    });
});
