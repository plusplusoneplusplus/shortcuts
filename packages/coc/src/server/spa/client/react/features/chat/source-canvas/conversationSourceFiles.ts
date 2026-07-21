/**
 * Conversation-scoped source-code references for the source-canvas switcher.
 *
 * The collector renders assistant content through the same chat markdown pipeline
 * that creates clickable links, then reads the resulting link metadata. This
 * keeps candidate parsing aligned with the open-on-click path without recording
 * any event history or persistent state.
 */
import { useMemo } from 'react';
import { toForwardSlashes } from '@plusplusoneplusplus/forge/utils/path-utils';
import type { ClientConversationTurn } from '../../../types/dashboard';
import {
    isExternalFileReferenceHref,
    isSourceCanvasDirectoryPath,
    isSourceCanvasNotePath,
    parseFilePathRef,
} from '../../../shared/file-path-utils';
import { chatMarkdownToHtml } from '../conversation/markdownHtml';
import type { SourceCanvasFileRef } from './types';

export interface ConversationSourceFile extends SourceCanvasFileRef {
    kind: 'code';
    wsId: string;
}

function readLineAttr(element: Element, name: string): number | undefined {
    const value = element.getAttribute(name);
    if (!value) return undefined;
    const line = Number.parseInt(value, 10);
    return Number.isFinite(line) ? line : undefined;
}

function normalizePath(path: string): string {
    return toForwardSlashes(path)
        .replace(/\/+/g, '/')
        .replace(/\/+$/, '')
        .toLowerCase();
}

/** Stable identity for conversation candidates: normalized workspace + path. */
export function getConversationSourceFileKey(wsId: string, fullPath: string): string {
    return `${wsId.trim().toLowerCase()}::${normalizePath(fullPath)}`;
}

function parseCandidate(
    rawPath: string,
    wsId: string,
    line?: number,
    endLine?: number,
): ConversationSourceFile | null {
    const parsed = parseFilePathRef(toForwardSlashes(rawPath));
    if (!parsed.path
        || isSourceCanvasNotePath(parsed.path)
        || isSourceCanvasDirectoryPath(parsed.path)) {
        return null;
    }

    return {
        fullPath: parsed.path,
        wsId,
        kind: 'code',
        line: line ?? parsed.line,
        endLine: endLine ?? parsed.endLine,
    };
}

function collectTurnFiles(turn: ClientConversationTurn, wsId: string): ConversationSourceFile[] {
    if (typeof DOMParser === 'undefined') {
        return [];
    }

    const html = chatMarkdownToHtml(turn.content, wsId);
    const document = new DOMParser().parseFromString(html, 'text/html');
    const candidates: ConversationSourceFile[] = [];

    for (const element of document.querySelectorAll('.file-path-link, .md-link, a[href]')) {
        if (element.classList.contains('file-path-link')) {
            const filePath = element.getAttribute('data-full-path');
            if (!filePath) continue;
            const candidate = parseCandidate(
                filePath,
                wsId,
                readLineAttr(element, 'data-line'),
                readLineAttr(element, 'data-end-line'),
            );
            if (candidate) candidates.push(candidate);
            continue;
        }

        const href = element.getAttribute('data-href') || element.getAttribute('href') || '';
        if (!href || href.startsWith('#') || isExternalFileReferenceHref(href)) {
            continue;
        }
        const candidate = parseCandidate(href, wsId);
        if (candidate) candidates.push(candidate);
    }

    return candidates;
}

/**
 * Collect assistant code-link candidates from one loaded conversation.
 *
 * Each later mention replaces an earlier reference for the same normalized
 * workspace/path, retaining its line range and placing it first in the result.
 */
export function collectConversationSourceFiles(
    turns: ReadonlyArray<ClientConversationTurn>,
    wsId?: string,
): ConversationSourceFile[] {
    const workspaceId = wsId ?? '';
    const mostRecent = new Map<string, ConversationSourceFile>();

    for (const turn of turns) {
        if (turn.role !== 'assistant') continue;
        for (const candidate of collectTurnFiles(turn, workspaceId)) {
            const key = getConversationSourceFileKey(workspaceId, candidate.fullPath);
            mostRecent.delete(key);
            mostRecent.set(key, candidate);
        }
    }

    return Array.from(mostRecent.values()).reverse();
}

/** Live derived view of the currently loaded conversation; intentionally memory-only. */
export function useConversationSourceFiles(
    turns: ReadonlyArray<ClientConversationTurn>,
    wsId?: string,
): ConversationSourceFile[] {
    return useMemo(() => collectConversationSourceFiles(turns, wsId), [turns, wsId]);
}
