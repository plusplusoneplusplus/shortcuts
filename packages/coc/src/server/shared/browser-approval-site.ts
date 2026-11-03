import { parse as parseDomain } from 'tldts';

/**
 * The approval key for an agent-driven top-level navigation: the root domain
 * (eTLD+1, private suffixes such as `github.io` included) or, for IP and
 * single-label hosts, the exact host. Returns `null` for navigations that never
 * need approval: non-HTTP(S) URLs (`about:blank`, `data:`), `localhost`
 * (and `*.localhost`), loopback IPs, and unparsable input.
 */
export function browserApprovalSite(url: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost') || isLoopbackIp(host)) return null;
    const info = parseDomain(host, { allowPrivateDomains: true });
    if (info.isIp) return host;
    return info.domain ?? host;
}

function isLoopbackIp(host: string): boolean {
    if (/^127(\.\d{1,3}){3}$/.test(host)) return true;
    if (host === '::1') return true;
    // WHATWG URL serializes IPv4-mapped loopback as ::ffff:7fxx:xxxx.
    return /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host);
}

/** Validate manual trust entries without changing navigation approval scope. */
export function validateBrowserApprovalUrl(value: unknown): { site: string; error?: never } | { site?: never; error: string } {
    const invalid = { error: 'Enter a valid http:// or https:// URL without credentials or wildcards.' };
    if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value) || /[\s\\]/.test(value.trim())) return invalid;
    const text = value.trim();
    if (!/^https?:\/\/[^/]/i.test(text)) return invalid;
    let url: URL;
    try { url = new URL(text); } catch { return invalid; }
    if (!url.hostname || url.username || url.password || text.split(/[/?#]/)[2]?.includes('@') || url.host.includes('*') || url.href.length > 8192) return invalid;
    const host = url.hostname.replace(/\.$/, '');
    if (host.length > 253) return invalid;
    if (!host.startsWith('[') && !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return invalid;
    const info = parseDomain(host, { allowPrivateDomains: true });
    if ((info.isIcann || info.isPrivate) && !info.domain) return { error: 'Enter a site, not a public suffix.' };
    const site = browserApprovalSite(text);
    return site ? { site } : { error: 'This local URL does not require site approval.' };
}
