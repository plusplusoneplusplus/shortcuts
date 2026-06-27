/**
 * Attachment Utilities
 *
 * Server-side helpers for decoding uploaded file attachments (base64 data URLs)
 * into stored files and producing SDK Attachment objects.
 * Handles images, text files, and binary files.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Attachment } from '@plusplusoneplusplus/forge';
import { parseDataUrl, isImageDataUrl, saveImagesToTempFiles, MAX_IMAGE_BYTES } from './image-utils';

/** Wire format for file attachments from the client */
export interface AttachmentPayload {
    name: string;
    mimeType: string;
    size: number;
    dataUrl: string;
}

/** Metadata stored alongside a conversation turn for display */
export interface FileAttachmentMeta {
    name: string;
    mimeType: string;
    size: number;
    category: 'image' | 'text' | 'binary';
}

// ── Category detection (mirrors client-side logic) ─────────────────────

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_EXACT = new Set([
    'application/json', 'application/xml', 'application/javascript',
    'application/typescript', 'application/x-yaml', 'application/yaml',
    'application/toml', 'application/x-sh', 'application/x-httpd-php',
    'application/sql', 'application/graphql', 'application/xhtml+xml',
    'application/x-python-code',
]);
const TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm',
    'css', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java',
    'kt', 'kts', 'scala', 'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'cs', 'swift',
    'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'graphql', 'gql',
    'r', 'lua', 'php', 'pl', 'pm', 'ex', 'exs', 'erl', 'hrl', 'hs',
    'clj', 'cljs', 'cljc', 'elm', 'vue', 'svelte', 'astro',
    'tf', 'hcl', 'ini', 'cfg', 'conf', 'env', 'properties',
    'csv', 'tsv', 'log', 'diff', 'patch',
    'dockerfile', 'makefile', 'cmake', 'gradle', 'sbt',
    'proto', 'thrift', 'avsc', 'prisma',
]);

function getCategory(mimeType: string, fileName: string): 'image' | 'text' | 'binary' {
    if (mimeType.startsWith('image/')) return 'image';
    if (TEXT_MIME_PREFIXES.some(p => mimeType.startsWith(p))) return 'text';
    if (TEXT_MIME_EXACT.has(mimeType)) return 'text';
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    if (TEXT_EXTENSIONS.has(ext)) return 'text';
    const baseName = fileName.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    if (mimeType === 'application/octet-stream' && TEXT_EXTENSIONS.has(baseName)) return 'text';
    return 'binary';
}

/**
 * Parse a generic base64 data URL into its components.
 * Unlike parseDataUrl (image-only), this handles any MIME type.
 */
export function parseGenericDataUrl(
    dataUrl: string,
): { mimeType: string; buffer: Buffer } | null {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return null;
    try {
        const buffer = Buffer.from(match[2], 'base64');
        return { mimeType: match[1], buffer };
    } catch {
        return null;
    }
}

/**
 * Max attachment size server-side (10 MB). Re-exported from the shared
 * {@link MAX_IMAGE_BYTES} so the limit is defined exactly once and the boundary
 * is referenceable by name (e.g. from tests) instead of being a magic number.
 */
export const MAX_ATTACHMENT_SIZE = MAX_IMAGE_BYTES;
/** Max number of attachments per message */
const MAX_ATTACHMENTS = 10;

/**
 * Minimum character count before text attachment content is externalized
 * to a file-path reference instead of being inlined in the prompt.
 */
export const TEXT_EXTERNALIZE_THRESHOLD = 200;

/**
 * Validate and extract attachment payloads from a request body.
 * Returns validated payloads (capped at MAX_ATTACHMENTS) and extracted metadata.
 */
export function validateAttachments(
    rawAttachments: unknown[],
): { payloads: AttachmentPayload[]; meta: FileAttachmentMeta[] } {
    const payloads: AttachmentPayload[] = [];
    const meta: FileAttachmentMeta[] = [];

    for (const raw of rawAttachments.slice(0, MAX_ATTACHMENTS)) {
        if (!raw || typeof raw !== 'object') continue;
        const a = raw as Record<string, unknown>;
        if (typeof a.name !== 'string' || typeof a.dataUrl !== 'string') continue;
        if (typeof a.size !== 'number' || a.size > MAX_ATTACHMENT_SIZE) continue;

        const mimeType = typeof a.mimeType === 'string' ? a.mimeType : 'application/octet-stream';
        const category = getCategory(mimeType, a.name);

        payloads.push({
            name: a.name,
            mimeType,
            size: a.size,
            dataUrl: a.dataUrl,
        });
        meta.push({ name: a.name, mimeType, size: a.size, category });
    }

    return { payloads, meta };
}

