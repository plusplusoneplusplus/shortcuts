import type { BrowserNavigationAnswer, BrowserNavigationPrompt } from '@plusplusoneplusplus/coc-client';

/** A held agent navigation waiting for the user's answer in its conversation's chat. */
export interface BrowserNavigationPromptEntry extends BrowserNavigationPrompt {
    /** Unique across server connections (a clone's ids may match local ones). */
    key: string;
    /** Owning clone server; absent for the page-origin server. */
    sourceBaseUrl?: string;
    answer: (answer: BrowserNavigationAnswer) => void;
}

const prompts = new Map<string, BrowserNavigationPromptEntry>();
/** Conversations whose chat is on screen, keyed `[sourceBaseUrl, workspaceId, processId]`, with mount counts. */
const hosts = new Map<string, number>();
const listeners = new Set<() => void>();
let snapshot: BrowserNavigationPromptEntry[] = [];
const publish = () => {
    snapshot = [...prompts.values()];
    listeners.forEach(listener => listener());
};
const hostKey = (sourceBaseUrl: string | undefined, workspaceId: string, processId: string) =>
    JSON.stringify([sourceBaseUrl ?? '', workspaceId, processId]);

export function setBrowserNavigationPrompt(prompt: BrowserNavigationPromptEntry): void {
    prompts.set(prompt.key, prompt);
    publish();
}

export function clearBrowserNavigationPrompt(key: string): void {
    if (prompts.delete(key)) publish();
}

export function getBrowserNavigationPrompts(): BrowserNavigationPromptEntry[] {
    return snapshot;
}

export function subscribeBrowserNavigationPrompts(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Marks a conversation's chat as showing its prompts inline; the floating list skips them. */
export function hostBrowserNavigationPrompts(sourceBaseUrl: string | undefined, workspaceId: string, processId: string): () => void {
    const key = hostKey(sourceBaseUrl, workspaceId, processId);
    hosts.set(key, (hosts.get(key) ?? 0) + 1);
    publish();
    return () => {
        const count = (hosts.get(key) ?? 1) - 1;
        if (count > 0) hosts.set(key, count); else hosts.delete(key);
        publish();
    };
}

export function isBrowserNavigationPromptHosted(prompt: Pick<BrowserNavigationPromptEntry, 'sourceBaseUrl' | 'workspaceId' | 'processId'>): boolean {
    return hosts.has(hostKey(prompt.sourceBaseUrl, prompt.workspaceId, prompt.processId));
}
