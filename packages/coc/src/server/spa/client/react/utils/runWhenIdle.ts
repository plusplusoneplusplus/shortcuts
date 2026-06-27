/**
 * Run `callback` once the browser is idle — i.e. after the current critical
 * render/paint work has settled — so a non-critical fetch does not compete with
 * the message-render path (chat-load-perf AC-03). Uses `requestIdleCallback`
 * where available and falls back to a macrotask `setTimeout` (Safari, jsdom).
 * The `timeout` bound guarantees the work still runs promptly on a busy page,
 * so deferred data still loads automatically rather than waiting for true idle.
 *
 * Returns a disposer that cancels the pending callback if it has not run yet —
 * call it from an effect cleanup so a deferred fetch never fires after an
 * unmount or a dependency change.
 */
export function runWhenIdle(callback: () => void, timeoutMs = 200): () => void {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        const handle = window.requestIdleCallback(() => callback(), { timeout: timeoutMs });
        return () => {
            if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
        };
    }
    const handle = setTimeout(callback, 0);
    return () => clearTimeout(handle);
}
