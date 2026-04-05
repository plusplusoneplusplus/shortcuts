/**
 * QueueView — structural no-op kept for backward compatibility.
 * Queue state is hydrated by the WebSocket `handleConnect` callback (on initial
 * connect and every reconnect) which dispatches QUEUE_UPDATED.
 */

export function QueueView() {
    return null;
}
