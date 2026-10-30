import { validateBrowserUrl } from './browser-view-policy';

function httpUrl(value: unknown): URL | undefined {
    const checked = validateBrowserUrl(value);
    if (!checked.ok) return undefined;
    const url = new URL(checked.url);
    return url.username || url.password ? undefined : url;
}

/** Canvas runtimes serve HTTP on IPv4 loopback, never on a remote host. */
export function extensionCanvasUrl(value: unknown): string | undefined {
    const url = httpUrl(value);
    return url?.protocol === 'http:' && url.hostname === '127.0.0.1' ? url.href : undefined;
}

export function classifyExtensionCanvasNavigation(
    target: unknown, instanceUrl: string,
): 'allow' | 'external' | 'deny' {
    const initial = extensionCanvasUrl(instanceUrl);
    const url = httpUrl(target);
    if (!initial || !url) return 'deny';
    return url.origin === new URL(initial).origin ? 'allow' : 'external';
}