/**
 * Save attachment payloads to temp files and return SDK Attachment objects.
 * Images are saved and returned as file attachments.
 * Text files are saved and their content is returned for prompt injection.
 * Binary files are saved and returned as file attachments.
 */
export function saveAttachmentsToTempFiles(
    payloads: AttachmentPayload[],
    tempDir: string,
): { attachments: Attachment[]; textContents: Array<{ name: string; content: string; filePath: string }> } {
    const attachments: Attachment[] = [];
    const textContents: Array<{ name: string; content: string; filePath: string }> = [];

    fs.mkdirSync(tempDir, { recursive: true });

    for (let i = 0; i < payloads.length; i++) {
        const payload = payloads[i];
        const category = getCategory(payload.mimeType, payload.name);

        // For images, try the existing image parser first
        if (category === 'image') {
            const parsed = parseDataUrl(payload.dataUrl);
            if (parsed) {
                // Decoded-byte enforcement: the client-reported `size` is not
                // trusted, so drop images whose actual decoded bytes exceed the
                // limit before writing them to disk or producing an SDK attachment.
                if (parsed.buffer.length > MAX_ATTACHMENT_SIZE) continue;
                const sanitizedName = sanitizeFileName(payload.name);
                const baseName = sanitizedName.trim().length > 0 ? sanitizedName : `image-${i}`;
                // Force the on-disk extension to match the decoded image MIME type.
                // Downstream providers that detect images by extension (Claude,
                // Codex) would otherwise silently drop an image whose client name
                // lacks a valid image extension (e.g. a pasted "screenshot" with no
                // suffix). The user-facing display name keeps the original name.
                const safeName = withImageExtension(baseName, parsed.extension);
                const filePath = path.join(tempDir, safeName);
                fs.writeFileSync(filePath, parsed.buffer);
                attachments.push({
                    type: 'file',
                    path: filePath,
                    displayName: getAttachmentDisplayName(payload.name, filePath),
                });
                continue;
            }
        }

        // Generic data URL parsing
        const parsed = parseGenericDataUrl(payload.dataUrl);
        if (!parsed) continue;
        // Decoded-byte enforcement (same rationale as the image path above):
        // drop any payload whose decoded bytes exceed the limit, regardless of
        // the client-reported `size`, before it is written to disk.
        if (parsed.buffer.length > MAX_ATTACHMENT_SIZE) continue;

        const sanitizedName = sanitizeFileName(payload.name);
        const safeName = sanitizedName.trim().length > 0 ? sanitizedName : `file-${i}`;
        const filePath = path.join(tempDir, safeName);
        fs.writeFileSync(filePath, parsed.buffer);

        if (category === 'text') {
            const content = parsed.buffer.toString('utf-8');
            textContents.push({ name: payload.name, content, filePath });
        }

        attachments.push({
            type: 'file',
            path: filePath,
            displayName: getAttachmentDisplayName(payload.name, filePath),
        });
    }

    return { attachments, textContents };
}

/**
 * Build prompt context for text file attachments.
 * Small text (≤ TEXT_EXTERNALIZE_THRESHOLD) is inlined in the prompt.
 * Large text (> TEXT_EXTERNALIZE_THRESHOLD) is referenced by file path
 * so the AI can read the file on demand without bloating the context.
 */
export function buildTextAttachmentContext(
    textContents: Array<{ name: string; content: string; filePath?: string }>,
): string {
    if (textContents.length === 0) return '';

    const sections = textContents.map(({ name, content, filePath }) => {
        if (content.length > TEXT_EXTERNALIZE_THRESHOLD && filePath) {
            return [
                `<attached_file name="${name}" path="${filePath}">`,
                `This file contains approximately ${content.length} characters.`,
                `Read it at the path above to examine its contents.`,
                `</attached_file>`,
            ].join('\n');
        }
        const truncated = content.length > 50_000
            ? content.slice(0, 50_000) + '\n... (truncated)'
            : content;
        return `<attached_file name="${name}">\n${truncated}\n</attached_file>`;
    });

    return '\n\n' + sections.join('\n\n');
}

