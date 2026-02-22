/**
 * ThemeProvider — replicates legacy theme.ts behaviour inside React.
 * Reads/writes localStorage['ai-dash-theme'], toggles dark class on <html>.
 * Also persists theme to server via PATCH /api/preferences for cross-session persistence.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { getApiBase } from '../utils/config';

type Theme = 'auto' | 'dark' | 'light';

interface ThemeContextValue {
    theme: Theme;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveIsDark(theme: Theme): boolean {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(isDark: boolean) {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    // Toggle highlight.js stylesheet pair
    const hljsLight = document.getElementById('hljs-light') as HTMLLinkElement | null;
    const hljsDark = document.getElementById('hljs-dark') as HTMLLinkElement | null;
    if (hljsLight) hljsLight.disabled = isDark;
    if (hljsDark) hljsDark.disabled = !isDark;
}

/** Persist theme to server (fire-and-forget). */
function persistThemeToServer(theme: Theme) {
    fetch(getApiBase() + '/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
    }).catch(() => {});
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setTheme] = useState<Theme>(() => {
        const stored = localStorage.getItem('ai-dash-theme');
        return (stored === 'dark' || stored === 'light') ? stored : 'auto';
    });

    // On mount, fetch persisted theme from server and apply if it differs
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(getApiBase() + '/preferences');
                if (!res.ok) return;
                const prefs = await res.json();
                if (cancelled) return;
                const serverTheme = prefs.theme;
                if (serverTheme === 'dark' || serverTheme === 'light' || serverTheme === 'auto') {
                    setTheme(serverTheme);
                    localStorage.setItem('ai-dash-theme', serverTheme);
                }
            } catch {
                // Preferences are optional — keep localStorage / default
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        applyTheme(resolveIsDark(theme));
    }, [theme]);

    useEffect(() => {
        if (theme !== 'auto') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => applyTheme(resolveIsDark('auto'));
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [theme]);

    const toggleTheme = useCallback(() => {
        setTheme(prev => {
            const next: Theme = prev === 'auto' ? 'dark' : prev === 'dark' ? 'light' : 'auto';
            localStorage.setItem('ai-dash-theme', next);
            persistThemeToServer(next);
            return next;
        });
    }, []);

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
    return ctx;
}
