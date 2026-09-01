/**
 * File category detection — is this file image, text, or opaque bytes?
 *
 * One table, three callers: chat attachments (`attachment-utils.ts`) decide
 * whether to inline a file's text into the prompt, and the canvas files bridge
 * (`canvas/canvas-store.ts`) decides whether to hand an extension `utf-8` or
 * `base64`. Both answer the same question, so both ask it here rather than
 * carrying their own copy of the extension list.
 *
 * Pure Node.js; no imports at all.
 */

export type FileCategory = 'image' | 'text' | 'binary';

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

/**
 * Classify a file by its MIME type and name. The MIME type wins when it is
 * meaningful; the extension decides otherwise, which is the only signal a
 * caller reading a file off disk has. Anything unrecognized is `binary` — the
 * safe answer, since treating real bytes as UTF-8 corrupts them silently.
 */
export function getFileCategory(mimeType: string, fileName: string): FileCategory {
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
 * Classify a file known only by name (no MIME type available) — the case when
 * reading off disk. Extensionless names still resolve through the table above
 * (`Dockerfile`, `Makefile`).
 */
export function getFileCategoryByName(fileName: string): FileCategory {
    return getFileCategory('application/octet-stream', fileName);
}
