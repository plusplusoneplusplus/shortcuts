import { Marked } from 'marked';
import { mathMarkedExtension } from '../../../../shared/math/mathMarkedExtension';
import { linkifyFilePaths } from '../../../shared/file-path-utils';
import { toForwardSlashes } from '@plusplusoneplusplus/forge/utils/path-utils';
import { renderMermaidContainer, type CodeBlock } from '@plusplusoneplusplus/forge/editor/parsing';
import { DEFAULT_HTML_EMBED_HEIGHT, isEmbeddableHtmlPath } from '@plusplusoneplusplus/forge/editor/rendering';

function escapeAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Parse an `excalidraw://workspaceId/filename` URL.
 * Returns null if the URL doesn't match the expected format.
 */
export function parseExcalidrawLink(url: string): { workspaceId: string; diagramPath: string } | null {
    const match = url.match(/^excalidraw:\/\/([^/]+)\/(.+)$/i);
    if (!match) {
        return null;
    }
    const workspaceId = decodeURIComponent(match[1]);
    const diagramPath = decodeURIComponent(match[2]);
    if (!workspaceId || !diagramPath) {
        return null;
    }
    return { workspaceId, diagramPath };
}

/**
 * Parse a `canvas://<canvasId>` reference marker.
 *
 * The canvas type is resolved from its persisted descriptor before rendering,
 * so the same marker supports diagram, extension, markdown, and code canvases.
 * Returns null if the marker doesn't match a valid canvas id.
 */
export function parseCanvasEmbedLink(url: string): { canvasId: string } | null {
    const match = url.match(/^canvas:\/\/([a-z0-9][a-z0-9-]{0,127})$/i);
    if (!match) {
        return null;
    }
    return { canvasId: match[1] };
}

/**
 * Post-processing: convert bare `canvas://<id>` text in HTML (not already
 * inside a tag attribute) into canvas embed divs. The workspace id is
 * injected separately by `injectCanvasEmbedWorkspace` once it is known.
 */
function rewriteBareCanvasEmbedLinks(html: string): string {
    return html.replace(
        /(?<!="|=')canvas:\/\/([a-z0-9][a-z0-9-]{0,127})/gi,
        (match) => {
            const parsed = parseCanvasEmbedLink(match);
            if (!parsed) {
                return match;
            }
            return `<div class="md-canvas-embed" data-canvas-id="${escapeAttr(parsed.canvasId)}"></div>`;
        },
    );
}

/**
 * Stamp the workspace id onto canvas embed placeholders. The `link`/bare-link
 * rewriters emit `data-canvas-id` only (they don't know the workspace), so this
 * pass adds `data-ws-id` from the render context once it is available.
 */
function injectCanvasEmbedWorkspace(html: string, wsId: string): string {
    return html.replace(
        /<div class="md-canvas-embed" data-canvas-id="([^"]*)"><\/div>/g,
        (_match, canvasId) => `<div class="md-canvas-embed" data-canvas-id="${canvasId}" data-ws-id="${escapeAttr(wsId)}"></div>`,
    );
}

/**
 * Post-processing: convert bare `excalidraw://...` text in HTML (not already
 * inside a tag attribute or an existing placeholder) into embed divs.
 */
