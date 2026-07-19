/**
 * AskUserMarkdown — render trusted-but-AI-supplied markdown inside the
 * AskUserInline form. Use `inline` for short labels/descriptions and the
 * default block mode for the question body (which may contain lists, code,
 * etc.).
 *
 * Built on `marked` (already a dependency, also used by ConversationTurnBubble),
 * with strict sanitization suitable for AI-supplied content:
 *  - Raw HTML in source is escaped (no <script>, no event handlers).
 *  - Link/image URLs with non-http(s)/mailto/anchor schemes are neutralized
 *    (so `javascript:`, `data:`, `vbscript:` cannot execute).
 *  - External http(s) links open in a new tab with rel="noopener noreferrer".
 */
import { useMemo } from 'react';
import { Marked } from 'marked';
import { mathMarkedExtension } from '../../../shared/math/mathMarkedExtension';

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

const SAFE_URL_RE = /^(?:https?:\/\/|mailto:|#|\/|\.\.?\/)/i;

function sanitizeUrl(href: string | null | undefined): string {
    const raw = (href ?? '').trim();
    if (!raw) return '#';
    if (SAFE_URL_RE.test(raw)) return raw;
    return '#';
}

function createAskUserMarked(): Marked {
    return new Marked({
        gfm: true,
        breaks: false,
        renderer: {
            html(raw: string): string {
                return escapeHtml(raw);
            },
            link(href: string, title: string | null | undefined, text: string): string {
                const safeHref = sanitizeUrl(href);
                const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
                const isExternal = /^https?:\/\//i.test(safeHref);
                const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
                return `<a href="${escapeAttr(safeHref)}"${titleAttr}${target}>${text}</a>`;
            },
            image(href: string, title: string | null | undefined, text: string): string {
                const safeHref = sanitizeUrl(href);
                const alt = escapeAttr(text || title || '');
                const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
                return `<img src="${escapeAttr(safeHref)}" alt="${alt}"${titleAttr} loading="lazy">`;
            },
        },
    }).use(mathMarkedExtension);
}

let cachedMarked: Marked | null = null;
function getMarked(): Marked {
    if (!cachedMarked) cachedMarked = createAskUserMarked();
    return cachedMarked;
}

/**
 * Render block markdown (paragraphs, lists, code, etc.) to safe HTML.
 */
export function renderAskUserMarkdown(src: string): string {
    if (!src) return '';
    return getMarked().parse(src) as string;
}

/**
 * Render inline-only markdown (bold, italic, code, links, images) to safe HTML.
 * No surrounding <p>, no block elements — suitable for inline labels.
 */
export function renderAskUserMarkdownInline(src: string): string {
    if (!src) return '';
    return getMarked().parseInline(src) as string;
}

export interface AskUserMarkdownProps {
    markdown: string;
    /** When true, render inline-only (no <p>/<ul>/<ol>) inside a <span>. */
    inline?: boolean;
    className?: string;
    'data-testid'?: string;
}

export function AskUserMarkdown({ markdown, inline, className, ...rest }: AskUserMarkdownProps) {
    const html = useMemo(
        () => (inline ? renderAskUserMarkdownInline(markdown) : renderAskUserMarkdown(markdown)),
        [markdown, inline],
    );
    if (inline) {
        return (
            <span
                className={className}
                data-testid={rest['data-testid']}
                dangerouslySetInnerHTML={{ __html: html }}
            />
        );
    }
    return (
        <div
            className={className}
            data-testid={rest['data-testid']}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}
