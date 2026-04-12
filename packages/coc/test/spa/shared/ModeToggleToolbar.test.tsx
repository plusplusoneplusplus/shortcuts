/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { ModeToggleToolbar } from '../../../src/server/spa/client/react/shared/ModeToggleToolbar';
import type { ModeOption } from '../../../src/server/spa/client/react/shared/ModeToggleToolbar';

afterEach(() => {
    cleanup();
});

const MODES: readonly ModeOption<'alpha' | 'beta'>[] = [
    { value: 'alpha', label: 'Alpha', testId: 'mode-alpha' },
    { value: 'beta', label: 'Beta', testId: 'mode-beta' },
];

describe('ModeToggleToolbar', () => {
    describe('rendering mode buttons', () => {
        it('renders a button for each mode', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={() => {}} />);
            expect(screen.getByText('Alpha')).toBeTruthy();
            expect(screen.getByText('Beta')).toBeTruthy();
        });

        it('marks the active mode button with the active class', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={() => {}} />);
            expect(screen.getByText('Alpha').className).toContain('active');
            expect(screen.getByText('Beta').className).not.toContain('active');
        });

        it('marks a different active mode correctly', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="beta" onModeChange={() => {}} />);
            expect(screen.getByText('Alpha').className).not.toContain('active');
            expect(screen.getByText('Beta').className).toContain('active');
        });

        it('applies data-testid from mode options', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={() => {}} />);
            expect(screen.getByTestId('mode-alpha')).toBeTruthy();
            expect(screen.getByTestId('mode-beta')).toBeTruthy();
        });

        it('applies data-testid to the container when testId prop is given', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={() => {}} testId="my-toolbar" />);
            expect(screen.getByTestId('my-toolbar')).toBeTruthy();
        });

        it('renders the outer div with the mode-toggle class', () => {
            const { container } = render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={() => {}} />);
            expect(container.querySelector('.mode-toggle')).toBeTruthy();
        });
    });

    describe('switching modes', () => {
        it('calls onModeChange when clicking an inactive mode', () => {
            const onChange = vi.fn();
            render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={onChange} />);
            fireEvent.click(screen.getByText('Beta'));
            expect(onChange).toHaveBeenCalledWith('beta');
        });

        it('does not call onModeChange when clicking the already-active mode', () => {
            const onChange = vi.fn();
            render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={onChange} />);
            fireEvent.click(screen.getByText('Alpha'));
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    describe('dirty indicator', () => {
        it('shows dirty marker on active mode label when dirty=true', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="beta" onModeChange={() => {}} dirty />);
            expect(screen.getByText('Beta ●')).toBeTruthy();
        });

        it('does not show dirty marker on inactive mode', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="beta" onModeChange={() => {}} dirty />);
            expect(screen.getByText('Alpha').textContent).toBe('Alpha');
        });

        it('sets aria-label with (modified) on the dirty active button', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="beta" onModeChange={() => {}} dirty />);
            expect(screen.getByTestId('mode-beta').getAttribute('aria-label')).toBe('Beta (modified)');
        });

        it('does not set aria-label when not dirty', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="beta" onModeChange={() => {}} />);
            expect(screen.getByTestId('mode-beta').getAttribute('aria-label')).toBeNull();
        });
    });

    describe('conditional save button', () => {
        it('does not render save button by default', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={() => {}} />);
            expect(screen.queryByText('Save')).toBeNull();
        });

        it('does not render save button when showSave=true but dirty=false', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={() => {}} showSave />);
            expect(screen.queryByText('Save')).toBeNull();
        });

        it('renders save button when showSave and dirty are both true', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={() => {}} showSave dirty />);
            expect(screen.getByText('Save')).toBeTruthy();
        });

        it('calls onSave when save button is clicked', () => {
            const onSave = vi.fn();
            render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={() => {}} showSave dirty onSave={onSave} />);
            fireEvent.click(screen.getByText('Save'));
            expect(onSave).toHaveBeenCalledOnce();
        });

        it('disables save button and shows "Saving…" when saving=true', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={() => {}} showSave dirty saving />);
            const btn = screen.getByText('Saving…');
            expect(btn).toBeTruthy();
            expect((btn as HTMLButtonElement).disabled).toBe(true);
        });

        it('save button has save-btn class', () => {
            render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={() => {}} showSave dirty />);
            expect(screen.getByText('Save').className).toContain('save-btn');
        });
    });

    describe('right-side slot', () => {
        it('does not render extra content when right is not provided', () => {
            const { container } = render(<ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={() => {}} />);
            const buttons = container.querySelectorAll('button');
            expect(buttons.length).toBe(2); // only mode buttons
        });

        it('renders the right slot content', () => {
            render(
                <ModeToggleToolbar modes={MODES} activeMode="alpha" onModeChange={() => {}}>
                    {/* right is a prop, not children */}
                </ModeToggleToolbar>,
            );
            // Use prop-based right
            render(
                <ModeToggleToolbar
                    modes={MODES}
                    activeMode="alpha"
                    onModeChange={() => {}}
                    right={<button data-testid="custom-action">Action</button>}
                />,
            );
            expect(screen.getByTestId('custom-action')).toBeTruthy();
            expect(screen.getByText('Action')).toBeTruthy();
        });

        it('renders right slot alongside mode buttons', () => {
            const { container } = render(
                <ModeToggleToolbar
                    modes={MODES}
                    activeMode="alpha"
                    onModeChange={() => {}}
                    right={<span data-testid="right-slot">Extra</span>}
                />,
            );
            // Mode buttons + right slot all inside .mode-toggle
            const toggle = container.querySelector('.mode-toggle')!;
            expect(toggle.querySelector('[data-testid="right-slot"]')).toBeTruthy();
            expect(toggle.querySelector('[data-testid="mode-alpha"]')).toBeTruthy();
        });
    });

    describe('three-mode toolbar', () => {
        const THREE_MODES: readonly ModeOption<'a' | 'b' | 'c'>[] = [
            { value: 'a', label: 'Mode A' },
            { value: 'b', label: 'Mode B' },
            { value: 'c', label: 'Mode C' },
        ];

        it('renders all three mode buttons', () => {
            render(<ModeToggleToolbar modes={THREE_MODES} activeMode="b" onModeChange={() => {}} />);
            expect(screen.getByText('Mode A')).toBeTruthy();
            expect(screen.getByText('Mode B')).toBeTruthy();
            expect(screen.getByText('Mode C')).toBeTruthy();
        });

        it('only the active mode has the active class', () => {
            render(<ModeToggleToolbar modes={THREE_MODES} activeMode="b" onModeChange={() => {}} />);
            expect(screen.getByText('Mode A').className).not.toContain('active');
            expect(screen.getByText('Mode B').className).toContain('active');
            expect(screen.getByText('Mode C').className).not.toContain('active');
        });
    });
});
