/**
 * markdownRichConversion — pure helpers shared by markdown editor surfaces.
 *
 * These compose the lower-level primitives (front matter split/compose,
 * markdown⇄HTML conversion, and image URL rewriting) into the two directions
 * every rich/source markdown editor needs:
 *
 *   markdown  ──markdownToRichEditorHtml──▶  HTML for Tiptap `setContent()`
 *   Tiptap HTML ──richEditorHtmlToMarkdown──▶ markdown for saving
 *
 * Keeping the sequence in one place means load, mode-switch, conflict, and
 * live-reload paths cannot drift apart on front matter handling or image URL
 * policy. The helpers are dependency-free of React so they unit-test in
 * isolation.
 */

import type { MarkdownDocumentIO } from './MarkdownDocumentIO';
import {
    composeMarkdownWithFrontMatter,
    parseNoteFrontMatter,
} from '../../features/notes/editor/noteFrontMatter';
import type { NoteFrontMatterParseResult } from '../../features/notes/editor/noteFrontMatter';
import {
    htmlToMarkdown,
    markdownToHtml,
    rewriteImageSrcToRelative,
} from '../../features/notes/editor/noteMarkdown';
import { rewriteHtmlImageSrc } from '../../features/notes/editor/NoteEditorIO';

export interface MarkdownToRichEditorHtmlParams {
    /** Full document markdown, potentially including YAML front matter. */
    markdown: string;
    /** I/O adapter used to resolve image `src` attributes to API URLs. */
    io: MarkdownDocumentIO;
    workspaceId: string;
    root?: string;
}

export interface MarkdownToRichEditorHtmlResult {
    /** HTML suitable for Tiptap `setContent()`, with image `src` rewritten. */
    html: string;
    /** Parsed front matter; `kind: 'valid'` carries the split body + raw block. */
    frontMatter: NoteFrontMatterParseResult;
    /** Markdown body fed to the rich editor (front matter stripped when valid). */
    body: string;
}

/**
 * Convert document markdown into HTML for the rich editor.
 *
 * When the document has valid YAML front matter, only the body is converted;
 * the parsed front matter is returned so callers can surface metadata and
 * re-attach it on save. Invalid or absent front matter falls back to converting
 * the full markdown, matching the notes editor's long-standing behavior.
 */
export function markdownToRichEditorHtml(
    params: MarkdownToRichEditorHtmlParams,
): MarkdownToRichEditorHtmlResult {
    const { markdown, io, workspaceId, root } = params;
    const frontMatter = parseNoteFrontMatter(markdown);
    const body = frontMatter.kind === 'valid' ? frontMatter.frontMatter.body : markdown;
    const html = rewriteHtmlImageSrc(markdownToHtml(body), io, workspaceId, root);
    return { html, frontMatter, body };
}

export interface RichEditorHtmlToMarkdownParams {
    /** HTML from `editor.getHTML()`. */
    html: string;
    /**
     * Front matter parsed when the document was loaded. When `kind: 'valid'`
     * the original front matter block is re-composed ahead of the edited body.
     */
    frontMatter: NoteFrontMatterParseResult;
}

/**
 * Serialize rich editor HTML back to document markdown.
 *
 * Image `src` API URLs are rewritten back to their relative/absolute source
 * form and, when the loaded document carried valid front matter, that block is
 * prepended so metadata survives body-only rich edits.
 */
export function richEditorHtmlToMarkdown(params: RichEditorHtmlToMarkdownParams): string {
    const { html, frontMatter } = params;
    const body = rewriteImageSrcToRelative(htmlToMarkdown(html));
    if (frontMatter.kind === 'valid') {
        return composeMarkdownWithFrontMatter(frontMatter.frontMatter, body);
    }
    return body;
}

/** Build a markdown image tag for a freshly uploaded image path. */
export function buildImageMarkdown(fileName: string, path: string): string {
    return `![${fileName}](${path})`;
}

/**
 * Insert `insert` into `source` replacing the `[start, end)` range.
 *
 * Used by source-mode paste to drop an uploaded image at the caret/selection.
 * When no textarea selection is available, callers pass `start = end =
 * source.length` to append.
 */
export function insertTextAtSelection(
    source: string,
    start: number,
    end: number,
    insert: string,
): string {
    return source.slice(0, start) + insert + source.slice(end);
}

export { composeMarkdownWithFrontMatter, parseNoteFrontMatter };
export type { NoteFrontMatterParseResult };
