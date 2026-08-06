/**
 * Pure helpers behind the canvas panel — prompt/message composition, canvas
 * type detection, download naming, and markdown fencing.
 *
 * Nothing here touches React, the DOM, or the API client, so the panel's
 * text-shaped decisions are unit-testable without rendering a canvas.
 */

import type { Canvas, CanvasComment } from '@plusplusoneplusplus/coc-client';
import { getMonacoLanguage } from '../repo-detail/explorer/MonacoFileEditor';

export type ViewMode = 'preview' | 'edit';
export type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

export const AUTOSAVE_DELAY_MS = 800;

export function buildAskAiPrompt(canvas: Canvas, selection: string): string {
    return `Regarding this selection from canvas "${canvas.title}" (canvasId: ${canvas.id}, revision ${canvas.revision}):\n\n"""\n${selection}\n"""\n\n`;
}

export function buildCommentsMessage(canvas: Canvas, comments: CanvasComment[]): string {
    const lines = comments.map((c, i) => `${i + 1}. On "${c.anchorText}": ${c.body}`);
    return `Please address these comments on canvas "${canvas.title}" (canvasId: ${canvas.id}, revision ${canvas.revision}):\n\n${lines.join('\n')}\n\nApply the requested changes with write_canvas (use read_canvas first if you need the current content).`;
}

/** Resolve a Monaco language id from a stored canvas language hint. */
export function monacoLanguageFor(language: string | undefined): string {
    if (!language) return 'plaintext';
    const viaExtension = getMonacoLanguage(`canvas.${language}`);
    return viaExtension !== 'plaintext' ? viaExtension : language;
}

const LANGUAGE_TO_FILE_EXT: Record<string, string> = {
    typescript: 'ts', javascript: 'js', python: 'py', shell: 'sh', bash: 'sh',
    csharp: 'cs', cpp: 'cpp', ruby: 'rb', rust: 'rs', go: 'go', java: 'java',
    kotlin: 'kt', php: 'php', powershell: 'ps1', markdown: 'md', svg: 'svg',
};

export function isSvgCodeCanvas(canvas: Pick<Canvas, 'type' | 'language' | 'content'>): boolean {
    if (canvas.type !== 'code') return false;
    const language = canvas.language?.trim().toLowerCase();
    return language === 'svg'
        || ((!language || language === 'xml') && canvas.content.trimStart().startsWith('<svg'));
}

export function downloadFilenameFor(canvas: Canvas): string {
    const slug = canvas.id.replace(/-[0-9a-f]{6}$/, '') || 'canvas';
    if (canvas.type === 'extension') return `${slug}.json`;
    if (canvas.type === 'kusto') return `${slug}.json`;
    if (canvas.type === 'excalidraw') return `${slug}.excalidraw`;
    if (canvas.type !== 'code') return `${slug}.md`;
    if (isSvgCodeCanvas(canvas)) return `${slug}.svg`;
    const language = canvas.language ?? '';
    return `${slug}.${LANGUAGE_TO_FILE_EXT[language] ?? (language || 'txt')}`;
}

/** Notes path a markdown canvas is saved to by the "Save to Notes" export. */
export function notesPathFor(canvas: Pick<Canvas, 'id'>): string {
    const slug = canvas.id.replace(/-[0-9a-f]{6}$/, '') || canvas.id;
    return `canvases/${slug}.md`;
}

/** Wrap raw code in a fenced block so the markdown pipeline highlights it. */
export function fenceCode(content: string, language: string | undefined): string {
    return `\`\`\`\`${language ?? ''}\n${content}\n\`\`\`\``;
}

export interface CanvasKind {
    isCode: boolean;
    /** A code canvas whose content is an SVG document — rendered, not fenced. */
    isSvg: boolean;
    isExtension: boolean;
    isExcalidraw: boolean;
    isKusto: boolean;
}

/**
 * Which render branch a canvas takes. `displayedContent` is the content on
 * screen (an older revision while browsing history), because SVG detection for
 * an untagged code canvas depends on the content itself.
 */
export function canvasKind(canvas: Canvas | null, displayedContent: string): CanvasKind {
    return {
        isCode: canvas?.type === 'code',
        isSvg: Boolean(canvas && isSvgCodeCanvas({
            type: canvas.type,
            language: canvas.language,
            content: displayedContent,
        })),
        isExtension: canvas?.type === 'extension',
        isExcalidraw: canvas?.type === 'excalidraw',
        isKusto: canvas?.type === 'kusto',
    };
}

/**
 * Markdown source handed to the preview pipeline — empty for canvas types that
 * render through their own view.
 *
 * Excalidraw scenes are host-rendered straight from their scene JSON (including
 * history views). Kusto canvases always render through KustoView, so the (up to
 * 10k-row) serialized result JSON is never marked-parsed. Extension canvases
 * render their own iframe UI; the pipeline is used only to show their raw JSON
 * state in a history view.
 */
export function previewMarkdownFor(
    kind: CanvasKind,
    canvas: Canvas | null,
    displayedContent: string,
    viewingHistory: boolean,
): string {
    if (kind.isExcalidraw || kind.isKusto) return '';
    if (kind.isExtension) return viewingHistory ? fenceCode(displayedContent, 'json') : '';
    return kind.isCode ? fenceCode(displayedContent, canvas?.language) : displayedContent;
}

/** Short save-status text shown in the header; empty when there is nothing to say. */
export function saveStatusLabel(saveState: SaveState, dirty: boolean): string {
    return saveState === 'saving' ? 'Saving…'
        : saveState === 'saved' ? 'Saved'
        : saveState === 'conflict' ? 'Save conflict'
        : saveState === 'error' ? 'Save failed'
        : dirty ? 'Unsaved edits' : '';
}
