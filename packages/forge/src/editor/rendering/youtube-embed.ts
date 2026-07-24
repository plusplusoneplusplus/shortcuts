/**
 * YouTube URL detection helpers for note rendering.
 *
 * These are pure string-in helpers (no DOM / editor host) that recognize the
 * common YouTube link shapes and extract the 11-character video id. The Notes
 * decoration layer uses them to decide which link marks get view-only play
 * buttons, and to build a privacy-mode `youtube-nocookie.com` embed URL.
 *
 * Deliberately YouTube-specific — other providers are out of scope.
 */

/** Canonical YouTube video ids are exactly 11 URL-safe base64 characters. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** True for `youtube.com`, `youtube-nocookie.com`, and their subdomains (www/m/music). */
function isYouTubeHost(hostname: string): boolean {
    return (
        hostname === 'youtube.com'
        || hostname === 'youtube-nocookie.com'
        || hostname.endsWith('.youtube.com')
        || hostname.endsWith('.youtube-nocookie.com')
    );
}

/** True for `youtu.be` and its subdomains. */
function isYoutuBeHost(hostname: string): boolean {
    return hostname === 'youtu.be' || hostname.endsWith('.youtu.be');
}

/**
 * Extract the YouTube video id from `url`, or return `null` when the URL is not
 * a recognized YouTube link.
 *
 * Recognizes (with or without extra query params such as `t=` / `list=`):
 * - `youtube.com/watch?v=<id>`
 * - `youtu.be/<id>`
 * - `youtube.com/shorts/<id>`
 * - `youtube.com/embed/<id>` (and the `youtube-nocookie.com` equivalent)
 *
 * Returns `null` for non-YouTube hosts, malformed URLs, and ids that are not the
 * canonical 11-character shape.
 */
export function parseYouTubeVideoId(url: string | null | undefined): string | null {
    if (!url) return null;
    const trimmed = url.trim();
    if (!trimmed) return null;

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return null;
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return null;
    }

    const hostname = parsed.hostname.toLowerCase();
    const segments = parsed.pathname.split('/').filter(Boolean);

    // youtu.be/<id>
    if (isYoutuBeHost(hostname)) {
        const id = segments[0];
        return id && VIDEO_ID_PATTERN.test(id) ? id : null;
    }

    if (isYouTubeHost(hostname)) {
        // youtube.com/watch?v=<id>
        if (segments[0] === 'watch') {
            const v = parsed.searchParams.get('v');
            return v && VIDEO_ID_PATTERN.test(v) ? v : null;
        }

        // youtube.com/shorts/<id> and youtube.com/embed/<id>
        if ((segments[0] === 'shorts' || segments[0] === 'embed') && segments[1]) {
            return VIDEO_ID_PATTERN.test(segments[1]) ? segments[1] : null;
        }

        return null;
    }

    return null;
}

/** True when `url` is a recognized YouTube link (see {@link parseYouTubeVideoId}). */
export function isYouTubeUrl(url: string | null | undefined): boolean {
    return parseYouTubeVideoId(url) !== null;
}

/**
 * Build the privacy-mode embed URL for a YouTube video id.
 *
 * Always uses `youtube-nocookie.com`. Pass `{ autoplay: true }` for the popup
 * player; the inline player omits autoplay.
 */
export function youTubeEmbedUrl(
    videoId: string,
    options: { autoplay?: boolean } = {},
): string {
    const base = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`;
    return options.autoplay ? `${base}?autoplay=1` : base;
}
