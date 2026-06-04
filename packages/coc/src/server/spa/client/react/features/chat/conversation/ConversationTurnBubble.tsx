/**
 * ConversationTurnBubble — role-aware chat bubble for conversation turns.
 */
import React, { useState, useMemo, useCallback } from 'react';
import { cn, ImageGallery, Spinner } from '../../../ui';
import type { ClientConversationTurn, ClientTokenUsage } from '../../../types/dashboard';
import { ContextMenu } from '../../../tasks/comments/ContextMenu';
import type { ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import { MarkdownView } from '../../../shared/MarkdownView';
import { ToolCallView } from './tool-calls/ToolCallView';
import { JsonResponseView } from '../../../ui/JsonResponseView';
import { isJsonResponse } from '../../../ui/json-utils';
import { mergeConsecutiveContentItems } from './timeline-utils';
import { LoopIcon } from '../icons/LoopIcon';
import { Marked } from 'marked';
import { useDisplaySettings } from '../../../hooks/preferences/useDisplaySettings';
import { useHtmlEmbedPreference } from '../../../hooks/preferences/useHtmlEmbedPreference';
import { isExcalidrawEnabled } from '../../../utils/config';
import { SHOW_EXCALIDRAW_DIAGRAMS } from '../../../featureFlags';
import { getSpaCocClient } from '../../../api/cocClient';
import { copyToClipboard, copyHtmlToClipboard, splitMarkdownSections } from '../../../utils/format';
import { linkifyFilePaths } from '../../../shared/file-path-utils';
import { toForwardSlashes } from '@plusplusoneplusplus/forge/utils/path-utils';
import { renderMermaidContainer, type CodeBlock } from '@plusplusoneplusplus/forge/editor/parsing';
import { DEFAULT_HTML_EMBED_HEIGHT, isEmbeddableHtmlPath } from '@plusplusoneplusplus/forge/editor/rendering';
import type { ToolGroupCategory, GroupContentItem, GroupOrderedItem } from './tool-calls/toolGroupUtils';
import { groupConsecutiveToolChunks, filterWhisperChunks } from './tool-calls/toolGroupUtils';
import type { WhisperGroupChunk } from './tool-calls/toolGroupUtils';
import { ToolCallGroupView } from './tool-calls/ToolCallGroupView';
import { normalizeToolForDisplay } from './tool-calls/toolNormalization';
import { TaskDefs } from '../../../../../../tasks/task-types';
import { WhisperCollapsedGroup } from './tool-calls/WhisperCollapsedGroup';
import { detectCommitsInToolGroup } from './commitDetection';
import { CommitStrip } from './CommitStrip';
import { NoteEditCard } from './NoteEditCard';
import { ScriptTerminalBlock } from './ScriptTerminalBlock';
import { parseScriptOutput, describeScriptExit } from './scriptOutputParser';
import { getProviderAvatarClasses, type ChatProvider } from '../ProviderBadge';
import { AskUserHistoryCard, hasAskUserHistory } from '../AskUserHistoryCard';
import {
    parseAttachedSessionContextBlocks,
    shortenSessionProcessId,
    type ParsedAttachedContextBlock,
    type ParsedRalphSessionContextBlock,
    type ParsedSessionContextBlock,
} from '../hooks/useAttachedContext';

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
    if (!match) return null;
    const workspaceId = decodeURIComponent(match[1]);
    const diagramPath = decodeURIComponent(match[2]);
    if (!workspaceId || !diagramPath) return null;
    return { workspaceId, diagramPath };
}

/**
 * Post-processing: convert bare `excalidraw://...` text in HTML (not already
 * inside a tag attribute or an existing placeholder) into embed divs.
 */