/** Sanitize a filename to prevent path traversal */
function sanitizeFileName(name: string): string {
    return name
        .replace(/[/\\]/g, '_')
        .replace(/\.\./g, '_')
        .replace(/[<>:"|?*]/g, '_')
        .slice(0, 200);
}

/** Image extensions that are equivalent and must not be rewritten into each other. */
const JPEG_EXTENSIONS = new Set(['jpg', 'jpeg']);

/**
 * Ensure an image's on-disk filename carries the extension that matches its
 * decoded MIME type. Downstream providers (Claude, Codex) detect images by file
 * extension, so a client-supplied name with a wrong or missing extension would
 * be silently dropped. A wrong/missing extension is replaced; an already-correct
 * one (or a jpg/jpeg equivalent) is preserved. Only the on-disk path is changed —
 * the display name shown to the user keeps the original filename.
 */
function withImageExtension(name: string, mimeExtension: string): string {
    const ext = mimeExtension.toLowerCase();
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const current = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    if (current === ext) return name;
    if (JPEG_EXTENSIONS.has(current) && JPEG_EXTENSIONS.has(ext)) return name;
    return `${stem}.${ext}`;
}

function getAttachmentDisplayName(name: string, filePath: string): string {
    return name.trim().length > 0 ? name : path.basename(filePath);
}

/**
 * Check if the request body has valid attachment payloads.
 */
export function hasAttachments(body: Record<string, unknown>): boolean {
    return Array.isArray(body.attachments) && body.attachments.length > 0;
}

/**
 * Check whether `value` looks like a wire-format AttachmentPayload[] (with `dataUrl`),
 * as opposed to an already-decoded SDK Attachment[] (with `type: 'file'` + `path`).
 *
 * Used by the enqueue path to detect when the client is sending a brand-new chat
 * with raw data-URL attachments that still need to be decoded server-side.
 */
export function isWireAttachmentArray(value: unknown): value is AttachmentPayload[] {
    if (!Array.isArray(value) || value.length === 0) return false;
    return value.every(
        (a) =>
            !!a
            && typeof a === 'object'
            && typeof (a as Record<string, unknown>).dataUrl === 'string',
    );
}

/**
 * Extract both legacy images and new attachments from a request body.
 * Returns a unified set of SDK Attachment objects and text content for prompt injection.
 * Handles backward compatibility: if only `images` is provided, falls back to image handling.
 */
export function processMessageAttachments(
    body: Record<string, unknown>,
    tempDir: string,
): {
    sdkAttachments: Attachment[];
    textContext: string;
    imageTempDir: string;
    validatedImages: string[] | undefined;
    fileAttachmentMeta: FileAttachmentMeta[] | undefined;
} {
    let sdkAttachments: Attachment[] = [];
    let textContext = '';
    let validatedImages: string[] | undefined;
    let fileAttachmentMeta: FileAttachmentMeta[] | undefined;

    // Process new-style attachments
    if (hasAttachments(body)) {
        const { payloads, meta } = validateAttachments(body.attachments as unknown[]);
        if (payloads.length > 0) {
            fs.mkdirSync(tempDir, { recursive: true });
            const result = saveAttachmentsToTempFiles(payloads, tempDir);
            sdkAttachments = result.attachments;
            textContext = buildTextAttachmentContext(result.textContents);
            fileAttachmentMeta = meta;

            // Extract image data URLs for backward-compatible persistence
            validatedImages = payloads
                .filter(p => isImageDataUrl(p.dataUrl))
                .map(p => p.dataUrl)
                .slice(0, 5);
            if (validatedImages.length === 0) validatedImages = undefined;
        }
    }

    // Also process legacy images field (if no new-style image attachments)
    if (!validatedImages && Array.isArray(body.images) && body.images.length > 0) {
        const filtered = (body.images as unknown[])
            .filter((img: unknown): img is string => typeof img === 'string' && isImageDataUrl(img as string))
            .slice(0, 5);
        if (filtered.length > 0) {
            validatedImages = filtered;
        }

        // Save legacy images to temp files as SDK attachments if we don't already have them
        if (sdkAttachments.length === 0) {
            const validImgs = (body.images as unknown[])
                .filter((img: unknown) => typeof img === 'string')
                .slice(0, 10) as string[];
            if (validImgs.length > 0) {
                const result = saveImagesToTempFiles(validImgs);
                sdkAttachments = result.attachments;
                // Note: tempDir from saveImagesToTempFiles is different; caller handles cleanup
            }
        }
    }

    return {
        sdkAttachments,
        textContext,
        imageTempDir: tempDir,
        validatedImages,
        fileAttachmentMeta,
    };
}
