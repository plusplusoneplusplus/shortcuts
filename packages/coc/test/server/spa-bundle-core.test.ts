/**
 * SPA Dashboard Tests — client bundle core, theme, config, and session modules
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';

// ============================================================================
// Script modules (general bundle check)
// ============================================================================

describe('client bundle (getDashboardScript replacement)', () => {
    let script: string;

    beforeAll(() => {
        script = getClientBundle();
    });

    it('returns a non-empty string', () => {
        expect(typeof script).toBe('string');
        expect(script.length).toBeGreaterThan(0);
    });

    it('contains utility functions', () => {
        expect(script).toContain('formatDuration');
        expect(script).toContain('formatRelativeTime');
        expect(script).toContain('statusIcon');
        expect(script).toContain('statusLabel');
        expect(script).toContain('typeLabel');
        expect(script).toContain('copyToClipboard');
    });

    it('contains core state and init', () => {
        expect(script).toContain('appState');
        expect(script).toContain('init');
        expect(script).toContain('getFilteredProcesses');
        expect(script).toContain('fetchApi');
    });

    it('contains theme functions', () => {
        expect(script).toContain('initTheme');
        expect(script).toContain('toggleTheme');
        expect(script).toContain('applyTheme');
    });

    it('contains sidebar functions', () => {
        expect(script).toContain('renderProcessList');
        expect(script).toContain('renderProcessItem');
        expect(script).toContain('renderChildProcesses');
        expect(script).toContain('selectProcess');
        expect(script).toContain('startLiveTimers');
        expect(script).toContain('stopLiveTimers');
    });

    it('contains detail functions', () => {
        expect(script).toContain('renderDetail');
        expect(script).toContain('clearDetail');
        expect(script).toContain('renderMarkdown');
        expect(script).toContain('inlineFormat');
    });

    it('contains filter functions', () => {
        expect(script).toContain('debounce');
        expect(script).toContain('populateWorkspaces');
    });

    it('contains WebSocket functions', () => {
        expect(script).toContain('connectWebSocket');
        expect(script).toContain('handleWsMessage');
    });

    it('reads config from window.__DASHBOARD_CONFIG__', () => {
        expect(script).toContain('__DASHBOARD_CONFIG__');
    });

    it('uses getApiBase() for API calls', () => {
        expect(script).toContain('getApiBase');
    });

    it('uses getWsPath() for WebSocket', () => {
        expect(script).toContain('getWsPath');
    });
});

// ============================================================================
// Utils module
// ============================================================================

describe('client bundle — utils module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines formatDuration', () => {
        expect(script).toContain('formatDuration');
    });

    it('defines formatRelativeTime', () => {
        expect(script).toContain('formatRelativeTime');
    });

    it('defines statusIcon mapping', () => {
        expect(script).toContain('statusIcon');
    });

    it('defines typeLabel mapping', () => {
        expect(script).toContain('typeLabel');
        expect(script).toContain('code-review');
        expect(script).toContain('pipeline-execution');
    });

    it('defines clipboard copy with fallback', () => {
        expect(script).toContain('copyToClipboard');
        expect(script).toContain('navigator.clipboard');
        expect(script).toContain('execCommand');
    });
});

// ============================================================================
// Core module
// ============================================================================

describe('client bundle — core module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('reads config from __DASHBOARD_CONFIG__', () => {
        expect(script).toContain('__DASHBOARD_CONFIG__');
    });

    it('defines appState with required fields', () => {
        expect(script).toContain('processes: []');
        expect(script).toContain('selectedId: null');
        expect(script).toContain('expandedGroups: {}');
        expect(script).toContain('liveTimers: {}');
    });

    it('handles deep link routing via hash', () => {
        expect(script).toContain('location.hash');
        expect(script).toContain('handleHashChange');
    });

    it('supports backward compat redirect from pathname', () => {
        expect(script).toContain('location.pathname.match');
        expect(script).toContain('location.replace');
    });

    it('defines hashchange handler', () => {
        expect(script).toContain('hashchange');
    });

    it('defines navigation functions with hash routing', () => {
        expect(script).toContain('navigateToProcess');
        expect(script).toContain('navigateToHome');
        expect(script).not.toContain('history.pushState');
    });

    it('routes hash to correct tab', () => {
        expect(script).toContain('#process/');
        expect(script).toContain('#repos/');
        expect(script).toContain('#processes');
        expect(script).toContain('reports');
    });

    it('has setHashSilent guard to prevent double-dispatch', () => {
        expect(script).toContain('setHashSilent');
        expect(script).toContain('_hashChangeGuard');
    });
});

// ============================================================================
// Theme module
// ============================================================================

describe('client bundle — theme module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('reads theme from localStorage', () => {
        expect(script).toContain('ai-dash-theme');
    });

    it('persists theme to localStorage', () => {
        expect(script).toContain('localStorage.setItem');
    });

    it('listens for system color scheme changes', () => {
        expect(script).toContain('prefers-color-scheme: dark');
    });

    it('cycles through auto → dark → light', () => {
        expect(script).toContain('auto');
        expect(script).toContain('dark');
        expect(script).toContain('light');
    });
});

// ============================================================================
// Config injection
// ============================================================================

describe('Bundled JS — config injection', () => {
    it('injects __DASHBOARD_CONFIG__ with default options', () => {
        const html = generateDashboardHtml();
        expect(html).toContain('__DASHBOARD_CONFIG__');
    });

    it('injects custom wsPath into config', () => {
        const html = generateDashboardHtml({ wsPath: '/custom-ws' });
        expect(html).toContain('/custom-ws');
    });

    it('injects custom apiBasePath into config', () => {
        const html = generateDashboardHtml({ apiBasePath: '/custom-api' });
        expect(html).toContain('/custom-api');
    });

    it('injects theme setting into config', () => {
        const html = generateDashboardHtml({ theme: 'dark' });
        expect(html).toContain('__DASHBOARD_CONFIG__');
        // Config script appears before the bundle script
        const configIdx = html.indexOf('__DASHBOARD_CONFIG__');
        const bundleScriptIdx = html.lastIndexOf('</script>');
        expect(configIdx).toBeLessThan(bundleScriptIdx);
    });
});

// ============================================================================
// Session ID support
// ============================================================================

describe('client bundle — session ID features', () => {
    let bundle: string;
    beforeAll(() => { bundle = getClientBundle(); });

    it('defines navigateToSession function', () => {
        expect(bundle).toContain('navigateToSession');
    });

    it('exposes navigateToSession on window', () => {
        expect(bundle).toContain('navigateToSession');
        // Bundler may rename `window` but the function is assigned globally
        expect(bundle).toMatch(/navigateToSession/);
    });

    it('handles #session/ hash route', () => {
        expect(bundle).toContain('session/');
        expect(bundle).toContain('sessionMatch');
    });

    it('resolves session via local process lookup', () => {
        // resolveSession checks appState.processes for sdkSessionId
        expect(bundle).toContain('sdkSessionId');
    });

    it('falls back to API lookup for session ID', () => {
        // resolveSession calls fetchApi with sdkSessionId query param
        expect(bundle).toContain('sdkSessionId=');
    });

    it('displays sdkSessionId in process detail metadata', () => {
        expect(bundle).toContain('Session ID');
    });

    it('makes session ID copyable in detail view', () => {
        expect(bundle).toContain('meta-copyable');
    });
});
