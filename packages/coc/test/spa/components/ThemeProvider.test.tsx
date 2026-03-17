/**
 * Tests for ThemeProvider — localStorage, matchMedia, class application, toggleTheme.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../../../src/server/spa/client/react/layout/ThemeProvider';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMatchMedia(dark = false) {
    return vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)' ? dark : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

function ThemeConsumer({ onTheme }: { onTheme: (t: string) => void }) {
    const { theme } = useTheme();
    onTheme(theme);
    return <div data-testid="theme">{theme}</div>;
}

beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    window.matchMedia = makeMatchMedia(false);
    // Mock fetch for server preferences (ThemeProvider fetches on mount)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ThemeProvider', () => {
    it('defaults to "auto" when no localStorage value', async () => {
        const onTheme = vi.fn();
        render(
            <ThemeProvider>
                <ThemeConsumer onTheme={onTheme} />
            </ThemeProvider>
        );
        await waitFor(() => expect(onTheme).toHaveBeenCalledWith('auto'));
    });

    it('restores stored "dark" theme from localStorage on mount', async () => {
        localStorage.setItem('ai-dash-theme', 'dark');
        const onTheme = vi.fn();
        render(
            <ThemeProvider>
                <ThemeConsumer onTheme={onTheme} />
            </ThemeProvider>
        );
        await waitFor(() => expect(onTheme).toHaveBeenCalledWith('dark'));
    });

    it('restores stored "light" theme from localStorage on mount', async () => {
        localStorage.setItem('ai-dash-theme', 'light');
        const onTheme = vi.fn();
        render(
            <ThemeProvider>
                <ThemeConsumer onTheme={onTheme} />
            </ThemeProvider>
        );
        await waitFor(() => expect(onTheme).toHaveBeenCalledWith('light'));
    });

    it('system dark preference → adds "dark" class to <html>', async () => {
        window.matchMedia = makeMatchMedia(true);
        render(<ThemeProvider><div /></ThemeProvider>);
        await waitFor(() => {
            expect(document.documentElement.classList.contains('dark')).toBe(true);
        });
    });

    it('system light preference → does NOT add "dark" class to <html>', async () => {
        window.matchMedia = makeMatchMedia(false);
        render(<ThemeProvider><div /></ThemeProvider>);
        await waitFor(() => {
            expect(document.documentElement.classList.contains('dark')).toBe(false);
        });
    });

    it('toggleTheme cycles auto → dark → light → auto', async () => {
        const themeValues: string[] = [];
        function ToggleConsumer() {
            const { theme, toggleTheme } = useTheme();
            themeValues.push(theme);
            return <button onClick={toggleTheme}>Toggle</button>;
        }

        const { getByRole } = render(
            <ThemeProvider>
                <ToggleConsumer />
            </ThemeProvider>
        );
        // Start: auto
        await waitFor(() => expect(themeValues.at(-1)).toBe('auto'));

        // First toggle: auto → dark
        act(() => { getByRole('button').click(); });
        await waitFor(() => expect(themeValues.at(-1)).toBe('dark'));

        // Second toggle: dark → light
        act(() => { getByRole('button').click(); });
        await waitFor(() => expect(themeValues.at(-1)).toBe('light'));

        // Third toggle: light → auto
        act(() => { getByRole('button').click(); });
        await waitFor(() => expect(themeValues.at(-1)).toBe('auto'));
    });

    it('persists theme to localStorage on toggle', async () => {
        function ToggleBtn() {
            const { toggleTheme } = useTheme();
            return <button onClick={toggleTheme}>Toggle</button>;
        }
        const { getByRole } = render(
            <ThemeProvider>
                <ToggleBtn />
            </ThemeProvider>
        );
        act(() => { getByRole('button').click(); });
        await waitFor(() => {
            expect(localStorage.getItem('ai-dash-theme')).toBe('dark');
        });
    });

    it('force "dark" theme applies dark class regardless of system preference', async () => {
        localStorage.setItem('ai-dash-theme', 'dark');
        window.matchMedia = makeMatchMedia(false); // system says light
        render(<ThemeProvider><div /></ThemeProvider>);
        await waitFor(() => {
            expect(document.documentElement.classList.contains('dark')).toBe(true);
        });
    });

    it('force "light" theme removes dark class even if system prefers dark', async () => {
        localStorage.setItem('ai-dash-theme', 'light');
        window.matchMedia = makeMatchMedia(true); // system says dark
        render(<ThemeProvider><div /></ThemeProvider>);
        await waitFor(() => {
            expect(document.documentElement.classList.contains('dark')).toBe(false);
        });
    });

    it('restores server-persisted theme on mount (overrides localStorage)', async () => {
        localStorage.setItem('ai-dash-theme', 'light');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ theme: 'dark' }),
        }));
        const onTheme = vi.fn();
        render(
            <ThemeProvider>
                <ThemeConsumer onTheme={onTheme} />
            </ThemeProvider>
        );
        await waitFor(() => {
            const calls = onTheme.mock.calls.map(c => c[0]);
            expect(calls).toContain('dark');
        });
    });
});
