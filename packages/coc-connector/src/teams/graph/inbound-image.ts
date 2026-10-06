import { Readable } from 'node:stream';
import { downloadInboundImage, ImageDownloadError, type InboundImage } from '../../core/inbound-image';
import type { GraphCredentialStore } from './graph-credential';

const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const HTML_ENTITIES: Record<string, string> = {
    '&amp;': '&', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&lt;': '<', '&gt;': '>',
};

export function decodeGraphHtmlEntities(value: string): string {
    return value.replace(/&(?:amp|quot|apos|nbsp|lt|gt|#(\d+)|#x([0-9a-f]+));/gi, (entity, decimal, hex) => {
        if (decimal || hex) {
            const code = parseInt(decimal ?? hex, decimal ? 10 : 16);
            return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
        }
        return HTML_ENTITIES[entity.toLowerCase()];
    });
}

function attribute(tag: string, name: string): string | undefined {
    const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return match ? decodeGraphHtmlEntities(match[1] ?? match[2] ?? match[3]) : undefined;
}

/** Use only IDs from the current message's hosted-content path, never fetch the supplied URL. */
function hostedContentId(source: string | undefined, messagePath: string): string | undefined {
    if (!source || source.length > 8192) return;
    try {
        const url = new URL(source, `${GRAPH_ORIGIN}/v1.0${messagePath}/body/`);
        if (url.origin !== GRAPH_ORIGIN || url.username || url.password || url.search || url.hash) return;
        const parts = url.pathname.split('/').map(decodeURIComponent);
        const expected = `${messagePath}/hostedContents`.split('/').map(decodeURIComponent);
        if (!['v1.0', 'beta'].includes(parts[1]) || parts.at(-1) !== '$value'
            || parts.length !== expected.length + 3
            || expected.slice(1).some((part, index) => parts[index + 2] !== part)) return;
        const id = parts.at(-2)!;
        if (id && id !== '.' && id !== '..' && id.length <= 4096) return id;
    } catch { /* Malformed paths are unsupported media, not read/admission failures. */ }
}

/** Encode a native SharePoint file reference; never request the user-supplied URL. */
function fileContentUrl(source: string | null | undefined): string | undefined {
    if (!source || source.length > 8192) return;
    try {
        const url = new URL(source);
        if (url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.sharepoint\.com$/i.test(url.hostname)
            || url.port || url.username || url.password || url.hash) return;
        const shareId = 'u!' + Buffer.from(url.href).toString('base64url');
        // contentStream stays on Graph; /content redirects to a preauthenticated URL.
        return `${GRAPH_ORIGIN}/beta/shares/${shareId}/driveItem/contentStream`;
    } catch { /* Invalid references remain explicit failing image descriptors. */ }
}

const IMAGE_FILE_EXTENSION = /\.(?:png|jpe?g|jpe|jfif|gif|webp|svg|bmp|ico|avif|heic|heif|tiff?)$/i;

function isImageReference(name: string | null | undefined, source: string | null | undefined): boolean {
    if (name?.trim()) return IMAGE_FILE_EXTENSION.test(name.trim());
    try { return !!source && IMAGE_FILE_EXTENSION.test(decodeURIComponent(new URL(source).pathname)); }
    catch { return false; }
}

/** Both hosted and file images resolve MIME from the authenticated binary response. */
function graphImage(url: string | undefined, credentials: GraphCredentialStore, lifetime: AbortSignal): InboundImage {
    let mimeType = '';
    return {
        get mimeType() { return mimeType; },
        download: options => {
            if (!url) return Promise.reject(new ImageDownloadError('unsupported'));
            return downloadInboundImage(() => mimeType, async signal => {
                const request = async (refresh = false) => {
                    const token = await credentials.get(signal, refresh);
                    signal.throwIfAborted();
                    return fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` },
                        redirect: 'error', signal });
                };
                let response = await request();
                if (response.status === 401 && !signal.aborted) {
                    await response.body?.cancel();
                    response = await request(true);
                }
                if (signal.aborted || response.status !== 200 || !response.body) {
                    await response.body?.cancel();
                    signal.throwIfAborted();
                    throw new ImageDownloadError(response.status === 403 ? 'access-denied' : 'download');
                }
                if (Number(response.headers.get('content-length')) > options.maxBytes) {
                    await response.body.cancel();
                    throw new ImageDownloadError('size-limit');
                }
                mimeType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
                return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
            }, options, lifetime);
        },
    };
}

export function graphChannelImages(
    html: string,
    context: { teamId: string; channelId: string; messageId: string; rootId?: string },
    credentials: GraphCredentialStore,
    lifetime: AbortSignal,
    attachments?: unknown,
): InboundImage[] {
    const path = `/teams/${encodeURIComponent(context.teamId)}/channels/${encodeURIComponent(context.channelId)}`
        + `/messages/${encodeURIComponent(context.rootId ?? context.messageId)}`
        + (context.rootId ? `/replies/${encodeURIComponent(context.messageId)}` : '');
    const images: InboundImage[] = [];
    const seen = new Set<string>();
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
        const tag = match[0];
        // Teams emoji are text decoration, not user image attachments.
        if (attribute(tag, 'itemtype') === 'http://schema.skype.com/Emoji') continue;
        const id = hostedContentId(attribute(tag, 'src'), path);
        const url = id ? `${GRAPH_ORIGIN}/v1.0${path}/hostedContents/${encodeURIComponent(id)}/$value` : undefined;
        if (url && seen.has(url)) continue;
        if (url) seen.add(url);
        images.push(graphImage(url, credentials, lifetime));
    }
    if (attachments == null) return images;
    if (!Array.isArray(attachments)) return [...images, graphImage(undefined, credentials, lifetime)];
    for (const attachment of attachments) {
        if (!attachment || typeof attachment.contentType !== 'string'
            || (attachment.name != null && typeof attachment.name !== 'string')
            || (attachment.contentUrl != null && typeof attachment.contentUrl !== 'string')) {
            images.push(graphImage(undefined, credentials, lifetime));
            continue;
        }
        const type = attachment.contentType.toLowerCase();
        if (!type.startsWith('image/') && !(type === 'reference'
            && isImageReference(attachment.name, attachment.contentUrl))) continue;
        const id = hostedContentId(attachment.contentUrl, path);
        const url = id ? `${GRAPH_ORIGIN}/v1.0${path}/hostedContents/${encodeURIComponent(id)}/$value`
            : fileContentUrl(attachment.contentUrl);
        if (url && seen.has(url)) continue;
        if (url) seen.add(url);
        images.push(graphImage(url, credentials, lifetime));
    }
    return images;
}
