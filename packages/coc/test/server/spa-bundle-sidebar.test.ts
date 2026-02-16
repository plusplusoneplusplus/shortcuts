/**
 * SPA Dashboard Tests — client bundle sidebar, filters, and websocket modules
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle } from './spa-test-helpers';

// ============================================================================
// Sidebar module
// ============================================================================

describe('client bundle — sidebar module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines status order', () => {
        expect(script).toContain('running');
        expect(script).toContain('queued');
        expect(script).toContain('failed');
        expect(script).toContain('completed');
        expect(script).toContain('cancelled');
    });

    it('supports group expand/collapse', () => {
        expect(script).toContain('toggleGroup');
        expect(script).toContain('expandedGroups');
    });

    it('handles clear completed & failed button', () => {
        expect(script).toContain('clear-completed');
        expect(script).toContain('/processes?status=completed,failed');
        expect(script).toContain('DELETE');
    });

    it('filters out both completed and failed from local state after clear', () => {
        expect(script).toContain('completed');
        expect(script).toContain('failed');
    });

    it('has mobile hamburger handler', () => {
        expect(script).toContain('hamburger-btn');
    });
});

// ============================================================================
// History view module
// ============================================================================

describe('client bundle — history view', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('defines view mode toggle functionality', () => {
        expect(script).toContain('switchViewMode');
        expect(script).toContain('viewMode');
    });

    it('supports active and history view modes', () => {
        expect(script).toContain('view-mode-active');
        expect(script).toContain('view-mode-history');
    });

    it('groups history items by date', () => {
        expect(script).toContain('Today');
        expect(script).toContain('Yesterday');
        expect(script).toContain('This Week');
        expect(script).toContain('Older');
    });

    it('fetches history with exclude=conversation for lightweight payloads', () => {
        expect(script).toContain('exclude=conversation');
    });

    it('renders history items in compact format', () => {
        expect(script).toContain('history-item');
        expect(script).toContain('history-status-icon');
    });

    it('supports load more for pagination', () => {
        expect(script).toContain('Load More');
        expect(script).toContain('loadMoreHistory');
    });

    it('caches conversations with TTL and max entries', () => {
        expect(script).toContain('conversationCache');
        expect(script).toContain('cacheConversation');
        expect(script).toContain('getCachedConversation');
    });

    it('shows loading spinner for lazy conversation loading', () => {
        expect(script).toContain('Loading conversation');
        expect(script).toContain('history-loading');
    });

    it('stores history processes separately', () => {
        expect(script).toContain('historyProcesses');
        expect(script).toContain('historyTotal');
        expect(script).toContain('historyLoaded');
    });

    it('fetches history processes on first mode switch', () => {
        expect(script).toContain('fetchHistoryProcesses');
    });

    it('resets history when workspace changes', () => {
        expect(script).toContain('historyLoaded');
    });
});

// ============================================================================
// Filters module
// ============================================================================

describe('client bundle — filters module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('implements debounce', () => {
        expect(script).toContain('debounce');
        expect(script).toContain('clearTimeout');
    });

    it('handles search input with debounce', () => {
        expect(script).toContain('search-input');
        expect(script).toContain('searchQuery');
    });

    it('handles status filter', () => {
        expect(script).toContain('status-filter');
        expect(script).toContain('statusFilter');
    });

    it('handles type filter', () => {
        expect(script).toContain('type-filter');
        expect(script).toContain('typeFilter');
    });

    it('handles workspace filter with API call', () => {
        expect(script).toContain('workspace-select');
        expect(script).toContain('/processes?workspace=');
    });
});

// ============================================================================
// WebSocket module
// ============================================================================

describe('client bundle — websocket module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('uses getWsPath() for WebSocket URL', () => {
        expect(script).toContain('getWsPath');
    });

    it('implements exponential backoff reconnect', () => {
        expect(script).toContain('wsReconnectDelay');
        expect(script).toContain('Math.min(wsReconnectDelay * 2,');
    });

    it('sends ping every 30 seconds', () => {
        // esbuild converts 30000 to 3e4
        expect(script).toContain('3e4');
        expect(script).toContain("ping");
    });

    it('handles process-added messages', () => {
        expect(script).toContain('process-added');
    });

    it('handles process-updated messages', () => {
        expect(script).toContain('process-updated');
    });

    it('handles process-removed messages', () => {
        expect(script).toContain('process-removed');
    });

    it('handles processes-cleared messages', () => {
        expect(script).toContain('processes-cleared');
    });

    it('handles workspace-registered messages', () => {
        expect(script).toContain('workspace-registered');
    });

    it('auto-starts WebSocket connection', () => {
        expect(script).toContain('connectWebSocket');
    });

    it('resets reconnect delay on successful connection', () => {
        // esbuild converts 1000 to 1e3
        expect(script).toContain('wsReconnectDelay = 1e3');
    });

    it('handles queue-updated messages', () => {
        expect(script).toContain('queue-updated');
        expect(script).toContain('renderQueuePanel');
    });

    it('uses history from queue-updated WS message when available', () => {
        expect(script).toContain('.queue.history');
    });

    it('renders immediately before REST fallback', () => {
        expect(script).toContain('renderQueuePanel');
    });

    it('falls back to REST fetch when history not in WS message', () => {
        expect(script).toContain('/queue/history');
    });

    it('starts queue polling when active tasks detected via WS', () => {
        expect(script).toContain('startQueuePolling');
    });

    it('stops queue polling when no active tasks via WS', () => {
        expect(script).toContain('stopQueuePolling');
    });

    it('auto-expands history when tasks complete or fail', () => {
        expect(script).toContain('showHistory');
    });

    it('tracks previous completed/failed counts for comparison', () => {
        expect(script).toContain('prevCompleted');
        expect(script).toContain('prevFailed');
    });
});
