/**
 * Layer B — asset extraction + inlining for the canvas → self-contained HTML
 * export pipeline.
 *
 * Two functions, split so the pure part and the I/O part test independently:
 *   - `collectImageRefs(html)` — pure, no DOM/fetch. Scans rendered body HTML
 *     for the local image references the exported file must inline: same-origin
 *     proxy URLs (`/api/workspaces/:id/files/image?path=…`), `data-local-path`
 *     values (present when markdown is rendered without a workspace id), and
 *     relative `.attachments/…` / other local `src` paths. Remote `http(s)`
 *     images and already-inlined `data:` URIs are left as-is (documented v1
 *     limitation for remote images). The returned refs are de-duped and use the
 *     exact string Layer A will look up in its assets map.
 *   - `resolveAssets(refs, fetchFn)` — fetches each ref via the injected
 *     `fetchFn`, converts the response to a base64 `data:` URI (mime from the
 *     response content-type, then the ref's extension, then the blob type), and
 *     returns a `Map<ref, dataUri>` plus warnings. A ref that fails to fetch is
 *     omitted from the map and recorded as a warning — never thrown — so the
 *     pure serializer (Layer A) substitutes the self-contained broken-image
 *     placeholder for it downstream. Layer B therefore stays free of the DOM
 *     placeholder and never aborts an export.
 *
 * The injected `fetchFn` keeps this layer decoupled from how a ref maps to a
 * fetchable URL (the orchestrator, Layer E, owns that), which is what makes the
 * fetch path unit-testable with a plain mock.
 */

/** Minimal response shape consumed by `resolveAssets` — the DOM `Response` satisfies it. */
export interface AssetFetchResponse {
    /** Whether the fetch succeeded (HTTP 2xx). */
    ok: boolean;
    /** Response headers; only `get('content-type')` is read. Optional for mocks. */
    headers?: { get(name: string): string | null } | null;
    /** The response body as a Blob. */
    blob(): Promise<Blob>;
}

/** Fetches a single collected image reference. Injected so refs → URLs stay in Layer E. */
export type AssetFetchFn = (ref: string) => Promise<AssetFetchResponse>;

/** Result of resolving a set of image references to inline data URIs. */
export interface ResolveAssetsResult {
    /** Map from the exact ref string → its base64 `data:` URI. Failed refs are absent. */
    assets: Map<string, string>;
    /** Non-fatal issues (a ref that could not be fetched/inlined). */
    warnings: string[];
}

const ATTR_RE = (name: string) =>
    new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');

/** Read a double- or single-quoted attribute value from a single tag string. */
function readAttr(tag: string, name: string): string {
    const m = tag.match(ATTR_RE(name));
    if (!m) return '';
    return m[2] ?? m[3] ?? '';
}

/**
 * A `src` that is already inline (`data:`/`blob:`) or remote (absolute `http(s)`
 * or protocol-relative `//host`). Such images are not fetched/inlined in v1 —
 * inline ones are already self-contained; remote ones are left external.
 */
function isRemoteOrInlined(src: string): boolean {
    return /^(data:|blob:)/i.test(src) || /^(https?:)?\/\//i.test(src);
}

/**
 * Collect the local image references that need inlining from rendered body HTML.
 * De-duped; each ref is the exact string Layer A resolves against its asset map
 * (the `src` when it is a local URL/path, else the `data-local-path` value).
 * Remote and already-inlined images contribute no refs.
 */
export function collectImageRefs(html: string): string[] {
    if (!html) return [];
    const refs: string[] = [];
    const seen = new Set<string>();
    const add = (ref: string) => {
        if (ref && !seen.has(ref)) {
            seen.add(ref);
            refs.push(ref);
        }
    };

    const imgRe = /<img\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(html)) !== null) {
        const tag = m[0];
        const src = readAttr(tag, 'src');
        const localPath = readAttr(tag, 'data-local-path');
        if (src && !isRemoteOrInlined(src)) {
            // Local src (proxy URL, relative `.attachments/…`, or absolute path).
            // Layer A prefers `src`, so this is the key it will look up.
            add(src);
        } else if (!src && localPath) {
            // No src yet (markdown rendered without a workspace id): Layer A falls
            // back to `data-local-path`, so that value is the lookup key.
            add(localPath);
        }
        // Otherwise: remote/inlined src → nothing local to inline.
    }
    return refs;
}

