/**
 * Theme script: initTheme, toggleTheme, updateThemeStyles,
 * sidebar collapse handler, and restoreSidebarState IIFE.
 */
export function getThemeScript(): string {
    return `
        // ================================================================
        // Theme
        // ================================================================

        function initTheme() {
            var saved = localStorage.getItem('deep-wiki-theme');
            if (saved) {
                currentTheme = saved;
                document.documentElement.setAttribute('data-theme', currentTheme);
            }
            updateThemeStyles();
        }

        function toggleTheme() {
            if (currentTheme === 'auto') currentTheme = 'dark';
            else if (currentTheme === 'dark') currentTheme = 'light';
            else currentTheme = 'auto';
            document.documentElement.setAttribute('data-theme', currentTheme);
            localStorage.setItem('deep-wiki-theme', currentTheme);
            updateThemeStyles();
        }

        function updateThemeStyles() {
            var isDark = currentTheme === 'dark' ||
                (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
            var ls = document.getElementById('hljs-light');
            var ds = document.getElementById('hljs-dark');
            if (ls) ls.disabled = isDark;
            if (ds) ds.disabled = !isDark;
            var btn = document.getElementById('theme-toggle');
            if (btn) btn.textContent = isDark ? '\\u2600' : '\\u263E';
        }

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeStyles);
        document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

        // Sidebar collapse
        document.getElementById('sidebar-collapse').addEventListener('click', function() {
            var sidebar = document.getElementById('sidebar');
            var isCollapsed = sidebar.classList.toggle('collapsed');
            updateSidebarCollapseBtn(isCollapsed);
            localStorage.setItem('deep-wiki-sidebar-collapsed', isCollapsed ? 'true' : 'false');
        });

        function updateSidebarCollapseBtn(isCollapsed) {
            var btn = document.getElementById('sidebar-collapse');
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

        // Restore sidebar collapsed state
        (function restoreSidebarState() {
            var saved = localStorage.getItem('deep-wiki-sidebar-collapsed');
            if (saved === 'true') {
                document.getElementById('sidebar').classList.add('collapsed');
                updateSidebarCollapseBtn(true);
            }
        })();
`;
}
