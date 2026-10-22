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
