/**
 * Theme toggle script: dark/light/auto with system preference detection.
 */

let currentTheme = 'auto';

export function initTheme(): void {
    const saved = localStorage.getItem('ai-dash-theme');
    if (saved) currentTheme = saved;
    applyTheme();
}

export function toggleTheme(): void {
    if (currentTheme === 'auto') currentTheme = 'dark';
    else if (currentTheme === 'dark') currentTheme = 'light';
    else currentTheme = 'auto';
    localStorage.setItem('ai-dash-theme', currentTheme);
    applyTheme();
}

export function applyTheme(): void {
    const isDark = currentTheme === 'dark' ||
        (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    const btn = document.getElementById('theme-toggle');
    if (btn) {
        if (currentTheme === 'auto') btn.textContent = '\u{1F317}';
        else if (currentTheme === 'dark') btn.textContent = '\u{1F319}';
        else btn.textContent = '\u2600\uFE0F';
    }
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
    if (currentTheme === 'auto') applyTheme();
});

const themeBtn = document.getElementById('theme-toggle');
if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
