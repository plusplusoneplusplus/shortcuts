/**
 * Tests for ReferencesDropdown shared component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ── Hoisted mutable mock state ─────────────────────────────────────────────

const { mockBreakpoint } = vi.hoisted(() => ({
    mockBreakpoint: { isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' as const },
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => mockBreakpoint,
}));

// BottomSheet stub — renders inline for testability (avoids portal complexity)
vi.mock('../../../../src/server/spa/client/react/ui/BottomSheet', () => ({
    BottomSheet: ({ isOpen, onClose, title, children }: any) =>
        isOpen ? (
            <div data-testid="bottomsheet-mock" data-title={title}>
                <button data-testid="bottomsheet-close" onClick={onClose}>close</button>
                {children}
            </div>
        ) : null,
}));

import { ReferencesDropdown } from '../../../../src/server/spa/client/react/ui/ReferencesDropdown';

// FilePathLink renders a span with the path — no context needed

beforeEach(() => {
    // Reset to desktop for each test
    mockBreakpoint.isMobile = false;
    mockBreakpoint.isTablet = false;
    mockBreakpoint.isDesktop = true;
    mockBreakpoint.breakpoint = 'desktop';
    cleanup();
});

describe('ReferencesDropdown — desktop', () => {
    it('renders nothing when no planPath and no files', () => {
        const { container } = render(<ReferencesDropdown />);
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing when files is empty array', () => {
        const { container } = render(<ReferencesDropdown files={[]} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders button with count of references (planPath only)', () => {
        render(<ReferencesDropdown planPath="/some/plan.md" />);
        expect(screen.getByTestId('references-dropdown-btn').textContent).toContain('References (1)');
    });

    it('renders button with count of references (files only)', () => {
        render(
            <ReferencesDropdown files={[{ filePath: '/a.ts' }, { filePath: '/b.ts' }]} />
        );
        expect(screen.getByTestId('references-dropdown-btn').textContent).toContain('References (2)');
    });

    it('renders button with combined count', () => {
        render(
            <ReferencesDropdown
                planPath="/plan.md"
                files={[{ filePath: '/a.ts' }, { filePath: '/b.ts' }]}
            />
        );
        expect(screen.getByTestId('references-dropdown-btn').textContent).toContain('References (3)');
    });

    it('dropdown is hidden by default', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        expect(screen.queryByTitle('/plan.md')).toBeNull();
    });

    it('shows dropdown when button is clicked', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        expect(document.querySelector('[data-full-path="/plan.md"]')).toBeTruthy();
    });

    it('hides dropdown on second click (toggle)', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        const btn = screen.getByTestId('references-dropdown-btn');
        fireEvent.click(btn);
        fireEvent.click(btn);
        expect(document.querySelector('[data-full-path="/plan.md"]')).toBeNull();
    });

    it('closes dropdown on outside mousedown', () => {
        render(
            <div>
                <ReferencesDropdown planPath="/plan.md" />
                <button data-testid="outside">Outside</button>
            </div>
        );
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        expect(document.querySelector('[data-full-path="/plan.md"]')).toBeTruthy();
        fireEvent.mouseDown(screen.getByTestId('outside'));
        expect(document.querySelector('[data-full-path="/plan.md"]')).toBeNull();
    });

    it('closes dropdown on outside touchstart', () => {
        render(
            <div>
                <ReferencesDropdown planPath="/plan.md" />
                <button data-testid="outside">Outside</button>
            </div>
        );
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        expect(document.querySelector('[data-full-path="/plan.md"]')).toBeTruthy();
        fireEvent.touchStart(screen.getByTestId('outside'));
        expect(document.querySelector('[data-full-path="/plan.md"]')).toBeNull();
    });

    it('popover has responsive max-width constraint', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        // Desktop panel uses sm:max-w-[800px] for responsive sizing
        const popover = document.querySelector('.sm\\:max-w-\\[800px\\]');
        expect(popover).not.toBeNull();
    });

    it('popover has responsive min-width on sm+ screens', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        // Desktop panel uses sm:min-w-[420px] instead of hard min-w-[420px]
        const popover = document.querySelector('.sm\\:min-w-\\[420px\\]');
        expect(popover).not.toBeNull();
    });

    it('popover falls back to full-width on narrow viewports', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        // Base width class for narrow (mobile-sized) viewports
        const popover = document.querySelector('.w-\\[calc\\(100vw-32px\\)\\]');
        expect(popover).not.toBeNull();
    });

    it('FilePathLink inside dropdown uses noTruncate (break-all) and sans-serif font', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        const link = document.querySelector('[data-full-path="/plan.md"]');
        expect(link?.className).toContain('break-all');
        expect(link?.className).toContain('text-xs');
        expect(link?.className).toContain('font-sans');
    });

    it('does not render BottomSheet on desktop', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        expect(screen.queryByTestId('bottomsheet-mock')).toBeNull();
    });
});

describe('ReferencesDropdown — mobile', () => {
    beforeEach(() => {
        mockBreakpoint.isMobile = true;
        mockBreakpoint.isTablet = false;
        mockBreakpoint.isDesktop = false;
        mockBreakpoint.breakpoint = 'mobile';
    });

    it('renders nothing when no references', () => {
        const { container } = render(<ReferencesDropdown />);
        expect(container.innerHTML).toBe('');
    });

    it('renders button with correct count on mobile', () => {
        render(<ReferencesDropdown planPath="/plan.md" files={[{ filePath: '/a.ts' }]} />);
        expect(screen.getByTestId('references-dropdown-btn').textContent).toContain('References (2)');
    });

    it('BottomSheet is closed by default', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        expect(screen.queryByTestId('bottomsheet-mock')).toBeNull();
    });

    it('tapping button opens BottomSheet on mobile', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        expect(screen.getByTestId('bottomsheet-mock')).toBeTruthy();
    });

    it('BottomSheet title shows reference count', () => {
        render(<ReferencesDropdown planPath="/plan.md" files={[{ filePath: '/a.ts' }]} />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        expect(screen.getByTestId('bottomsheet-mock').dataset['title']).toBe('References (2)');
    });

    it('BottomSheet renders file paths inside', () => {
        render(<ReferencesDropdown planPath="/plan.md" files={[{ filePath: '/src/app.ts' }]} />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        expect(document.querySelector('[data-full-path="/plan.md"]')).toBeTruthy();
        expect(document.querySelector('[data-full-path="/src/app.ts"]')).toBeTruthy();
    });

    it('closing BottomSheet dismisses it', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        expect(screen.getByTestId('bottomsheet-mock')).toBeTruthy();
        fireEvent.click(screen.getByTestId('bottomsheet-close'));
        expect(screen.queryByTestId('bottomsheet-mock')).toBeNull();
    });

    it('does not render absolute dropdown panel on mobile', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        // No inline dropdown div — content is in BottomSheet
        expect(document.querySelector('.w-\\[calc\\(100vw-32px\\)\\]')).toBeNull();
    });

    it('stamps data-ws-id on BottomSheet content div when wsId is provided', () => {
        render(<ReferencesDropdown planPath="/plan.md" wsId="ws-xyz" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        const wsEl = document.querySelector('[data-ws-id="ws-xyz"]');
        expect(wsEl).not.toBeNull();
        // FilePathLink should be inside the stamped container
        expect(wsEl!.querySelector('[data-full-path="/plan.md"]')).toBeTruthy();
    });

    it('does not stamp data-ws-id on BottomSheet content when wsId is omitted', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        expect(document.querySelector('[data-ws-id]')).toBeNull();
    });
});