function rewriteBareExcalidrawLinks(html: string): string {
    // Match bare excalidraw:// URLs that are NOT inside an HTML tag attribute
    // (i.e., not preceded by `="` or `='`). Also skip if already inside an
    // md-excalidraw-embed div.
    return html.replace(
        /(?<!="|=')excalidraw:\/\/([^\s<>"']+)/gi,
        (match) => {
            const parsed = parseExcalidrawLink(match);
            if (!parsed) return match;
            return `<div class="md-excalidraw-embed" data-ws-id="${escapeAttr(parsed.workspaceId)}" data-diagram-path="${escapeAttr(parsed.diagramPath)}"></div>`;
        },
    );
}

function createChatMarked(htmlEmbedEnabled: boolean, excalidrawEmbedEnabled: boolean = false): Marked {
    let mermaidBlockIndex = 0;

    return new Marked({
        gfm: true,
        breaks: true,
        renderer: {
            code(code: string, infostring: string | undefined, escaped: boolean): string {
                const language = (infostring ?? '').trim().split(/\s+/)[0] || '';
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
                // Excalidraw links → inline placeholder div
                if (excalidrawEmbedEnabled && href && /^excalidraw:\/\//i.test(href)) {
                    const parsed = parseExcalidrawLink(href);
                    if (parsed) {
                        return `<div class="md-excalidraw-embed" data-ws-id="${escapeAttr(parsed.workspaceId)}" data-diagram-path="${escapeAttr(parsed.diagramPath)}"></div>`;
                    }
                }
                const isExternal = /^https?:\/\/|^mailto:/i.test(href ?? '');
                const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
                return isExternal
                    ? `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
                    : `<a href="${safeHref}"${titleAttr}>${text}</a>`;
            },
            image(href: string, title: string | null | undefined, text: string): string {
                // .html/.htm references via image syntax embed inline, skipping the <img> entirely.
                if (htmlEmbedEnabled && isEmbeddableHtmlPath(href)) {
                    return `<div class="md-html-embed" data-html-path="${escapeAttr(href ?? '')}" data-embed-height="${DEFAULT_HTML_EMBED_HEIGHT}"></div>`;
                }
                const alt = text || title || 'Image';
                const escapedAlt = escapeAttr(alt);
                const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
                const isExternal = /^https?:\/\//i.test(href ?? '');
                if (isExternal) {
                    return `<img src="${escapeAttr(href)}" alt="${escapedAlt}"${titleAttr} class="chat-inline-image" loading="lazy" onerror="this.onerror=null;this.classList.add('chat-inline-image--error');this.alt='⚠\uFE0F Image failed to load';">`;
                }
                // Local path: store in data-local-path; rewriteLocalImagePaths() will
                // convert this to the proxy URL once wsId is known (post-parse step).
                return `<img data-local-path="${escapeAttr(href)}" alt="${escapedAlt}"${titleAttr} class="chat-inline-image">`;
            },
        },
    });
}

/**
 * Pre-pass: for every ![alt](url) and [text](url) whose url is a Windows
 * absolute path, normalize backslashes to forward slashes and, if the url
 * contains whitespace, wrap it in <…> so CommonMark parses it correctly.
 * Must run before normalizeWindowsPathsInText and before `marked`.
 */
export function normalizeMarkdownLinkUrls(text: string): string {
    return text.replace(
        /(!?)\[([^\]]*)\]\(([^)\n]+)\)/g,
        (match, bang: string, label: string, url: string) => {
            if (!/^[A-Za-z]:[\\\/]/.test(url)) return match;
            const fwd = toForwardSlashes(url);
            const wrapped = /\s/.test(fwd) ? `<${fwd}>` : fwd;
            return `${bang}[${label}](${wrapped})`;
        },
    );
}

/**
 * Pre-normalize Windows-style paths (backslash) to forward slashes before markdown
 * parsing, so that `marked` does not treat `\.` as an escape sequence (GFM treats
 * backslash-followed-by-ASCII-punctuation as an escape, silently dropping the `\`).
 */
function normalizeWindowsPathsInText(text: string): string {
    return text.replace(/[A-Za-z]:[\\\/][\w.\\/@-]+/g, (match) => toForwardSlashes(match));
}

/**
 * Rewrites `data-local-path` attributes emitted by the image() renderer into
 * proxy URLs served by /api/workspaces/:wsId/files/image?path=…
 * Only runs when wsId is available; local-path images remain invisible otherwise.
 */
function rewriteLocalImagePaths(html: string, wsId: string): string {
    return html.replace(
        /(<img\b[^>]*?) data-local-path="([^"]*)"([^>]*>)/g,
        (_match, before, localPath, after) => {
            const proxyUrl = `/api/workspaces/${encodeURIComponent(wsId)}/files/image?path=${encodeURIComponent(localPath)}`;
            return `${before} src="${proxyUrl}" onerror="this.onerror=null;this.classList.add('chat-inline-image--error');this.removeAttribute('src');"${after}`;
        }
    );
}

/**
 * Convert markdown to semantic HTML using `marked` for chat messages.
 * Produces proper `<h3>`, `<strong>`, `<ul>`, `<pre><code>`, etc.
 * File paths are linkified for hover previews.
 */
export function chatMarkdownToHtml(content: string, wsId?: string, options?: { htmlEmbedEnabled?: boolean; excalidrawEmbedEnabled?: boolean }): string {
    if (!content || !content.trim()) return '';
    // Order matters: normalizeMarkdownLinkUrls fixes link/image URLs first (handles
    // spaces + backslashes), then normalizeWindowsPathsInText handles bare prose paths.
    const linkNormalized = normalizeMarkdownLinkUrls(content);
    const normalized = normalizeWindowsPathsInText(linkNormalized);
    const excalidrawEnabled = options?.excalidrawEmbedEnabled === true;
    let html = linkifyFilePaths(createChatMarked(options?.htmlEmbedEnabled === true, excalidrawEnabled).parse(normalized) as string);
    if (wsId) {
        html = rewriteLocalImagePaths(html, wsId);
    }
    // Post-process: convert bare excalidraw:// URLs to embed divs
    if (excalidrawEnabled) {
        html = rewriteBareExcalidrawLinks(html);
    }
    return html;
}

interface ConversationTurnBubbleProps {
    turn: ClientConversationTurn;
    /** Queue task ID — when provided, enables lazy image fetching for turns with imagesCount */
    taskId?: string;
    /** Called when the user clicks the Retry button on an error assistant bubble. */
    onRetry?: () => void;
    /** Process type (e.g. 'run-script') — used to label non-AI responses differently. */
    processType?: string;
    /** Workspace ID — stamped as data-ws-id so file-path click handlers can route to the right workspace. */
    wsId?: string;
    /** Index of this turn in the conversation, emitted as data-turn-index for snapshot selection. */
    turnIndex?: number;
    /** Called when user selects "Attach as context" from the right-click menu. */
    onAttachContext?: (turnIndex: number, role: 'user' | 'assistant', snippet: string) => void;
    /** Called when user deletes a turn (soft-delete). */
    onDeleteTurn?: (turnIndex: number) => void;
    /** Called when user pins/unpins a turn. */
    onPinTurn?: (turnIndex: number, pinned: boolean) => void;
    /** Called when user archives/unarchives a turn. */
    onArchiveTurn?: (turnIndex: number, archived: boolean) => void;
    /** Note edit snapshots from process.metadata.noteEdits — used to render NoteEditCard. */
    noteEdits?: Array<{
        editId: string;
        notePath: string;
        preEditContent: string;
        postEditContent?: string;
        timestamp: string;
        turnIndex: number;
        tooLarge?: boolean;
    }>;
    /** Process ID — needed for NoteEditCard undo API call. */
    processId?: string;
    /**
     * AI provider that produced the assistant turns (`copilot`, `codex`, or
     * `claude`). Controls the round avatar's color so it matches the
     * provider's brand palette (Copilot=green, Claude=orange, Codex=indigo).
     * Defaults to `copilot` (green) when omitted to preserve the legacy look.
     */
    provider?: ChatProvider;
}

interface RenderToolCall {
    id: string;
    toolName: string;
    name?: string;
    args: any;
    result?: string;
    error?: string;
    status?: string;
    startTime?: string;
    endTime?: string;
    parentToolCallId?: string;
}

type RenderChunk =
    | { kind: 'content';    key: string; html?: string; toolId?: string; parentToolId?: string }
    | { kind: 'tool';       key: string; html?: string; toolId?: string; parentToolId?: string }
    | {
        kind:         'tool-group';
        key:          string;
        category:     ToolGroupCategory;
        /** Ordered list of RenderToolCall IDs that are collapsed into this group. */
        toolIds:      string[];
        /** Absorbed single-line content messages (rendered inline when expanded). */
        contentItems: GroupContentItem[];
        /** Interleaved order of tools and content for faithful rendering. */
        orderedItems: GroupOrderedItem[];
        /** Epoch ms of the earliest startTime among grouped tools (undefined if none have timing). */
        startTime?:   number;
        /** Epoch ms of the latest endTime among grouped tools (undefined if any are still running). */
        endTime?:     number;
        /** true only when every tool in the group has status === 'completed'. */
        allSucceeded: boolean;
        parentToolId?: string;
      };

export function toContentHtml(content: string, wsId?: string, options?: { htmlEmbedEnabled?: boolean; excalidrawEmbedEnabled?: boolean }): string {
    return chatMarkdownToHtml(content, wsId, options);
}

function AttachedSessionContextBlockCard({ context }: { context: ParsedSessionContextBlock }) {
    const [copiedRawBlock, setCopiedRawBlock] = useState(false);

    const handleCopyRawBlock = async () => {
        try {
            await copyToClipboard(context.rawBlock);
            setCopiedRawBlock(true);
            setTimeout(() => setCopiedRawBlock(false), 1500);
        } catch (e) {
            console.error('Copy attached session context block failed:', e);
        }
    };

    return (
        <details
            className="rounded-lg border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] text-[12px] overflow-hidden"
            data-testid="attached-session-context-block"
        >
            <summary className="cursor-pointer select-none list-none px-3 py-2 flex items-center gap-2">
                <span aria-hidden="true">🧵</span>
                <span className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">Attached session context</span>
                <span className="min-w-0 flex-1 truncate text-[#616161] dark:text-[#a6a6a6]" data-testid="attached-session-context-summary">
                    {context.title}
                </span>
                <span className="shrink-0 rounded-full border border-[#d0d0d0] dark:border-[#3c3c3c] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[#616161] dark:text-[#a6a6a6]">
                    {context.status}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[#848484]" data-testid="attached-session-context-last-activity">
                    {context.lastActivityAt}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[#848484]">
                    {shortenSessionProcessId(context.sourceProcessId)}
                </span>
            </summary>
            <div className="border-t border-[#d0d0d0] dark:border-[#3c3c3c] px-3 py-2 space-y-2 text-[#3c3c3c] dark:text-[#c8c8c8]">
                <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-1">
                    <dt className="text-[#848484]">Title</dt>
                    <dd className="min-w-0 break-words">{context.title}</dd>
                    <dt className="text-[#848484]">Status</dt>
                    <dd className="font-mono">{context.status}</dd>
                    <dt className="text-[#848484]">Last activity</dt>
                    <dd className="font-mono break-all">{context.lastActivityAt}</dd>
                    <dt className="text-[#848484]">Process ID</dt>
                    <dd className="font-mono break-all" data-testid="attached-session-context-process-id">{context.sourceProcessId}</dd>
                    <dt className="text-[#848484]">Workspace ID</dt>
                    <dd className="font-mono break-all">{context.sourceWorkspaceId}</dd>
                </dl>
                <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[#848484]">Raw context block</span>
                        <button
                            type="button"
                            className="rounded border border-[#d0d0d0] dark:border-[#3c3c3c] px-2 py-0.5 text-[11px] text-[#616161] dark:text-[#c8c8c8] hover:bg-[#eeeeee] dark:hover:bg-[#333333]"
                            onClick={handleCopyRawBlock}
                            data-testid="attached-session-context-copy-raw"
                        >
                            {copiedRawBlock ? 'Copied' : 'Copy raw block'}
                        </button>
                    </div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] p-2 font-mono text-[11px]" data-testid="attached-session-context-raw-block">{context.rawBlock}</pre>
                </div>
            </div>
        </details>
    );
}

function formatContextCount(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

function AttachedRalphSessionContextBlockCard({ context }: { context: ParsedRalphSessionContextBlock }) {
    const [copiedRawBlock, setCopiedRawBlock] = useState(false);

    const handleCopyRawBlock = async () => {
        try {
            await copyToClipboard(context.rawBlock);
            setCopiedRawBlock(true);
            setTimeout(() => setCopiedRawBlock(false), 1500);
        } catch (e) {
            console.error('Copy attached Ralph session context block failed:', e);
        }
    };

    return (
        <details
            className="rounded-lg border border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/30 text-[12px] overflow-hidden"
            data-testid="attached-ralph-context-block"
        >
            <summary className="cursor-pointer select-none list-none px-3 py-2 flex items-center gap-2">
                <span aria-hidden="true">🔄</span>
                <span className="font-medium text-purple-800 dark:text-purple-200">Attached Ralph context</span>
                <span className="min-w-0 flex-1 truncate text-purple-800/80 dark:text-purple-200/80" data-testid="attached-ralph-context-summary">
                    {context.displayLabel}
                </span>
                <span className="shrink-0 rounded-full border border-purple-300 dark:border-purple-700 px-1.5 py-0.5 font-mono text-[10px] uppercase text-purple-700 dark:text-purple-300">
                    {context.phase}/{context.status}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-purple-700/80 dark:text-purple-300/80" data-testid="attached-ralph-context-counts">
                    {formatContextCount(context.processCount, 'process', 'processes')} · {formatContextCount(context.iterationCount, 'iteration', 'iterations')}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-purple-700/80 dark:text-purple-300/80" data-testid="attached-ralph-context-last-activity">
                    {context.lastActivityAt}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-purple-700/80 dark:text-purple-300/80">
                    {shortenSessionProcessId(context.sourceRalphSessionId)}
                </span>
            </summary>
            <div className="border-t border-purple-300 dark:border-purple-700 px-3 py-2 space-y-2 text-[#3c3c3c] dark:text-[#c8c8c8]">
                <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-1">
                    <dt className="text-purple-700 dark:text-purple-300">Title</dt>
                    <dd className="min-w-0 break-words">{context.title}</dd>
                    <dt className="text-purple-700 dark:text-purple-300">Display label</dt>
                    <dd className="min-w-0 break-words">{context.displayLabel}</dd>
                    <dt className="text-purple-700 dark:text-purple-300">Phase</dt>
                    <dd className="font-mono">{context.phase}</dd>
                    <dt className="text-purple-700 dark:text-purple-300">Status</dt>
                    <dd className="font-mono">{context.status}</dd>
                    <dt className="text-purple-700 dark:text-purple-300">Last activity</dt>
                    <dd className="font-mono break-all">{context.lastActivityAt}</dd>
                    <dt className="text-purple-700 dark:text-purple-300">Ralph session ID</dt>
                    <dd className="font-mono break-all" data-testid="attached-ralph-context-session-id">{context.sourceRalphSessionId}</dd>
                    <dt className="text-purple-700 dark:text-purple-300">Workspace ID</dt>
                    <dd className="font-mono break-all">{context.sourceWorkspaceId}</dd>
                    <dt className="text-purple-700 dark:text-purple-300">Processes</dt>
                    <dd className="font-mono break-all">{context.processCount}</dd>
                    <dt className="text-purple-700 dark:text-purple-300">Iterations</dt>
                    <dd className="font-mono break-all">{context.iterationCount}</dd>
                    <dt className="text-purple-700 dark:text-purple-300">Child process IDs</dt>
                    <dd className="font-mono break-all" data-testid="attached-ralph-context-child-process-ids">
                        {context.childProcessIds.join(', ')}
                    </dd>
                </dl>
                <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-purple-700 dark:text-purple-300">Raw context block</span>
                        <button
                            type="button"
                            className="rounded border border-purple-300 dark:border-purple-700 px-2 py-0.5 text-[11px] text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40"
                            onClick={handleCopyRawBlock}
                            data-testid="attached-ralph-context-copy-raw"
                        >
                            {copiedRawBlock ? 'Copied' : 'Copy raw block'}
                        </button>
                    </div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-purple-200 dark:border-purple-800 bg-white dark:bg-[#1e1e1e] p-2 font-mono text-[11px]" data-testid="attached-ralph-context-raw-block">{context.rawBlock}</pre>
                </div>
            </div>
        </details>
    );
}

function AttachedContextBlockCard({ context }: { context: ParsedAttachedContextBlock }) {
    return context.kind === 'ralph-session'
        ? <AttachedRalphSessionContextBlockCard context={context} />
        : <AttachedSessionContextBlockCard context={context} />;
}

function normalizeToolCall(raw: any, fallbackId: string): RenderToolCall {
    const normalized = normalizeToolForDisplay(raw ?? {});
    const rawId = raw?.id || raw?.toolCallId || raw?.tool_call_id;

    return {
        id: typeof rawId === 'string' && rawId ? rawId : fallbackId,
        toolName: normalized.toolName,
        name: typeof raw?.name === 'string' ? raw.name : undefined,
        args: normalized.args,
        result: raw?.result,
        error: raw?.error,
        status: raw?.status || 'pending',
        startTime: raw?.startTime,
        endTime: raw?.endTime,
        parentToolCallId: raw?.parentToolCallId || raw?.parent_tool_call_id,
    };
}

function mergeToolCall(target: RenderToolCall, incoming: RenderToolCall): void {
    if ((!target.toolName || target.toolName === 'unknown') && incoming.toolName) {
        target.toolName = incoming.toolName;
    }
    if ((!target.name || target.name === 'unknown') && incoming.name) {
        target.name = incoming.name;
    }
    if (incoming.args != null) {
        const shouldReplaceArgs =
            typeof incoming.args !== 'object' ||
            incoming.args === null ||
            Object.keys(incoming.args).length > 0;
        if (shouldReplaceArgs) {
            target.args = incoming.args;
        }
    }
    if (incoming.status) target.status = incoming.status;
    if (incoming.result !== undefined) target.result = incoming.result;
    if (incoming.error !== undefined) target.error = incoming.error;
    if (incoming.startTime && !target.startTime) target.startTime = incoming.startTime;
    if (incoming.endTime) target.endTime = incoming.endTime;
    if (incoming.parentToolCallId && !target.parentToolCallId) {
        target.parentToolCallId = incoming.parentToolCallId;
    }
}

/**
 * Merge consecutive content chunks into a single chunk to avoid rendering
 * multiple bordered boxes for text that is logically one message.
 * Non-content chunks (e.g. hidden tool calls like report_intent) act as
 * potential separators in the array but should not break the visual flow.
 */
export function mergeConsecutiveContentChunks(chunks: RenderChunk[]): RenderChunk[] {
    if (chunks.length === 0) return chunks;

    const result: RenderChunk[] = [];
    let pendingHtml = '';
    let pendingKey = '';
    let pendingParentToolId: string | undefined;

    const flush = () => {
        if (pendingKey) {
            result.push({ kind: 'content', key: pendingKey, html: pendingHtml, parentToolId: pendingParentToolId });
            pendingHtml = '';
            pendingKey = '';
            pendingParentToolId = undefined;
        }
    };

    for (const chunk of chunks) {
        if (chunk.kind === 'content' && chunk.html) {
            if (!pendingKey) {
                pendingKey = chunk.key;
                pendingParentToolId = chunk.parentToolId;
            }
            pendingHtml += chunk.html;
        } else {
            flush();
            result.push(chunk);
        }
    }

    flush();
    return result;
}

function removeFromTaskStack(activeTaskStack: string[], toolCallId: string): void {
    const idx = activeTaskStack.lastIndexOf(toolCallId);
    if (idx >= 0) {
        activeTaskStack.splice(idx, 1);
    }
}

function toMillis(iso?: string): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : null;
}

/**
 * Infer parent relationships when events do not include explicit parent IDs.
 * Uses interval-based lookup: a non-task tool is assigned to a task only when
 * exactly one enclosing task interval exists. Ambiguous cases (multiple
 * overlapping tasks, e.g. parallel tasks) are left unassigned.
 * Task-to-task relationships are never inferred — they must come from the SDK.
 */
export function inferParentToolCalls(
    calls: RenderToolCall[],
    options?: { enableTrailingTaskFallback?: boolean }
): RenderToolCall[] {
    const enableTrailingTaskFallback = options?.enableTrailingTaskFallback ?? true;
    const cloned = calls.map((call) => ({ ...call }));
    const ordered = cloned.map((call, originalIndex) => ({
        call,
        originalIndex,
        startMs: toMillis(call.startTime),
        endMs: toMillis(call.endTime),
    }));

    ordered.sort((a, b) => {
        const aKey = a.startMs ?? Number.MAX_SAFE_INTEGER;
        const bKey = b.startMs ?? Number.MAX_SAFE_INTEGER;
        if (aKey !== bKey) return aKey - bKey;
        return a.originalIndex - b.originalIndex;
    });

    // Collect task intervals for interval-based parent lookup
    const taskIntervals: Array<{ id: string; startMs: number | null; endMs: number | null }> = [];
    for (const item of ordered) {
        if (item.call.toolName === 'task') {
            taskIntervals.push({ id: item.call.id, startMs: item.startMs, endMs: item.endMs });
        }
    }

    for (const item of ordered) {
        const call = item.call;
        if (call.parentToolCallId) continue; // Already has explicit parent
        if (call.toolName === 'task' || call.toolName === 'read_agent') continue; // Never auto-nest stack-managed tools
        const currentStart = item.startMs;
        if (currentStart == null) continue;

        // Find task intervals that enclose this tool call's start time
        const enclosing = taskIntervals.filter((t) => {
            if (t.id === call.id) return false;
            if (t.startMs == null || t.startMs > currentStart) return false;
            // Task still running (no endMs) or ends after this call started
            if (t.endMs != null && t.endMs <= currentStart) return false;
            return true;
        });

        if (enclosing.length === 1) {
            call.parentToolCallId = enclosing[0].id;
        }
        // Multiple enclosing tasks (parallel) → ambiguous, leave unassigned
    }

    if (enableTrailingTaskFallback) {
        // Fallback for records that lack reliable timing: bind trailing calls to the latest task.
        let lastTaskId: string | undefined;
        for (const call of cloned) {
            if (call.toolName === 'task') {
                lastTaskId = call.id;
                continue;
            }
            if (call.toolName === 'read_agent') continue; // read_agent manages its own nesting
            if (!call.parentToolCallId && lastTaskId) {
                call.parentToolCallId = lastTaskId;
            }
        }
    }

    return cloned;
}

function buildToolDepthMap(calls: RenderToolCall[]): Map<string, number> {
    const byId = new Map<string, RenderToolCall>();
    for (const call of calls) {
        byId.set(call.id, call);
    }

    const memo = new Map<string, number>();
    const visiting = new Set<string>();

    const getDepth = (id: string): number => {
        if (memo.has(id)) return memo.get(id)!;
        if (visiting.has(id)) return 0;

        visiting.add(id);
        const call = byId.get(id);
        if (!call) {
            visiting.delete(id);
            memo.set(id, 0);
            return 0;
        }

        const parentId = call.parentToolCallId;
        let depth = 0;
        if (parentId && parentId !== id && byId.has(parentId)) {
            depth = Math.min(getDepth(parentId) + 1, 8);
        }
        visiting.delete(id);
        memo.set(id, depth);
        return depth;
    };

    const depthMap = new Map<string, number>();
    for (const call of calls) {
        depthMap.set(call.id, getDepth(call.id));
    }

    return depthMap;
}

function buildAssistantRender(turn: ClientConversationTurn, wsId?: string, options?: { htmlEmbedEnabled?: boolean; excalidrawEmbedEnabled?: boolean }): {
    chunks: RenderChunk[];
    chunksByParent: Map<string, RenderChunk[]>;
    toolById: Map<string, RenderToolCall>;
    toolDepthById: Map<string, number>;
    toolParentById: Map<string, string>;
    toolsWithChildren: Set<string>;
} {
    const chunks: RenderChunk[] = [];
    const timeline = mergeConsecutiveContentItems(Array.isArray(turn.timeline) ? turn.timeline : []);
    let hasContent = false;

    const callsById = new Map<string, RenderToolCall>();
    const callOrder: string[] = [];
    const activeTaskStack: string[] = [];
    let hasTimelineToolEvents = false;
    // Track content texts rendered inline so we can suppress duplicate tool results.
    // This handles the case where a sub-agent (e.g. explore task) streams its output as a
    // content event and the SDK also surfaces the same text as the tool-complete result.
    const renderedContentTexts = new Set<string>();

    for (let i = 0; i < timeline.length; i++) {
        const item: any = timeline[i];
        if (!item) continue;

        if (item.type === 'content') {
            const html = toContentHtml(item.content || '', wsId, options);
            if (html) {
                const parentToolId = activeTaskStack.length > 0
                    ? activeTaskStack[activeTaskStack.length - 1]
                    : undefined;
                chunks.push({ kind: 'content', key: `content-${i}`, html, parentToolId });
                hasContent = true;
                // Only track inline content (no parentToolId). Content inside a task card is
                // skipped from inline rendering (line 832), so it should not suppress the task's result.
                if (item.content && !parentToolId) renderedContentTexts.add((item.content as string).trim());
            }
            continue;
        }

        if (typeof item.type === 'string' && item.type.startsWith('tool-') && item.toolCall) {
            hasTimelineToolEvents = true;
            const incoming = normalizeToolCall(item.toolCall, `tool-${i}`);
            const activeParent = activeTaskStack.length > 0
                ? activeTaskStack[activeTaskStack.length - 1]
                : undefined;

            // Timeline order is the most reliable signal for non-task tool nesting.
            // Task-to-task relationships are trusted from SDK parentToolCallId only;
            // auto-nesting tasks/read_agent creates false chains when tasks run in parallel.
            const isStackManaged = incoming.toolName === 'task' || incoming.toolName === 'read_agent';
            if (!incoming.parentToolCallId && activeParent && !isStackManaged) {
                incoming.parentToolCallId = activeParent;
            }

            const existing = callsById.get(incoming.id);
            if (existing) {
                mergeToolCall(existing, incoming);
            } else {
                callsById.set(incoming.id, incoming);
                callOrder.push(incoming.id);
                chunks.push({ kind: 'tool', key: `tool-${incoming.id}`, toolId: incoming.id });
            }

            if (item.type === 'tool-start' && isStackManaged) {
                removeFromTaskStack(activeTaskStack, incoming.id);
                activeTaskStack.push(incoming.id);
            } else if ((item.type === 'tool-complete' || item.type === 'tool-failed') && isStackManaged) {
                removeFromTaskStack(activeTaskStack, incoming.id);
            }
        }
    }

    // Suppress tool results that are already shown as inline content to avoid duplication.
    for (const call of callsById.values()) {
        if (call.result && typeof call.result === 'string' && renderedContentTexts.has(call.result.trim())) {
            call.result = undefined;
        }
    }

    if (callOrder.length === 0 && Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0) {
        for (let i = 0; i < turn.toolCalls.length; i++) {
            const normalized = normalizeToolCall(turn.toolCalls[i], `toolcalls-${i}`);
            callsById.set(normalized.id, normalized);
            callOrder.push(normalized.id);
        }
    }

    const orderedCalls = callOrder
        .map((id) => callsById.get(id))
        .filter((call): call is RenderToolCall => Boolean(call));
    const inferred = inferParentToolCalls(orderedCalls, {
        enableTrailingTaskFallback: !hasTimelineToolEvents,
    });
    const inferredById = new Map<string, RenderToolCall>();
    inferred.forEach((call) => inferredById.set(call.id, call));
    const toolDepthById = buildToolDepthMap(inferred);
    const toolParentById = new Map<string, string>();
    const toolsWithChildren = new Set<string>();

    for (const call of inferred) {
        const parentId = call.parentToolCallId;
        if (parentId && parentId !== call.id && inferredById.has(parentId)) {
            toolParentById.set(call.id, parentId);
            toolsWithChildren.add(parentId);
        }
    }

    const chunksByParent = new Map<string, RenderChunk[]>();
    for (const chunk of chunks) {
        const parentId = chunk.kind === 'tool'
            ? (chunk.toolId ? toolParentById.get(chunk.toolId) : undefined)
            : (chunk.parentToolId && inferredById.has(chunk.parentToolId) ? chunk.parentToolId : undefined);
        if (!parentId) continue;
        if (!chunksByParent.has(parentId)) {
            chunksByParent.set(parentId, []);
        }
        chunksByParent.get(parentId)!.push(chunk);
        toolsWithChildren.add(parentId);
    }

    if (!hasContent) {
        const fallbackHtml = toContentHtml(turn.content || '', wsId, options);
        if (fallbackHtml) {
            chunks.unshift({ kind: 'content', key: 'content-fallback', html: fallbackHtml });
        }
    }

    if (!chunks.some((chunk) => chunk.kind === 'tool') && inferred.length > 0) {
        for (const call of inferred) {
            chunks.push({ kind: 'tool', key: `tool-${call.id}`, toolId: call.id });
        }
    }

    return {
        chunks,
        chunksByParent,
        toolById: inferredById,
        toolDepthById,
        toolParentById,
        toolsWithChildren,
    };
}

function buildRawContent(turn: ClientConversationTurn): string {
    const parts: string[] = [];
    if (turn.content) {
        parts.push(turn.content);
    }

    const toolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
    const timeline = Array.isArray(turn.timeline) ? turn.timeline : [];

    // Collect tool calls from timeline or fallback to turn.toolCalls
    const seen = new Set<string>();
    const allCalls: Array<{ toolName: string; status?: string; args: any; result?: string; error?: string }> = [];

    for (const item of timeline) {
        if (item?.toolCall) {
            const tc = item.toolCall;
            const id = tc.id || '';
            if (id && seen.has(id)) {
                // Merge: update status/result/error on existing entry
                const existing = allCalls.find((c) => (c as any)._id === id);
                if (existing) {
                    if (tc.status) existing.status = tc.status;
                    if (tc.result !== undefined) existing.result = tc.result;
                    if (tc.error !== undefined) existing.error = tc.error;
                }
                continue;
            }
            if (id) seen.add(id);
            allCalls.push({ toolName: (tc as any).name || tc.toolName || 'unknown', status: tc.status, args: tc.args, result: tc.result, error: tc.error, _id: id } as any);
        }
    }

    if (allCalls.length === 0) {
        for (const tc of toolCalls) {
            allCalls.push({ toolName: (tc as any).name || tc.toolName || 'unknown', status: tc.status, args: tc.args, result: tc.result, error: tc.error });
        }
    }

    for (const call of allCalls) {
        parts.push('');
        parts.push(`--- tool: ${call.toolName} [${call.status || 'pending'}] ---`);
        if (call.args) {
            const argsStr = typeof call.args === 'string' ? call.args : JSON.stringify(call.args, null, 2);
            parts.push(`Args: ${argsStr}`);
        }
        if (call.result !== undefined) {
            const resultStr = typeof call.result === 'string'
                ? (call.result.length > 2000 ? call.result.slice(0, 2000) + '\n... (truncated)' : call.result)
                : JSON.stringify(call.result, null, 2);
            parts.push(`Result: ${resultStr}`);
        }
        if (call.error !== undefined) {
            parts.push(`Error: ${call.error}`);
        }
    }

    return parts.join('\n');
}

export { buildRawContent as _buildRawContent };

/** Format elapsed milliseconds into a human-friendly string. */
export function formatCostTime(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    return `${minutes}m ${seconds}s`;
}

/** Format a timestamp into a compact MM/DD h:mm AM/PM string. */
export function formatShortTimestamp(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    let hours = date.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes} ${ampm}`;
}

function fmtTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

/** Merged badge showing token usage and response time in a single compact chip. */
function AssistantStatsBadge({ tokenUsage, costTimeMs }: { tokenUsage?: ClientTokenUsage; costTimeMs?: number }) {
    const [expanded, setExpanded] = useState(false);

    // Token usage can arrive partially populated (e.g. an SSE token-usage event
    // that only carries context-window fields, or an SDK result without a full
    // per-turn breakdown). Coerce each numeric field so a missing value never
    // throws on .toLocaleString()/fmtTokens and crashes the whole dashboard.
    const inputTokens = tokenUsage?.inputTokens ?? 0;
    const outputTokens = tokenUsage?.outputTokens ?? 0;
    const cacheReadTokens = tokenUsage?.cacheReadTokens ?? 0;
    const cacheWriteTokens = tokenUsage?.cacheWriteTokens ?? 0;
    const totalTokens = tokenUsage?.totalTokens ?? inputTokens + outputTokens;

    const parts: string[] = [];
    if (tokenUsage) parts.push(`↓${fmtTokens(inputTokens)} ↑${fmtTokens(outputTokens)}`);
    if (costTimeMs != null) parts.push(formatCostTime(costTimeMs));
    const summary = parts.join(' · ');

    const detailParts: string[] = [];
    if (tokenUsage) {
        detailParts.push(`Input: ${inputTokens.toLocaleString()}`);
        detailParts.push(`Output: ${outputTokens.toLocaleString()}`);
        if (cacheReadTokens > 0) detailParts.push(`Cache read: ${cacheReadTokens.toLocaleString()}`);
        if (cacheWriteTokens > 0) detailParts.push(`Cache write: ${cacheWriteTokens.toLocaleString()}`);
        detailParts.push(`Total: ${totalTokens.toLocaleString()}`);
    }
    if (costTimeMs != null) detailParts.push(`Time: ${costTimeMs.toLocaleString()}ms`);
    const detail = detailParts.join(' · ');

    if (!summary) return null;

    return (
        <button
            className="assistant-stats-badge inline-flex items-center px-1.5 py-0.5 rounded text-[10px] tabular-nums bg-[#f0f0f0] dark:bg-[#2d2d2d] text-[#848484] hover:bg-[#e8e8e8] dark:hover:bg-[#383838] transition-colors cursor-pointer border border-transparent hover:border-[#d0d0d0] dark:hover:border-[#505050]"
            title={expanded ? 'Click to collapse' : detail}
            onClick={() => setExpanded(v => !v)}
        >
            {expanded ? detail : summary}
        </button>
    );
}

export function ConversationTurnBubble({ turn, taskId, onRetry, processType, wsId, turnIndex, onAttachContext, onDeleteTurn, onPinTurn, onArchiveTurn, noteEdits, processId, provider }: ConversationTurnBubbleProps) {
    const isUser = turn.role === 'user';
    const isScript = !isUser && processType === TaskDefs.runScript.kind;
    const { showReportIntent, toolCompactness, groupSingleLineMessages } = useDisplaySettings();
    const htmlEmbedEnabled = useHtmlEmbedPreference(wsId) && !turn.streaming;
    const excalidrawEmbedEnabled = SHOW_EXCALIDRAW_DIAGRAMS && isExcalidrawEnabled() && !turn.streaming;
    const assistantRender = useMemo(
        () => isUser ? null : buildAssistantRender(turn, wsId, { htmlEmbedEnabled, excalidrawEmbedEnabled }),
        // turn.timeline + turn.content drive the markdown HTML; embed flags toggle inline-HTML/excalidraw rendering.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [isUser, turn.timeline, turn.content, turn.streaming, wsId, htmlEmbedEnabled, excalidrawEmbedEnabled],
    );
    const parsedUserContent = useMemo(
        () => isUser ? parseAttachedSessionContextBlocks(turn.content || '') : { attachedContexts: [], sessionContexts: [], ralphSessionContexts: [], remainingContent: '' },
        [isUser, turn.content],
    );
    const userContentText = isUser ? parsedUserContent.remainingContent : '';
    const userContentHtml = useMemo(() => {
        if (!isUser || !userContentText.trim()) return '';
        // Split on backtick-delimited segments so paths inside inline code are not linkified.
        // Segments at even indices are normal text; odd indices are code spans.
        const parts = userContentText.split(/`([^`]*)`/);
        return parts.map((part, i) => {
            if (i % 2 === 1) {
                // Code span — escape only, no linkification
                return `<code>${escapeHtml(part)}</code>`;
            }
            return linkifyFilePaths(escapeHtml(part));
        }).join('');
    }, [isUser, userContentText]);

    // Lazy image fetching state
    const [imageLoadState, setImageLoadState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
    const [fetchedImages, setFetchedImages] = useState<string[]>([]);

    const hasInlineImages = turn.images && turn.images.length > 0;
    const needsLazyImages = isUser && !hasInlineImages && !!taskId && (turn.imagesCount ?? 0) > 0;

    const handleLoadImages = async () => {
        if (!taskId) return;
        setImageLoadState('loading');
        try {
            const data = await getSpaCocClient().queue.images(taskId);
            setFetchedImages(data.images || []);
            setImageLoadState('loaded');
        } catch {
            setImageLoadState('error');
        }
    };

    const [collapsedTaskIds, setCollapsedTaskIds] = useState<Record<string, boolean>>({});
    const [showRaw, setShowRaw] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copiedHtml, setCopiedHtml] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    }, []);

    const contextMenuItems = useMemo((): ContextMenuItem[] => {
        const items: ContextMenuItem[] = [];
        if (onAttachContext && turnIndex != null) {
            items.push({
                label: 'Attach as context',
                icon: '📎',
                onClick: () => {
                    const selection = window.getSelection();
                    const selectedText = selection && selection.toString().trim();
                    const snippet = selectedText || turn.content || '';
                    if (snippet) {
                        onAttachContext(turnIndex, turn.role as 'user' | 'assistant', snippet);
                    }
                },
            });
            items.push({ label: '', separator: true, onClick: () => {} });
        }
        items.push({
            label: 'Copy',
            icon: '📋',
            onClick: async () => {
                const text = showRaw ? buildRawContent(turn) : (turn.content || '');
                try { await copyToClipboard(text); } catch {}
            },
        });
        items.push({
            label: 'Copy as HTML',
            icon: '📄',
            onClick: async () => {
                try {
                    const html = chatMarkdownToHtml(turn.content || '', wsId, { htmlEmbedEnabled, excalidrawEmbedEnabled });
                    await copyHtmlToClipboard(html);
                } catch {}
            },
        });
        // Per-message actions: Pin, Archive, Delete
        if (turnIndex != null) {
            items.push({ label: '', separator: true, onClick: () => {} });
            if (onPinTurn) {
                items.push({
                    label: turn.pinnedAt ? 'Unpin' : 'Pin',
                    icon: turn.pinnedAt ? '📌' : '📌',
                    onClick: () => onPinTurn(turnIndex, !turn.pinnedAt),
                });
            }
            if (onArchiveTurn) {
                items.push({
                    label: turn.archived ? 'Unarchive' : 'Archive',
                    icon: turn.archived ? '📂' : '🗄️',
                    onClick: () => onArchiveTurn(turnIndex, !turn.archived),
                });
            }
            if (onDeleteTurn) {
                items.push({
                    label: 'Delete',
                    icon: '🗑️',
                    onClick: () => onDeleteTurn(turnIndex),
                });
            }
        }
        return items;
    }, [onAttachContext, turnIndex, turn, showRaw, wsId, onPinTurn, onArchiveTurn, onDeleteTurn]);

    // Detect pure-JSON assistant responses (only when stream is complete).
    const jsonDetected = useMemo(() => {
        if (isUser || turn.streaming || !turn.content) return false;
        return isJsonResponse(turn.content);
    }, [isUser, turn.streaming, turn.content]);
    const [viewMode, setViewMode] = useState<'json' | 'rendered'>('json');

    // Parse run-script bodies once per turn so the terminal block + exit-code
    // suffix in the header stay consistent.
    const parsedScript = useMemo(
        () => (isScript ? parseScriptOutput(turn.content || '') : null),
        [isScript, turn.content],
    );
    const scriptExitLabel = parsedScript ? describeScriptExit(parsedScript) : undefined;

    // Pre-compute section markdown slices for section-level copy buttons on assistant turns.
    const sectionMarkdown = useMemo(() => {
        if (isUser || !turn.content) return undefined;
        const sections = splitMarkdownSections(turn.content);
        // Only show section copy when there are multiple sections with headings.
        const headingSections = sections.filter(s => s.level > 0);
        return headingSections.length >= 1 ? sections : undefined;
    }, [isUser, turn.content]);

    const displayChunks = useMemo(() => {
        if (!assistantRender) return [];
        if (toolCompactness < 1) return assistantRender.chunks;
        // Exclude both parent tools (rendered as expandable trees) and
        // child tools (rendered under their parent) from grouping.
        const excludeFromGrouping = new Set([
            ...assistantRender.toolsWithChildren,
            ...assistantRender.toolParentById.keys(),
        ]);
        const grouped = groupConsecutiveToolChunks(
            assistantRender.chunks,
            assistantRender.toolById,
            excludeFromGrouping,
            { groupSingleLineMessages },
        );
        if (toolCompactness === 3) {
            return filterWhisperChunks(grouped, assistantRender.toolById);
        }
        return grouped;
    }, [assistantRender, toolCompactness, groupSingleLineMessages]);

    function renderToolTree(toolId: string, depth: number): React.ReactNode {
        if (depth > 20) return null;
        const toolCall = assistantRender!.toolById.get(toolId);
        if (!toolCall) return null;

        // Handle report_intent tool calls
        if (toolCall.toolName === 'report_intent') {
            if (!showReportIntent) return null;
            const intentText = typeof toolCall.args === 'object' && toolCall.args?.intent
                ? String(toolCall.args.intent)
                : typeof toolCall.args === 'string'
                    ? (() => { try { return JSON.parse(toolCall.args).intent || ''; } catch { return ''; } })()
                    : '';
            return (
                <div
                    key={toolId}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#f0f0f0] dark:bg-[#2d2d2d] text-xs italic text-[#848484] max-w-full"
                    title="report_intent"
                >
                    <span>🏷</span>
                    <span className="truncate">{intentText || 'Intent logged'}</span>
                </div>
            );
        }

        // Hide suggest_follow_ups — its output is rendered as suggestion chips, not as a tool call.
        if (toolCall.toolName === 'suggest_follow_ups') return null;

        if (hasAskUserHistory(toolCall)) {
            return <AskUserHistoryCard key={toolId} toolCall={toolCall} />;
        }

        const childChunks = assistantRender!.chunksByParent.get(toolId) ?? [];
        const hasSubtools = childChunks.length > 0;
        const isCollapsed = collapsedTaskIds[toolId] ?? true;
        return (
            <ToolCallView
                key={toolId}
                toolCall={toolCall}
                depth={depth}
                hasSubtools={hasSubtools}
                subtoolsCollapsed={isCollapsed}
                onToggleSubtools={() =>
                    setCollapsedTaskIds((prev) => ({ ...prev, [toolId]: !(prev[toolId] ?? true) }))
                }
            >
                {hasSubtools
                    ? (() => {
                        const nodes: React.ReactNode[] = [];
                        let accHtml = '';
                        let accKey = '';
                        const flushContent = () => {
                            if (accKey && accHtml) {
                                nodes.push(<MarkdownView key={accKey} html={accHtml} />);
                                accHtml = '';
                                accKey = '';
                            }
                        };
                        for (const childChunk of childChunks) {
                            if (childChunk.kind === 'content' && childChunk.html) {
                                if (!accKey) accKey = childChunk.key;
                                accHtml += childChunk.html;
                            } else if (childChunk.kind === 'tool' && childChunk.toolId) {
                                const toolNode = renderToolTree(childChunk.toolId, depth + 1);
                                if (toolNode !== null) {
                                    flushContent();
                                    nodes.push(toolNode);
                                }
                            }
                        }
                        flushContent();
                        return nodes;
                    })()
                    : undefined}
            </ToolCallView>
        );
    }

    return (
        <div className={cn(
            'flex', isUser ? 'justify-end' : 'justify-start',
            'chat-message', isUser ? 'user' : 'assistant',
            turn.streaming && 'streaming',
            turn.isError && 'error',
            turn.archived && 'opacity-50',
            turn.deletedAt && 'opacity-30 line-through',
            'py-1.5'
        )}
            {...(wsId ? { 'data-ws-id': wsId } : {})}
            {...(turnIndex != null ? { 'data-turn-index': turnIndex } : {})}
            onContextMenu={handleContextMenu}
        >
            {contextMenu && (
                <ContextMenu
                    position={contextMenu}
                    items={contextMenuItems}
                    onClose={() => setContextMenu(null)}
                />
            )}
            {!isUser && (
                <span
                    className={cn(
                        'turn-avatar flex-shrink-0 mt-0.5 mr-3 inline-flex items-center justify-center w-6 h-6 rounded-full select-none border',
                        isScript
                            ? 'bg-[#1e1e1e] text-[#d4d4d4] border-[#000] font-mono text-[10px]'
                            : turn.isError
                                ? 'bg-[#ffebe9] text-[#cf222e] border-[#f5c2c2] dark:bg-[#3a1a1a] dark:text-[#f87171] dark:border-[#7a3030] text-[11.5px] font-semibold'
                                : cn(getProviderAvatarClasses(provider), 'text-[11.5px] font-semibold')
                    )}
                    title={isScript ? 'Script Output' : turn.isError ? 'Assistant — error' : 'Assistant'}
                    aria-hidden="true"
                    data-provider={isScript || turn.isError ? undefined : (provider ?? 'copilot')}
                >
                    {isScript ? '$_' : 'C'}
                </span>
            )}
            <div
                className={cn(
                    'group min-w-0 relative',
                    isUser
                        ? cn(
                            'turn-bubble max-w-[85%] sm:max-w-[78%] rounded-2xl px-3.5 py-2',
                            turn.pinnedAt
                                ? 'bg-[#fff8c5] dark:bg-[#3a3520] border border-[#f0d878] dark:border-[#a08020]'
                                : 'bg-[#f3f4f6] dark:bg-[#2a2a2c]'
                        )
                        : 'turn-body flex-1 min-w-0'
                )}
            >
                <div
                    className={cn(
                        'flex items-center flex-nowrap gap-1.5 text-[11px] text-[#848484] mb-1',
                        isUser
                            ? 'absolute -top-4 right-2 z-10 px-1 bg-transparent opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none [&>*]:pointer-events-auto'
                            : 'min-h-[16px]'
                    )}
                >
                    {!isUser && turn.pinnedAt && (
                        <span className="text-amber-500 dark:text-amber-400" title="Pinned">📌</span>
                    )}
                    <span
                        className={cn(
                            'role-label min-w-0 truncate sr-only'
                        )}
                    >
                        {isUser ? 'You' : isScript ? 'Script Output' : 'Assistant'}
                    </span>
                    {turn.timestamp && (() => {
                        const d = new Date(turn.timestamp);
                        return (
                            <span className="ml-auto timestamp whitespace-nowrap font-mono tabular-nums" title={d.toLocaleString()}>
                                {formatShortTimestamp(d)}
                            </span>
                        );
                    })()}
                    {isScript && scriptExitLabel && (
                        <>
                            <span className="text-[#9aa0a6]" aria-hidden="true">·</span>
                            <span
                                className={cn(
                                    'script-exit whitespace-nowrap font-mono tabular-nums',
                                    parsedScript?.status === 'success'
                                        ? 'text-[#15703a] dark:text-[#4ade80]'
                                        : parsedScript?.status === 'failed' || parsedScript?.status === 'timeout'
                                            ? 'text-[#cf222e] dark:text-[#f87171]'
                                            : 'text-[#848484]'
                                )}
                                data-testid="script-exit-label"
                                title={parsedScript?.durationMs != null ? `${parsedScript.durationMs}ms` : undefined}
                            >
                                {scriptExitLabel}
                            </span>
                        </>
                    )}
                    {turn.streaming && (
                        <span className="text-[#f14c4c] streaming-indicator inline-flex items-center gap-1 uppercase tracking-wide font-mono text-[10px]">Live</span>
                    )}
                    {!isUser && !turn.streaming && (turn.tokenUsage || turn.costTimeMs != null) && (
                        <AssistantStatsBadge tokenUsage={turn.tokenUsage} costTimeMs={turn.costTimeMs} />
                    )}
                    {jsonDetected && !showRaw && (
                        <button
                            className="bubble-json-toggle-btn ml-auto text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-medium"
                            title={viewMode === 'json' ? 'Switch to rendered markdown' : 'Switch to JSON tree view'}
                            onClick={() => setViewMode(v => v === 'json' ? 'rendered' : 'json')}
                            style={viewMode === 'json' ? { opacity: 1, color: '#0078d4' } : undefined}
                            data-testid="json-toggle-btn"
                        >
                            {viewMode === 'json' ? 'JSON' : 'Rendered'}
                        </button>
                    )}
                    <button
                        className={`bubble-raw-btn ${!jsonDetected || showRaw ? 'ml-auto' : ''} text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] opacity-0 group-hover:opacity-100 transition-opacity text-[10px]`}
                        title={showRaw ? 'View rendered content' : 'View raw content'}
                        onClick={() => setShowRaw((v) => !v)}
                        style={showRaw ? { opacity: 1, color: '#0078d4' } : undefined}
                    >
                        &lt;/&gt;
                    </button>
                    <button
                        className="bubble-copy-btn text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
                        title="Copy to clipboard"
                        onClick={async () => {
                            const text = showRaw ? buildRawContent(turn) : (turn.content || '');
                            try {
                                await copyToClipboard(text);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 1500);
                            } catch (e) {
                                console.error('Copy failed:', e);
                            }
                        }}
                    >
                        {copied ? '✓' : '📋'}
                    </button>
                    {!showRaw && (
                        <button
                            className="bubble-copy-html-btn text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
                            title="Copy as HTML"
                            onClick={async () => {
                                try {
                                    const html = chatMarkdownToHtml(turn.content || '', wsId, { htmlEmbedEnabled, excalidrawEmbedEnabled });
                                    await copyHtmlToClipboard(html);
                                    setCopiedHtml(true);
                                    setTimeout(() => setCopiedHtml(false), 1500);
                                } catch (e) {
                                    console.error('Copy HTML failed:', e);
                                }
                            }}
                        >
                            {copiedHtml ? '✓' : 'HTML'}
                        </button>
                    )}
                </div>

                {isUser && turn.pinnedAt && (
                    <span
                        className="absolute -left-5 top-2 text-amber-500 dark:text-amber-400 text-[11px] select-none"
                        title="Pinned"
                        aria-hidden="true"
                    >
                        📌
                    </span>
                )}

                <div className="space-y-2 chat-message-content">
                    {!isUser && turn.isError && (
                        <aside
                            className={cn(
                                'error-indicator error-strip flex items-start gap-2.5',
                                'rounded-md border px-3 py-2.5',
                                'border-[#f5c2c2] bg-[#ffebe9]',
                                'dark:border-[#7a3030] dark:bg-[#3a1a1a]',
                            )}
                            role="alert"
                            data-testid="error-strip"
                        >
                            <span
                                className="err-icon shrink-0 text-[#cf222e] dark:text-[#f87171] text-[14px] leading-[1.4] select-none"
                                aria-hidden="true"
                            >
                                ⚠
                            </span>
                            <div className="err-body flex-1 min-w-0">
                                <div
                                    className="err-title text-[12.5px] font-semibold text-[#cf222e] dark:text-[#f87171] mb-0.5"
                                    data-testid="error-strip-title"
                                >
                                    Stream interrupted
                                </div>
                                {turn.content && (
                                    <div
                                        className="err-detail text-[12.5px] leading-snug text-[#2c2f33] dark:text-[#cccccc] [&_code]:font-mono [&_code]:text-[12px] [&_code]:px-1 [&_code]:py-[1px] [&_code]:rounded [&_code]:bg-[#fff] dark:[&_code]:bg-[#1e1e1e] [&_code]:border [&_code]:border-[#f5c2c2] dark:[&_code]:border-[#7a3030]"
                                        data-testid="error-strip-detail"
                                    >
                                        <MarkdownView html={chatMarkdownToHtml(turn.content, wsId, { htmlEmbedEnabled, excalidrawEmbedEnabled })} />
                                    </div>
                                )}
                                {onRetry && (
                                    <button
                                        type="button"
                                        className={cn(
                                            'bubble-retry-btn mt-2 inline-flex items-center gap-1.5',
                                            'rounded border px-2.5 py-1 text-[12px] font-medium leading-none',
                                            'border-[#f5c2c2] bg-white text-[#cf222e]',
                                            'hover:bg-[#cf222e] hover:text-white hover:border-[#cf222e]',
                                            'dark:border-[#7a3030] dark:bg-[#1e1e1e] dark:text-[#f87171]',
                                            'dark:hover:bg-[#cf222e] dark:hover:text-white',
                                            'transition-colors disabled:opacity-70 disabled:cursor-wait',
                                        )}
                                        title="Retry this turn"
                                        onClick={onRetry}
                                        data-testid="retry-turn-btn"
                                    >
                                        <span aria-hidden="true">↺</span>
                                        <span>Retry this turn</span>
                                    </button>
                                )}
                            </div>
                        </aside>
                    )}
                    {isUser && turn.skillNames && turn.skillNames.length > 0 && (
                        <div className="flex flex-wrap gap-1 skill-badges">
                            {turn.skillNames.map(skill => (
                                <span
                                    key={skill}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#dceeff] dark:bg-[#0d2a42] text-[#005a9e] dark:text-[#7bbef3] border border-[#b3d7ff] dark:border-[#2a4a66]"
                                    title={`Skill invoked: ${skill}`}
                                >
                                    /{skill}
                                </span>
                            ))}
                        </div>
                    )}
                    {isUser && turn.turnSource && (
                        <span
                            className={cn(
                                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border',
                                turn.turnSource.source === 'loop'
                                    ? 'bg-[#e6f4ea] dark:bg-[#1a3a2a] text-[#15703a] dark:text-[#4ade80] border-[#b7e1cd] dark:border-[#2a5a3a]'
                                    : 'bg-[#fff8e1] dark:bg-[#3a2f1a] text-[#b08800] dark:text-[#fbbf24] border-[#ffe082] dark:border-[#5a4a2a]',
                            )}
                            title={turn.turnSource.source === 'loop'
                                ? `Loop tick${turn.turnSource.loopId ? ` (${turn.turnSource.loopId})` : ''}`
                                : `Scheduled wakeup${turn.turnSource.wakeupId ? ` (${turn.turnSource.wakeupId})` : ''}`
                            }
                            data-testid="turn-source-badge"
                        >
                            <span aria-hidden="true">{turn.turnSource.source === 'loop' ? <LoopIcon className="w-3 h-3 inline-block" /> : '⏰'}</span>
                            <span>{turn.turnSource.source === 'loop' ? 'loop' : 'wakeup'}</span>
                        </span>
                    )}
                    {isUser && !showRaw && parsedUserContent.attachedContexts.map((context, index) => (
                        <AttachedContextBlockCard
                            key={`${context.kind}:${context.sourceWorkspaceId}:${context.kind === 'ralph-session' ? context.sourceRalphSessionId : context.sourceProcessId}:${index}`}
                            context={context}
                        />
                    ))}
                    {isUser && !showRaw && userContentText.trim() && (
                        <div className="whitespace-pre-wrap break-words text-[13px]" data-testid="user-plain-text"
                            dangerouslySetInnerHTML={{ __html: userContentHtml }}
                        />
                    )}
                    {isUser && showRaw && (
                        <div className="raw-content-view rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#ffffff] dark:bg-[#1e1e1e] overflow-auto max-h-[600px]">
                            <pre className="p-3 font-mono text-xs whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{turn.content || ''}</code>
                            </pre>
                        </div>
                    )}
                    {isUser && turn.images && turn.images.length > 0 && (
                        <ImageGallery images={turn.images} />
                    )}
                    {isUser && needsLazyImages && imageLoadState === 'idle' && (
                        <button
                            className="text-[11px] text-[#848484] hover:text-[#005a9e] dark:hover:text-[#7bbef3] cursor-pointer bg-transparent border-none p-0"
                            data-testid="load-images-btn"
                            onClick={handleLoadImages}
                        >
                            📷 Load {turn.imagesCount} image{(turn.imagesCount ?? 0) > 1 ? 's' : ''}
                        </button>
                    )}
                    {isUser && needsLazyImages && imageLoadState === 'loading' && (
                        <ImageGallery images={[]} loading={true} imagesCount={turn.imagesCount} />
                    )}
                    {isUser && imageLoadState === 'loaded' && fetchedImages.length > 0 && (
                        <ImageGallery images={fetchedImages} />
                    )}
                    {isUser && needsLazyImages && imageLoadState === 'error' && (
                        <button
                            className="text-[11px] text-[#f14c4c] hover:text-[#d32f2f] cursor-pointer bg-transparent border-none p-0"
                            data-testid="retry-images-btn"
                            onClick={handleLoadImages}
                        >
                            ⚠ Failed to load images · Retry
                        </button>
                    )}
                    {isUser && turn.pasteExternalized && (
                        <div
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] text-[#848484] bg-[#f0f0f0] dark:bg-[#2d2d2d]"
                            data-testid="paste-externalized-badge"
                            title="Large pasted content was saved as a file reference for the AI"
                        >
                            📎 Content saved as file reference
                        </div>
                    )}
                    {!isUser && !turn.isError && showRaw && (
                        <div className="raw-content-view rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#ffffff] dark:bg-[#1e1e1e] overflow-auto max-h-[600px]">
                            <pre className="p-3 font-mono text-xs whitespace-pre-wrap break-words text-[#1e1e1e] dark:text-[#cccccc]">
                                <code>{buildRawContent(turn)}</code>
                            </pre>
                        </div>
                    )}
                    {!isUser && !turn.isError && !showRaw && isScript && parsedScript?.recognised && (
                        <ScriptTerminalBlock parsed={parsedScript} />
                    )}
                    {!isUser && !turn.isError && !showRaw && jsonDetected && viewMode === 'json' && (
                        <JsonResponseView content={turn.content!} />
                    )}
                    {!isUser && !turn.isError && !showRaw && !(jsonDetected && viewMode === 'json') && !(isScript && parsedScript?.recognised) && assistantRender && (() => {
                        const nodes: React.ReactNode[] = [];
                        let accHtml = '';
                        let accKey = '';
                        const flushContent = () => {
                            if (accKey && accHtml) {
                                nodes.push(<MarkdownView key={accKey} html={accHtml} sectionMarkdown={sectionMarkdown} fullMarkdown={turn.content ?? ''} hideSectionCopy={!!turn.streaming} />);
                                accHtml = '';
                                accKey = '';
                            }
                        };
                        for (const chunk of displayChunks) {
                            if (chunk.kind === 'content' && chunk.html) {
                                // Content emitted while a sub-task is active should render under that task.
                                if (chunk.parentToolId && assistantRender.toolById.has(chunk.parentToolId)) continue;
                                if (!accKey) accKey = chunk.key;
                                accHtml += chunk.html;
                            } else if (chunk.kind === 'tool' && chunk.toolId) {
                                // Skip children — they are rendered inside their parent's .tool-call-children
                                if (assistantRender.toolParentById.has(chunk.toolId)) continue;
                                const toolNode = renderToolTree(chunk.toolId, 0);
                                if (toolNode !== null) {
                                    flushContent();
                                    // Detect commits for individual (ungrouped) shell tool calls
                                    const tool = assistantRender.toolById.get(chunk.toolId);
                                    const toolName = tool?.toolName ?? '';
                                    if ((toolName === 'powershell' || toolName === 'shell' || toolName === 'bash') && tool?.result) {
                                        const commits = detectCommitsInToolGroup([{
                                            id: chunk.toolId,
                                            toolName,
                                            args: tool.args,
                                            result: tool.result,
                                            status: tool.status,
                                        }]);
                                        if (commits.length > 0) {
                                            nodes.push(
                                                <React.Fragment key={chunk.key + '-with-commit'}>
                                                    {toolNode}
                                                    <CommitStrip commits={commits} workspaceId={wsId} />
                                                </React.Fragment>
                                            );
                                            continue;
                                        }
                                    }
                                    nodes.push(toolNode);
                                }
                            } else if (chunk.kind === 'tool-group' && chunk.toolIds) {
                                flushContent();
                                const toolCalls = chunk.toolIds
                                    .map(id => assistantRender.toolById.get(id))
                                    .filter((tc): tc is NonNullable<typeof tc> => tc != null);
                                const commits = chunk.category === 'shell'
                                    ? detectCommitsInToolGroup(toolCalls)
                                    : undefined;
                                nodes.push(
                                    <ToolCallGroupView
                                        key={chunk.key}
                                        category={chunk.category}
                                        toolCalls={toolCalls}
                                        contentItems={chunk.contentItems}
                                        orderedItems={chunk.orderedItems}
                                        isStreaming={!!turn.streaming}
                                        compactness={toolCompactness}
                                        agentId={chunk.agentId}
                                        renderToolTree={renderToolTree}
                                        commits={commits}
                                        workspaceId={wsId}
                                    />
                                );
                            } else if (chunk.kind === 'whisper-group') {
                                flushContent();
                                const wg = chunk as unknown as WhisperGroupChunk;
                                nodes.push(
                                    <WhisperCollapsedGroup
                                        key={wg.key}
                                        precedingChunks={wg.precedingChunks}
                                        summary={wg.summary}
                                        toolById={assistantRender.toolById as any}
                                        toolsWithChildren={assistantRender.toolsWithChildren}
                                        toolParentById={assistantRender.toolParentById}
                                        isStreaming={!!turn.streaming}
                                        groupSingleLineMessages={groupSingleLineMessages}
                                        workspaceId={wsId}
                                        renderToolTree={renderToolTree}
                                    />
                                );
                            }
                        }
                        flushContent();
                        return nodes;
                    })()}
                    {/* Note edit cards for AI turns that modified a note */}
                    {!isUser && noteEdits && processId && wsId && (() => {
                        const editsForTurn = noteEdits.filter(
                            e => e.turnIndex === turnIndex && e.postEditContent !== undefined
                        );
                        return editsForTurn.map(edit => (
                            <NoteEditCard
                                key={edit.editId}
                                editId={edit.editId}
                                processId={processId}
                                wsId={wsId}
                                notePath={edit.notePath}
                                preEditContent={edit.preEditContent}
                                postEditContent={edit.postEditContent!}
                                turnIndex={edit.turnIndex}
                                tooLarge={edit.tooLarge}
                            />
                        ));
                    })()}
                </div>
            </div>
            {isUser && (
                <span
                    className={cn(
                        'turn-avatar flex-shrink-0 mt-0.5 ml-3 inline-flex items-center justify-center w-6 h-6 rounded-full select-none border',
                        'bg-[#ddf4ff] text-[#0969da] border-[#b6e3ff]',
                        'dark:bg-[#0c2d6b] dark:text-[#79c0ff] dark:border-[#1f4988]',
                        'text-[11.5px] font-semibold'
                    )}
                    title="You"
                    aria-hidden="true"
                >
                    Y
                </span>
            )}
        </div>
    );
}
