/**
 * QueueView — structural no-op kept for backward compatibility.
 * Queue state is hydrated by App.tsx bootstrap (SEED_QUEUE) and
 * the WebSocket `queue-updated` handler — no per-component fetch needed.
 */

export function QueueView() {
    return null;
}
