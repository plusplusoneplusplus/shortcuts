/**
 * Theme script: initTheme, toggleTheme, updateThemeStyles,
 * sidebar collapse handler, and restoreSidebarState.
 */

import { currentTheme, setCurrentTheme } from './core';

export function initTheme(): void {
    const saved = localStorage.getItem('deep-wiki-theme');
    if (saved) {
        setCurrentTheme(saved);
        document.documentElement.setAttribute('data-theme', currentTheme);
    }
    updateThemeStyles();
}

export function toggleTheme(): void {
    if (currentTheme === 'auto') setCurrentTheme('dark');
    else if (currentTheme === 'dark') setCurrentTheme('light');
    else setCurrentTheme('auto');
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('deep-wiki-theme', currentTheme);
    updateThemeStyles();
}

export function updateThemeStyles(): void {
    const isDark = currentTheme === 'dark' ||
        (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const ls = document.getElementById('hljs-light') as HTMLLinkElement | null;
    const ds = document.getElementById('hljs-dark') as HTMLLinkElement | null;
    if (ls) ls.disabled = isDark;
    if (ds) ds.disabled = !isDark;
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = isDark ? '\u2600' : '\u263E';
}

export function updateSidebarCollapseBtn(isCollapsed: boolean): void {
    const btn = document.getElementById('sidebar-collapse');
    if (!btn) return;
    if (isCollapsed) {
        btn.innerHTML = '&#x25B6;';
        btn.title = 'Expand sidebar';
        btn.setAttribute('aria-label', 'Expand sidebar');
    } else {
        btn.innerHTML = '&#x25C0;';
        btn.title = 'Collapse sidebar';
        btn.setAttribute('aria-label', 'Collapse sidebar');
    }
}

/**
 * Set up theme event listeners. Called once from index.ts.
 */
export function setupThemeListeners(): void {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeStyles);

    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

    const collapseBtn = document.getElementById('sidebar-collapse');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', function () {
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            const isCollapsed = sidebar.classList.toggle('collapsed');
            updateSidebarCollapseBtn(isCollapsed);
            localStorage.setItem('deep-wiki-sidebar-collapsed', isCollapsed ? 'true' : 'false');
        });
    }

    // Restore sidebar collapsed state
    const saved = localStorage.getItem('deep-wiki-sidebar-collapsed');
    if (saved === 'true') {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.add('collapsed');
        updateSidebarCollapseBtn(true);
    }
}
