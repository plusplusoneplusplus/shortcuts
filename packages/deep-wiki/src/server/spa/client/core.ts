/**
 * Core initialization: global state, init(), popstate handler, escapeHtml().
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export let moduleGraph: any = null;
export let currentModuleId: string | null = null;
export let currentTheme: string = (window as any).__WIKI_CONFIG__?.defaultTheme ?? 'auto';
export const markdownCache: Record<string, string> = {};

/**
 * Set the current module graph.
 */
export function setModuleGraph(graph: any): void {
    moduleGraph = graph;
}

/**
 * Set the current module ID.
 */
export function setCurrentModuleId(id: string | null): void {
    currentModuleId = id;
}

/**
 * Set the current theme.
 */
export function setCurrentTheme(theme: string): void {
    currentTheme = theme;
}

/**
 * Initialize the SPA: fetch graph, init theme & sidebar, show home, set up history.
 */
export async function init(): Promise<void> {
    try {
        const res = await fetch('/api/graph');
        if (!res.ok) throw new Error('Failed to load module graph');
        moduleGraph = await res.json();

        // These are called via window globals set by index.ts
        (window as any).initTheme();
        (window as any).initializeSidebar();
        (window as any).showHome(true);
        history.replaceState({ type: 'home' }, '', location.pathname);
    } catch (err: any) {
        const el = document.getElementById('content');
        if (el) {
            el.innerHTML = '<p style="color: red;">Error loading wiki data: ' + err.message + '</p>';
        }
    }
}

/**
 * Browser history popstate handler.
 */
export function setupPopstateHandler(): void {
    window.addEventListener('popstate', function (e: PopStateEvent) {
        const state = e.state;
        if (!state) { (window as any).showHome(true); return; }
        if (state.type === 'home') (window as any).showHome(true);
        else if (state.type === 'module' && state.id) (window as any).loadModule(state.id, true);
        else if (state.type === 'special' && state.key && state.title) (window as any).loadSpecialPage(state.key, state.title, true);
        else if (state.type === 'topic' && state.topicId && state.slug) (window as any).loadTopicArticle(state.topicId, state.slug, true);
        else if (state.type === 'graph') { if (typeof (window as any).showGraph === 'function') (window as any).showGraph(true); else (window as any).showHome(true); }
        else if (state.type === 'admin') (window as any).showAdmin(true);
        else (window as any).showHome(true);
    });
}

/**
 * Escape HTML special characters.
 */
export function escapeHtml(str: string): string {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
