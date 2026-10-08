/** Validated cookies passed only through desktop IPC, never workspace APIs. */
export interface BrowserImportCookie {
    url: string;
    name: string;
    value: string;
    domain?: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: 'lax' | 'strict' | 'no_restriction';
    expirationDate?: number;
}

export function parseBrowserCookies(domain: unknown, input: unknown): BrowserImportCookie[] {
    if (typeof domain !== 'string' || !domain.trim() || domain.length > 253
        || /[\s/:@?#\\]/.test(domain)) throw new Error('Enter a domain without a scheme, port or path.');
    const host = domain.trim().replace(/^\./, '').toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(host)) {
        throw new Error('Enter a valid domain.');
    }
    const url = `https://${host}/`;
    if (new URL(url).hostname !== host) throw new Error('Enter a valid domain.');
    if (typeof input !== 'string' || !input.trim() || input.length > 65_536) {
        throw new Error('Paste cookies as JSON or name=value pairs (up to 64 KB).');
    }
    let items: unknown;
    if (/^[\[{]/.test(input.trim())) {
        try { items = JSON.parse(input); } catch { throw new Error('Cookie JSON is invalid.'); }
    } else {
        items = input.trim().replace(/^Cookie:\s*/i, '').split(';').map(pair => {
            const index = pair.indexOf('=');
            if (index < 1) throw new Error('Use name=value pairs separated by semicolons.');
            return { name: pair.slice(0, index).trim(), value: pair.slice(index + 1).trim() };
        });
    }
    if (!Array.isArray(items) || !items.length || items.length > 200) throw new Error('Use a JSON array or cookie pairs, with 1 to 200 cookies.');
    return items.map((item, index) => {
        const invalid = () => new Error(`Cookie ${index + 1} has invalid fields or a domain outside the target domain.`);
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalid();
        const c = item as Record<string, unknown>;
        if (typeof c.name !== 'string' || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(c.name)
            || typeof c.value !== 'string' || /[^\x21-\x7e]|[";,\\]/.test(c.value)
            || c.name.length + c.value.length > 4096) throw invalid();
        for (const field of ['secure', 'httpOnly', 'hostOnly', 'session']) {
            if (c[field] !== undefined && typeof c[field] !== 'boolean') throw invalid();
        }
        if (c.partitionKey !== undefined || c.partitioned === true) throw new Error(`Cookie ${index + 1} is partitioned; this import supports unpartitioned cookies.`);
        let cookieDomain: string | undefined;
        if (c.domain !== undefined) {
            if (typeof c.domain !== 'string') throw invalid();
            const bare = c.domain.replace(/^\./, '').toLowerCase();
            if (bare !== host && !host.endsWith(`.${bare}`)) throw invalid();
            if (c.hostOnly === true && bare !== host) throw invalid();
            cookieDomain = c.hostOnly === true ? undefined : c.domain.toLowerCase();
        }
        const path = c.path ?? '/';
        if (typeof path !== 'string' || !path.startsWith('/') || /[\x00-\x1f\x7f;]/.test(path)) throw invalid();
        const secure = c.secure ?? true;
        const exportedSameSite = typeof c.sameSite === 'string' ? c.sameSite.toLowerCase() : c.sameSite;
        const sameSite = exportedSameSite === 'unspecified' || exportedSameSite === undefined ? 'lax'
            : exportedSameSite === 'none' ? 'no_restriction' : exportedSameSite;
        if (!['lax', 'strict', 'no_restriction'].includes(sameSite as string)
            || (sameSite === 'no_restriction' && !secure)) throw invalid();
        const exportedExpiry = c.expirationDate ?? c.expires;
        const expiry = c.session === true || exportedExpiry === -1 ? undefined : exportedExpiry;
        if (expiry !== undefined && (typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry <= Date.now() / 1000)) throw new Error(`Cookie ${index + 1} has an invalid or expired expiry time.`);
        if ((c.name.startsWith('__Secure-') && !secure)
            || (c.name.startsWith('__Host-') && (!secure || cookieDomain !== undefined || path !== '/'))) throw invalid();
        return { url, name: c.name, value: c.value, ...(cookieDomain ? { domain: cookieDomain } : {}), path,
            secure: secure as boolean, httpOnly: (c.httpOnly ?? false) as boolean,
            sameSite: sameSite as BrowserImportCookie['sameSite'],
            ...(expiry !== undefined ? { expirationDate: expiry as number } : {}) };
    });
}