/** Image extension → mime, used when the response omits a usable content-type. */
const EXTENSION_MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    avif: 'image/avif',
    tif: 'image/tiff',
    tiff: 'image/tiff',
};

/** Normalize a raw content-type (`image/png; charset=…`) to a bare, valid mime. */
function cleanMime(raw: string | null | undefined): string {
    if (!raw) return '';
    const mime = raw.split(';')[0].trim().toLowerCase();
    return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(mime) ? mime : '';
}

/**
 * Infer a mime from a ref's file extension. Handles both a plain path
 * (`.attachments/x.png`) and a proxy URL whose extension lives in its
 * `path=<encoded>` query segment.
 */
function mimeFromRef(ref: string): string {
    const fromExt = (value: string): string => {
        const clean = value.split(/[?#]/)[0];
        const m = clean.match(/\.([a-z0-9]+)$/i);
        return m ? EXTENSION_MIME[m[1].toLowerCase()] ?? '' : '';
    };
    const direct = fromExt(ref);
    if (direct) return direct;
    const q = ref.match(/[?&]path=([^&]+)/i);
    if (q) {
        let decoded = q[1];
        try {
            decoded = decodeURIComponent(q[1]);
        } catch {
            /* keep raw on malformed encoding */
        }
        return fromExt(decoded);
    }
    return '';
}

/** Read a Blob as a base64 payload (data-URL prefix stripped). Browser + jsdom safe. */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result ?? '');
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : '');
        };
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.readAsDataURL(blob);
    });
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

interface ResolvedOne {
    ref: string;
    dataUri?: string;
    warning?: string;
}

async function resolveOne(ref: string, fetchFn: AssetFetchFn): Promise<ResolvedOne> {
    // Defensive: an already-inlined ref (should not reach here — collectImageRefs
    // filters them) inlines to itself without a network round-trip.
    if (/^data:/i.test(ref)) return { ref, dataUri: ref };
    try {
        const resp = await fetchFn(ref);
        if (!resp || !resp.ok) {
            return { ref, warning: `Failed to fetch image "${ref}" (response not ok) — left unresolved.` };
        }
        const blob = await resp.blob();
        const base64 = await blobToBase64(blob);
        if (!base64) {
            return { ref, warning: `Failed to inline image "${ref}" (empty response) — left unresolved.` };
        }
        const mime =
            cleanMime(resp.headers?.get?.('content-type')) ||
            mimeFromRef(ref) ||
            cleanMime(blob.type) ||
            'application/octet-stream';
        return { ref, dataUri: `data:${mime};base64,${base64}` };
    } catch (err) {
        return { ref, warning: `Failed to fetch image "${ref}" (${errorMessage(err)}) — left unresolved.` };
    }
}

/**
 * Resolve a set of image references to inline `data:` URIs using the injected
 * `fetchFn`. Refs are de-duped so each is fetched at most once, and the results
 * preserve input order so the warnings list is deterministic. Never throws:
 * a ref that cannot be fetched/inlined is omitted from the map and recorded as
 * a warning, letting the export complete with a placeholder for that image.
 */
export async function resolveAssets(
    refs: string[],
    fetchFn: AssetFetchFn,
): Promise<ResolveAssetsResult> {
    const assets = new Map<string, string>();
    const warnings: string[] = [];
    const unique = Array.from(new Set(refs)).filter((ref) => ref.length > 0);

    const results = await Promise.all(unique.map((ref) => resolveOne(ref, fetchFn)));
    for (const r of results) {
        if (r.dataUri) assets.set(r.ref, r.dataUri);
        if (r.warning) warnings.push(r.warning);
    }
    return { assets, warnings };
}
