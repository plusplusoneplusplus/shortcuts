/**
 * ChatSideNotesManager — repo-scoped persistence for Quick Ask side-notes.
 *
 * Side-notes are per-process annotations (NOT chat turns). They record a cheap
 * one-shot AI lookup for a text selection inside an assistant turn. Stored like
 * task comments, repo-scoped (multi-repo safe) via `getRepoDataPath`:
 *
 *   {dataDir}/repos/<workspaceId>/chat-sidenotes/<sha256(processId)>.json
 *
 * Pure Node.js; cross-platform (Linux/Mac/Windows).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../../paths';

/** Sub-directory name for chat side-notes storage. */
export const CHAT_SIDENOTES_DIR_NAME = 'chat-sidenotes';

/** Maximum side-notes retained per process (oldest trimmed on overflow). */
export const MAX_SIDENOTES_PER_PROCESS = 200;

/**
 * Anchor context for a side-note selection. Mirrors the task-comment anchor so
 * the same fuzzy relocation strategy can be applied later if a turn re-renders.
 */
export interface ChatSideNoteAnchor {
    /** The exact selected text. */
    selectedText: string;
    /** Up to ~80 chars of text immediately before the selection. */
    contextBefore: string;
    /** Up to ~80 chars of text immediately after the selection. */
    contextAfter: string;
    /** Stable content fingerprint of the selected text. */
    fingerprint: string;
}

/**
 * A persisted Quick Ask side-note.
 */
export interface ChatSideNote {
    /** Unique identifier (UUID). */
    id: string;
    /** Process (conversation) this side-note belongs to. */
    processId: string;
    /** Which assistant turn the selection was in. */
    turnIndex: number;
    /** Selection anchor + fuzzy-relocation context. */
    anchor: ChatSideNoteAnchor;
    /** Optional custom question (defaults to a plain "explain" lookup). */
    question?: string;
    /** AI markdown answer. */
    answer: string;
    /** Chip label = first ~22 chars of the selection. */
    label: string;
    /** Model used for the lookup, if resolved. */
    model?: string;
    /** ISO timestamp when created. */
    createdAt: string;
}

/** Storage envelope on disk. */
export interface ChatSideNotesStorage {
    sidenotes: ChatSideNote[];
}

/** Compute the chip label from a selection (first ~22 chars + ellipsis). */
export function buildSideNoteLabel(selectedText: string): string {
    const collapsed = selectedText.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= 22) {return collapsed;}
    return collapsed.slice(0, 22).trimEnd() + '…';
}

/** Stable fingerprint (first 16 hex of sha256) of the selected text. */
export function fingerprintSelection(selectedText: string): string {
    return crypto
        .createHash('sha256')
        .update(selectedText.replace(/\s+/g, ' ').trim())
        .digest('hex')
        .slice(0, 16);
}

/**
 * Manages Quick Ask side-note storage, one JSON file per process, scoped to a
 * workspace/repo directory.
 */
export class ChatSideNotesManager {
    private readonly dataDir: string;

    /**
     * @param dataDir - Root data directory (e.g. ~/.coc)
     */
    constructor(dataDir: string) {
        this.dataDir = dataDir;
    }

    /** Directory holding side-note files for a workspace. */
    private getWorkspaceDir(workspaceId: string): string {
        return getRepoDataPath(this.dataDir, workspaceId, CHAT_SIDENOTES_DIR_NAME);
    }

    /** Deterministic storage filename for a process (hashes the processId). */
    private getStorageFile(workspaceId: string, processId: string): string {
        const hash = crypto.createHash('sha256').update(processId).digest('hex');
        return path.join(this.getWorkspaceDir(workspaceId), `${hash}.json`);
    }

    /** Read all side-notes for a process (empty array when none/invalid). */
    async list(workspaceId: string, processId: string): Promise<ChatSideNote[]> {
        const file = this.getStorageFile(workspaceId, processId);
        if (!fs.existsSync(file)) {return [];}
        try {
            const content = await fs.promises.readFile(file, 'utf8');
            const storage: ChatSideNotesStorage = JSON.parse(content);
            return Array.isArray(storage.sidenotes) ? storage.sidenotes : [];
        } catch {
            return [];
        }
    }

    /** Persist the full list for a process (creates the directory as needed). */
    private async writeAll(workspaceId: string, processId: string, sidenotes: ChatSideNote[]): Promise<void> {
        const dir = this.getWorkspaceDir(workspaceId);
        await fs.promises.mkdir(dir, { recursive: true });
        const file = this.getStorageFile(workspaceId, processId);
        const storage: ChatSideNotesStorage = { sidenotes };
        await fs.promises.writeFile(file, JSON.stringify(storage, null, 2), 'utf8');
    }

    /**
     * Add a side-note. `id` and `createdAt` are generated here.
     * Trims to `MAX_SIDENOTES_PER_PROCESS`, dropping the oldest entries.
     */
    async add(
        workspaceId: string,
        processId: string,
        note: Omit<ChatSideNote, 'id' | 'processId' | 'createdAt'>,
    ): Promise<ChatSideNote> {
        const existing = await this.list(workspaceId, processId);
        const created: ChatSideNote = {
            ...note,
            id: crypto.randomUUID(),
            processId,
            createdAt: new Date().toISOString(),
        };
        let next = [...existing, created];
        if (next.length > MAX_SIDENOTES_PER_PROCESS) {
            next = next.slice(next.length - MAX_SIDENOTES_PER_PROCESS);
        }
        await this.writeAll(workspaceId, processId, next);
        return created;
    }

    /** Delete a single side-note by id. Returns true when a note was removed. */
    async delete(workspaceId: string, processId: string, id: string): Promise<boolean> {
        const existing = await this.list(workspaceId, processId);
        const next = existing.filter(n => n.id !== id);
        if (next.length === existing.length) {return false;}
        await this.writeAll(workspaceId, processId, next);
        return true;
    }
}