function rewriteBareExcalidrawLinks(html: string): string {
    return html.replace(
        /(?<!="|=')excalidraw:\/\/([^\s<>"']+)/gi,
        (match) => {
            const parsed = parseExcalidrawLink(match);
            if (!parsed) {
                return match;
            }
            return `<div class="md-excalidraw-embed" data-ws-id="${escapeAttr(parsed.workspaceId)}" data-diagram-path="${escapeAttr(parsed.diagramPath)}"></div>`;
        },
    );
}

let svgFenceIndex = 0;

function createChatMarked(
    htmlEmbedEnabled: boolean,
    excalidrawEmbedEnabled: boolean = false,
    canvasEmbedEnabled: boolean = false,
    svgFenceEnabled: boolean = false,
): Marked {
    let mermaidBlockIndex = 0;

    return new Marked({
        gfm: true,
        breaks: true,
        renderer: {
            code(code: string, infostring: string | undefined, escaped: boolean): string {
                const language = (infostring ?? '').trim().split(/\s+/)[0] || '';
                if (svgFenceEnabled && language.toLowerCase() === 'svg') {
                    svgFenceIndex++;
                    const escapedSource = escaped ? code : escapeHtml(code);
                    return (
                        `<div class="md-svg-fence" data-fence-id="md-svg-${svgFenceIndex}">` +
                        `<pre class="md-svg-source" style="display:none"><code>${escapedSource}</code></pre>` +
                        '</div>\n'
                    );
                }
                if (language.toLowerCase() === 'mermaid') {
                    mermaidBlockIndex++;
                    const block: CodeBlock = {
                        language: 'mermaid',
                        startLine: 1,
                        endLine: code.split('\n').length + 2,
                        code,
                        id: `chat-mermaid-${mermaidBlockIndex}`,
                        isMermaid: true,
                    };
                    return renderMermaidContainer(block);
                }

                const classAttr = language ? ` class="language-${escapeAttr(language)}"` : '';
                const html = escaped ? code : escapeHtml(code);
                return `<pre><code${classAttr}>${html}</code></pre>\n`;
            },
            html(raw: string) {
                return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
            },
            link(href: string, title: string | null | undefined, text: string): string {
                const safeHref = escapeAttr(href ?? '');
                if (excalidrawEmbedEnabled && href && /^excalidraw:\/\//i.test(href)) {
                    const parsed = parseExcalidrawLink(href);
                    if (parsed) {
                        return `<div class="md-excalidraw-embed" data-ws-id="${escapeAttr(parsed.workspaceId)}" data-diagram-path="${escapeAttr(parsed.diagramPath)}"></div>`;
                    }
                }
                if (canvasEmbedEnabled && href && /^canvas:\/\//i.test(href)) {
                    const parsed = parseCanvasEmbedLink(href);
                    if (parsed) {
                        return `<div class="md-canvas-embed" data-canvas-id="${escapeAttr(parsed.canvasId)}"></div>`;
                    }
                }
                const isExternal = /^https?:\/\/|^mailto:/i.test(href ?? '');
                const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
                return isExternal
                    ? `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
                    : `<a href="${safeHref}"${titleAttr}>${text}</a>`;
            },
            image(href: string, title: string | null | undefined, text: string): string {
                if (htmlEmbedEnabled && isEmbeddableHtmlPath(href)) {
                    return `<div class="md-html-embed" data-html-path="${escapeAttr(href ?? '')}" data-embed-height="${DEFAULT_HTML_EMBED_HEIGHT}"></div>`;
                }
                const alt = text || title || 'Image';
                const escapedAlt = escapeAttr(alt);
                const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
                const isExternal = /^https?:\/\//i.test(href ?? '');
                if (isExternal) {
                    return `<img src="${escapeAttr(href)}" alt="${escapedAlt}"${titleAttr} class="chat-inline-image" loading="lazy" onerror="this.onerror=null;this.classList.add('chat-inline-image--error');this.alt='\\u26A0\\uFE0F Image failed to load';">`;
                }
                return `<img data-local-path="${escapeAttr(href)}" alt="${escapedAlt}"${titleAttr} class="chat-inline-image">`;
            },
        },
    }).use(mathMarkedExtension);
}

/**
 * Pre-pass: for every ![alt](url) and [text](url) whose url is a Windows
 * absolute path, normalize backslashes to forward slashes and, if the url
 * contains whitespace, wrap it in <...> so CommonMark parses it correctly.
 */
export function normalizeMarkdownLinkUrls(text: string): string {
    return text.replace(
        /(!?)\[([^\]]*)\]\(([^)\n]+)\)/g,
        (match, bang: string, label: string, url: string) => {
            if (!/^[A-Za-z]:[\\\/]/.test(url)) {
                return match;
            }
            const fwd = toForwardSlashes(url);
            const wrapped = /\s/.test(fwd) ? `<${fwd}>` : fwd;
            return `${bang}[${label}](${wrapped})`;
        },
    );
}

function normalizeWindowsPathsInText(text: string): string {
    return text.replace(/[A-Za-z]:[\\\/][\w.\\/@-]+/g, (match) => toForwardSlashes(match));
}

/**
 * Rewrites `data-local-path` attributes emitted by the image() renderer into
 * proxy URLs served by /api/workspaces/:wsId/files/image?path=...
 * Only runs when wsId is available; local-path images remain invisible otherwise.
 */
function rewriteLocalImagePaths(html: string, wsId: string): string {
    return html.replace(
        /(<img\b[^>]*?) data-local-path="([^"]*)"([^>]*>)/g,
        (_match, before, localPath, after) => {
            const proxyUrl = `/api/workspaces/${encodeURIComponent(wsId)}/files/image?path=${encodeURIComponent(localPath)}`;
            return `${before} src="${proxyUrl}" onerror="this.onerror=null;this.classList.add('chat-inline-image--error');this.removeAttribute('src');"${after}`;
        },
    );
}

/**
 * Convert markdown to semantic HTML using `marked` for chat messages.
 * Produces proper `<h3>`, `<strong>`, `<ul>`, `<pre><code>`, etc.
 * File paths are linkified for hover previews.
 */
export function chatMarkdownToHtml(
    content: string,
    wsId?: string,
    options?: { htmlEmbedEnabled?: boolean; excalidrawEmbedEnabled?: boolean; canvasEmbedEnabled?: boolean; svgFenceEnabled?: boolean },
): string {
    if (!content || !content.trim()) {
        return '';
    }
    const linkNormalized = normalizeMarkdownLinkUrls(content);
    const normalized = normalizeWindowsPathsInText(linkNormalized);
    const excalidrawEnabled = options?.excalidrawEmbedEnabled === true;
    const canvasEnabled = options?.canvasEmbedEnabled === true || excalidrawEnabled;
    const svgEnabled = options?.svgFenceEnabled === true;
    let html = linkifyFilePaths(
        createChatMarked(options?.htmlEmbedEnabled === true, excalidrawEnabled, canvasEnabled, svgEnabled).parse(normalized) as string,
    );
    if (wsId) {
        html = rewriteLocalImagePaths(html, wsId);
    }
    if (excalidrawEnabled) {
        html = rewriteBareExcalidrawLinks(html);
    }
    if (canvasEnabled) {
        html = rewriteBareCanvasEmbedLinks(html);
        if (wsId) {
            html = injectCanvasEmbedWorkspace(html, wsId);
        }
    }
    return html;
}

export function toContentHtml(
    content: string,
    wsId?: string,
    options?: { htmlEmbedEnabled?: boolean; excalidrawEmbedEnabled?: boolean; canvasEmbedEnabled?: boolean },
): string {
    return chatMarkdownToHtml(content, wsId, options);
}
