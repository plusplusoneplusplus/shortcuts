/**
 * Sidebar script: cache utilities, live timers, and process selection.
 *
 * The process list rendering has been merged into the unified queue panel
 * (see queue.ts renderQueuePanel). This module retains cache, timer, and
 * selection helpers that are still used by other modules.
 */

import { appState } from './state';
import {
    formatDuration,
} from './utils';
import { renderDetail } from './detail';

/** Maximum conversation cache entries. */
const MAX_CACHE_ENTRIES = 50;
/** Cache TTL: 1 hour. */
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Backward-compatible stub: delegates to renderQueuePanel().
 * Kept so that any remaining callers (filters, etc.) still work.
 */
export function renderProcessList(): void {
    // Import lazily to avoid circular dependency at module init time
    import('./queue').then(function(mod) {
        mod.renderQueuePanel();
    });
}

/**
 * Cache conversation turns for a historical process.
 * Enforces max entries and TTL.
 */
export function cacheConversation(processId: string, turns: any[]): void {
    // Evict expired entries
    const now = Date.now();
    const keys = Object.keys(appState.conversationCache);
    for (let i = 0; i < keys.length; i++) {
        if (now - appState.conversationCache[keys[i]].cachedAt > CACHE_TTL_MS) {
            delete appState.conversationCache[keys[i]];
        }
    }

    // Evict oldest if over limit
    const cacheKeys = Object.keys(appState.conversationCache);
    if (cacheKeys.length >= MAX_CACHE_ENTRIES) {
        let oldestKey = cacheKeys[0];
        let oldestTime = appState.conversationCache[oldestKey].cachedAt;
        for (let i = 1; i < cacheKeys.length; i++) {
            if (appState.conversationCache[cacheKeys[i]].cachedAt < oldestTime) {
                oldestKey = cacheKeys[i];
                oldestTime = appState.conversationCache[cacheKeys[i]].cachedAt;
            }
        }
        delete appState.conversationCache[oldestKey];
    }

    appState.conversationCache[processId] = { turns: turns, cachedAt: now };
}

/** Invalidate (remove) cached conversation for a process. */
export function invalidateConversationCache(processId: string): void {
    delete appState.conversationCache[processId];
}

/** Get cached conversation turns, or null if not cached or expired. */
export function getCachedConversation(processId: string): any[] | null {
    const entry = appState.conversationCache[processId];
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        delete appState.conversationCache[processId];
        return null;
    }
    return entry.turns;
}

export function startLiveTimers(): void {
    appState.processes.forEach(function(p: any) {
        if (p.status === 'running' && p.startTime) {
            appState.liveTimers[p.id] = setInterval(function() {
                const el = document.querySelector('[data-timer-id="' + p.id + '"]');
                if (el) {
                    el.textContent = formatDuration(Date.now() - new Date(p.startTime).getTime());
                }
            }, 1000);
        }
    });
}

export function stopLiveTimers(): void {
    Object.keys(appState.liveTimers).forEach(function(id) {
        clearInterval(appState.liveTimers[id]);
    });
    appState.liveTimers = {};
}

export function selectProcess(id: string): void {
    appState.selectedId = id;
    updateActiveItem();
    renderDetail(id);
}

export function updateActiveItem(): void {
    const items = document.querySelectorAll('.process-item');
    items.forEach(function(el) {
        if (el.getAttribute('data-id') === appState.selectedId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
}

// Hamburger toggle for mobile
const hamburgerBtn = document.getElementById('hamburger-btn');
if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', function() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.toggle('open');
    });
}

