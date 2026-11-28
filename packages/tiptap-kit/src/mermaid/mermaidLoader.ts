/**
 * Lazy loader for the mermaid.js browser runtime. Mermaid is fetched once from
 * the CDN as a global script, so hosts need no npm dependency on it.
 */

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';

export interface MermaidRuntime {
    initialize(config: Record<string, unknown>): void;
    run(opts: { nodes: NodeListOf<Element> | Element[] }): Promise<void>;
}

export function getMermaidRuntime(): MermaidRuntime | undefined {
    return (globalThis as typeof globalThis & { mermaid?: MermaidRuntime }).mermaid;
}

/** `data-theme` on `<html>` wins; otherwise follow the OS color scheme. */
function isDarkTheme(): boolean {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function initializeRuntime(runtime: MermaidRuntime): void {
    runtime.initialize({
        startOnLoad: false,
        theme: isDarkTheme() ? 'dark' : 'default',
        securityLevel: 'loose',
        flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
        fontSize: 14,
    });
}

/** Re-initialize a loaded runtime with the current light/dark theme. No-op before load. */
export function applyMermaidTheme(): void {
    const runtime = getMermaidRuntime();
    if (runtime) initializeRuntime(runtime);
}

let mermaidLoadPromise: Promise<void> | null = null;

/** Load and initialize mermaid once. A failed load can be retried. */
export function ensureMermaid(): Promise<void> {
    const existing = getMermaidRuntime();
    if (existing?.initialize) {
        return Promise.resolve();
    }
    if (mermaidLoadPromise) return mermaidLoadPromise;

    mermaidLoadPromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = MERMAID_CDN;
        script.async = true;
        script.onload = () => {
            const loaded = getMermaidRuntime();
            if (!loaded) {
                mermaidLoadPromise = null;
                reject(new Error('Mermaid runtime did not initialize'));
                return;
            }
            initializeRuntime(loaded);
            resolve();
        };
        script.onerror = () => {
            mermaidLoadPromise = null;
            reject(new Error('Failed to load mermaid.js from CDN'));
        };
        document.head.appendChild(script);
    });
    return mermaidLoadPromise;
}
