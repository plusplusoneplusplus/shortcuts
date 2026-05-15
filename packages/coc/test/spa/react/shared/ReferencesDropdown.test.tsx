/**
 * Tests for ReferencesDropdown shared component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ── Hoisted mutable mock state ─────────────────────────────────────────────

const { mockBreakpoint } = vi.hoisted(function () { return ({
    mockBreakpoint: { isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' as const },
}); });

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', function () { return ({
    useBreakpoint: () => mockBreakpoint,
}); });

// BottomSheet stub — renders inline for testability (avoids portal complexity)
vi.mock('../../../../src/server/spa/client/react/ui/BottomSheet', function () { return ({
    BottomSheet: ({ isOpen, onClose, title, children }: any) =>
        isOpen ? (
            <div data-testid="bottomsheet-mock" data-title={title}>
                <button data-testid="bottomsheet-close" onClick={onClose}>close</button>
                {children}
            </div>
        ) : null,
}); });

import {
    computeReferencesDropdownPlacement,
    ReferencesDropdown,
} from '../../../../src/server/spa/client/react/ui/ReferencesDropdown';

// FilePathLink renders a span with the path — no context needed

beforeEach(() => {
    // Reset to desktop for each test
    mockBreakpoint.isMobile = false;
    mockBreakpoint.isTablet = false;
    mockBreakpoint.isDesktop = true;
    mockBreakpoint.breakpoint = 'desktop';
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

function mockTriggerRect(rect: Partial<DOMRect>) {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 28,
        top: 20,
        right: 760,
        bottom: 48,
        left: 660,
        toJSON: function () { return ({}); },
        ...rect,
    } as DOMRect);
}

describe('computeReferencesDropdownPlacement', () => {
    it('right-aligns the panel to the trigger with the existing vertical gap', () => {
        expect(computeReferencesDropdownPlacement({ right: 760, bottom: 48 }, 520, 1024)).toEqual({
            top: 55,
            left: 240,
        });
    });

    it('clamps the panel inside the left viewport margin', () => {
        expect(computeReferencesDropdownPlacement({ right: 300, bottom: 48 }, 520, 1024).left).toBe(12);
    });

    it('clamps the panel inside the right viewport margin', () => {
        expect(computeReferencesDropdownPlacement({ right: 1200, bottom: 48 }, 520, 1024).left).toBe(492);
    });
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
        const btn = screen.getByTestId('references-dropdown-btn');
        expect(btn.textContent).toContain('References');
        expect(btn.textContent).toContain('1');
    });

    it('renders button with count of references (files only)', () => {
        // .ts is filtered out by PINNED_EXTENSIONS in the conversation scanner,
        // but ReferencesDropdown itself doesn't filter — it shows whatever its
        // caller passes in. The mobile-only "(N)" label test below covers
        // the BottomSheet title which uses the same total.
        render(
            <ReferencesDropdown files={[{ filePath: '/a.md' }, { filePath: '/b.md' }]} />
        );
        const btn = screen.getByTestId('references-dropdown-btn');
        expect(btn.textContent).toContain('References');
        expect(btn.textContent).toContain('2');
    });

    it('renders button with combined count', () => {
        render(
            <ReferencesDropdown
                planPath="/plan.md"
                files={[{ filePath: '/a.md' }, { filePath: '/b.md' }]}
            />
        );
        const btn = screen.getByTestId('references-dropdown-btn');
        expect(btn.textContent).toContain('References');
        expect(btn.textContent).toContain('3');
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

    it('renders desktop dropdown in a document.body portal with fixed placement', () => {
        mockTriggerRect({ right: 760, bottom: 48 });
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));

        const dialog = screen.getByRole('dialog', { name: 'References' });
        expect(dialog.parentElement).toBe(document.body);
        expect(dialog.className).toContain('fixed');
        expect(dialog.className).not.toContain('absolute');
        expect(dialog.style.top).toBe('55px');
        expect(dialog.style.left).toBe('240px');
    });

    it('keeps clicks inside the portaled panel from closing the dropdown', () => {
        mockTriggerRect({ right: 760, bottom: 48 });
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));

        const dialog = screen.getByRole('dialog', { name: 'References' });
        fireEvent.mouseDown(dialog);

        expect(screen.getByRole('dialog', { name: 'References' })).toBeTruthy();
    });

    it('recomputes fixed placement when the viewport changes while open', () => {
        let right = 760;
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
            x: 0,
            y: 0,
            width: 100,
            height: 28,
            top: 20,
            right,
            bottom: 48,
            left: right - 100,
            toJSON: () => ({}),
        } as DOMRect));

        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        const dialog = screen.getByRole('dialog', { name: 'References' });
        expect(dialog.style.left).toBe('240px');

        right = 700;
        fireEvent(window, new Event('resize'));

        expect(dialog.style.left).toBe('180px');
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

    it('popover has fixed width at sm+ breakpoint', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        // Redesigned desktop panel uses sm:w-[520px] (single fixed width)
        const popover = document.querySelector('.sm\\:w-\\[520px\\]');
        expect(popover).not.toBeNull();
    });

    it('popover has matching sm+ max-width to prevent overflow', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        const popover = document.querySelector('.sm\\:max-w-\\[520px\\]');
        expect(popover).not.toBeNull();
    });

    it('popover falls back to full-width on narrow viewports', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        // Base width class for narrow (mobile-sized) viewports
        const popover = document.querySelector('.w-\\[calc\\(100vw-24px\\)\\]');
        expect(popover).not.toBeNull();
    });

    it('reference row carries data-full-path so global preview/click delegation resolves it', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        const link = document.querySelector('[data-full-path="/plan.md"]');
        expect(link).not.toBeNull();
        expect(link?.className).toContain('file-path-link');
    });

    it('reference row renders fileName as a sans-serif title for legibility', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        // The .file-path-link wrapper defaults to mono via global CSS, but the
        // visible filename inside is explicitly font-sans for the redesign.
        const link = document.querySelector('[data-full-path="/plan.md"]');
        const title = link?.querySelector('.font-sans');
        expect(title).not.toBeNull();
        expect(title?.textContent).toBe('plan.md');
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
        render(<ReferencesDropdown planPath="/plan.md" files={[{ filePath: '/a.md' }]} />);
        const btn = screen.getByTestId('references-dropdown-btn');
        expect(btn.textContent).toContain('References');
        expect(btn.textContent).toContain('2');
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
        render(<ReferencesDropdown planPath="/plan.md" files={[{ filePath: '/a.md' }]} />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        expect(screen.getByTestId('bottomsheet-mock').dataset['title']).toBe('References (2)');
    });

    it('BottomSheet renders file paths inside', () => {
        render(<ReferencesDropdown planPath="/plan.md" files={[{ filePath: '/src/notes.md' }]} />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        expect(document.querySelector('[data-full-path="/plan.md"]')).toBeTruthy();
        expect(document.querySelector('[data-full-path="/src/notes.md"]')).toBeTruthy();
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
        expect(document.querySelector('.w-\\[calc\\(100vw-24px\\)\\]')).toBeNull();
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
