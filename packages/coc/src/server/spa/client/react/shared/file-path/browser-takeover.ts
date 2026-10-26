import type { BrowserTakeoverState } from '@plusplusoneplusplus/coc-client';
const states = new Map<string, BrowserTakeoverState>();
const listeners = new Set<() => void>();
const key = (ref: string, processId: string) => JSON.stringify([ref, processId]);
export function setBrowserTakeover(state: BrowserTakeoverState): void {
    states.set(key(state.routingRef, state.processId), state);
    for (const listener of listeners) listener();
}
export function clearBrowserTakeover(ref: string, processId: string): void {
    if (states.delete(key(ref, processId))) for (const listener of listeners) listener();
}
export function getBrowserTakeover(ref: string, viewId: string): BrowserTakeoverState | null {
    return [...states.values()].reverse().find(state => state.routingRef === ref && state.viewIds?.includes(viewId)) ?? null;
}
export function subscribeBrowserTakeover(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
