import type { WebsiteTheme } from '../../../types';

/**
 * Core initialization script: global variables, init(), popstate handler,
 * and the client-side escapeHtml utility.
 */
export function getCoreScript(defaultTheme: WebsiteTheme): string {
    return `        // ====================================================================
        // Deep Wiki — Server Mode SPA
        // ====================================================================

        var moduleGraph = null;
        var currentModuleId = null;
        var currentTheme = '${defaultTheme}';
        var markdownCache = {};

        // Initialize
        init();

        async function init() {
            try {
                var res = await fetch('/api/graph');
                if (!res.ok) throw new Error('Failed to load module graph');
                moduleGraph = await res.json();

                initTheme();
                initializeSidebar();
                showHome(true);
                history.replaceState({ type: 'home' }, '', location.pathname);
            } catch(err) {
                document.getElementById('content').innerHTML =
                    '<p style="color: red;">Error loading wiki data: ' + err.message + '</p>';
            }
        }

        // ================================================================
        // Browser History
        // ================================================================

        window.addEventListener('popstate', function(e) {
            var state = e.state;
            if (!state) { showHome(true); return; }
            if (state.type === 'home') showHome(true);
            else if (state.type === 'module' && state.id) loadModule(state.id, true);
            else if (state.type === 'special' && state.key && state.title) loadSpecialPage(state.key, state.title, true);
            else if (state.type === 'graph') { if (typeof showGraph === 'function') showGraph(true); else showHome(true); }
            else if (state.type === 'admin') showAdmin(true);
            else showHome(true);
        });

        // ================================================================
        // Utility
        // ================================================================

        function escapeHtml(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
`;
}
