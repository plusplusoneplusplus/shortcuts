/**
 * ChatAttachment — unified attachment type for chat messages.
 *
 * Covers images, text files, code files, and binary files.
 * Used by useFileAttachments hook and the server message API.
 */

/** Attachment category determines how the file is handled by the AI */
export type AttachmentCategory = 'image' | 'text' | 'binary';

export interface ChatAttachment {
    /** Unique client-side ID */
    id: string;
    /** Original file name */
    name: string;
    /** MIME type (e.g., 'image/png', 'text/plain') */
    mimeType: string;
    /** File size in bytes */
    size: number;
    /** Base64 data URL for upload */
    dataUrl: string;
    /** Category for AI handling */
    category: AttachmentCategory;
}

/** Serialized attachment in API request (subset of ChatAttachment for wire format) */
export interface AttachmentPayload {
    name: string;
    mimeType: string;
    size: number;
    dataUrl: string;
}

// ── Constants ──────────────────────────────────────────────────────────

/** Maximum file size in bytes (10 MB) */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum number of attachments per message */
export const MAX_ATTACHMENTS = 10;

/** Human-readable max file size for error messages */
export const MAX_FILE_SIZE_LABEL = '10 MB';

// ── Category detection ─────────────────────────────────────────────────

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_EXACT = new Set([
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
    'application/x-yaml',
    'application/yaml',
    'application/toml',
    'application/x-sh',
    'application/x-httpd-php',
    'application/sql',
    'application/graphql',
    'application/xhtml+xml',
    'application/x-python-code',
]);

const TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm',
    'css', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java',
    'kt', 'kts', 'scala', 'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'cs', 'swift',
    'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'graphql', 'gql',
    'r', 'R', 'lua', 'php', 'pl', 'pm', 'ex', 'exs', 'erl', 'hrl', 'hs',
    'clj', 'cljs', 'cljc', 'elm', 'vue', 'svelte', 'astro',
    'tf', 'hcl', 'ini', 'cfg', 'conf', 'env', 'properties',
    'csv', 'tsv', 'log', 'diff', 'patch',
    'dockerfile', 'makefile', 'cmake', 'gradle', 'sbt',
    'proto', 'thrift', 'avsc', 'prisma',
]);

/** Determine the attachment category from MIME type and file name */
export function getAttachmentCategory(mimeType: string, fileName: string): AttachmentCategory {
    if (mimeType.startsWith('image/')) return 'image';

    if (TEXT_MIME_PREFIXES.some(p => mimeType.startsWith(p))) return 'text';
    if (TEXT_MIME_EXACT.has(mimeType)) return 'text';

    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    if (TEXT_EXTENSIONS.has(ext)) return 'text';

    // Files without extensions that have octet-stream mime are often text (e.g., Makefile, Dockerfile)
    const baseName = fileName.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    if (mimeType === 'application/octet-stream' && TEXT_EXTENSIONS.has(baseName)) return 'text';

    return 'binary';
}

// ── File type icons ────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<AttachmentCategory, string> = {
    image: '🖼️',
    text: '📄',
    binary: '📎',
};

/** Get an emoji icon for the attachment category */
export function getAttachmentIcon(category: AttachmentCategory): string {
    return CATEGORY_ICONS[category];
}

/** Format file size for display (e.g., "1.2 KB", "3.4 MB") */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
