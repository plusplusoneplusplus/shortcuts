/**
 * CommitChatBindingStore
 *
 * Per-workspace JSON store mapping commitHash → taskId for the commit-chat feature.
 * Follows the same persistence pattern as RepoScheduleOverrideStore.
 *
 * Storage: ~/.coc/repos/<workspaceId>/commit-chat-bindings.json
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import { atomicWriteJson } from './shared/fs-utils';
import { getRepoDataPath } from './paths';

// ============================================================================
// Types
// ============================================================================

/** A single binding entry. taskId is the process/task ID of the chat conversation. */
export interface CommitChatBinding {
    taskId: string;
    /** ISO-8601 timestamp of when the binding was created. */
    createdAt: string;
}

/**
 * Top-level shape of commit-chat-bindings.json.
 * Keys are full commit hashes (40-char hex).
 */
export interface CommitChatBindings {
    [commitHash: string]: CommitChatBinding;
}

// ============================================================================
// CommitChatBindingStore
// ============================================================================

export class CommitChatBindingStore {
    private readonly dataDir: string;
    private static readonly FILENAME = 'commit-chat-bindings.json';

    constructor(dataDir: string) {
        this.dataDir = dataDir;
    }

    /** Load all bindings for a workspace. Returns {} on missing/corrupt file. */
    load(workspaceId: string): CommitChatBindings {
        const filePath = getRepoDataPath(this.dataDir, workspaceId, CommitChatBindingStore.FILENAME);
        try {
            if (!fs.existsSync(filePath)) return {};
            const raw = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(raw) as CommitChatBindings;
        } catch {
            return {};
        }
    }

    /** Persist the full bindings map atomically. */
    save(workspaceId: string, bindings: CommitChatBindings): void {
        const filePath = getRepoDataPath(this.dataDir, workspaceId, CommitChatBindingStore.FILENAME);
        atomicWriteJson(filePath, bindings);
    }

    /** Get the binding for a single commit, or undefined. */
    get(workspaceId: string, commitHash: string): CommitChatBinding | undefined {
        return this.load(workspaceId)[commitHash];
    }

    /** Create or overwrite the binding for a commit. */
    bind(workspaceId: string, commitHash: string, taskId: string): void {
        const bindings = this.load(workspaceId);
        bindings[commitHash] = { taskId, createdAt: new Date().toISOString() };
        this.save(workspaceId, bindings);
    }

    /** Remove the binding for a commit. No-op if not present. Returns true if a binding was removed. */
    unbind(workspaceId: string, commitHash: string): boolean {
        const bindings = this.load(workspaceId);
        if (!(commitHash in bindings)) return false;
        delete bindings[commitHash];
        this.save(workspaceId, bindings);
        return true;
    }

    /**
     * Atomically move a binding from oldHash to newHash.
     * Used after amend/rebase when the commit hash changes but the chat should follow.
     * No-op if oldHash has no binding. Returns true if the rebind occurred.
     */
    rebind(workspaceId: string, oldHash: string, newHash: string): boolean {
        const bindings = this.load(workspaceId);
        if (!(oldHash in bindings)) return false;
        bindings[newHash] = bindings[oldHash];
        delete bindings[oldHash];
        this.save(workspaceId, bindings);
        return true;
    }

    /** Return all bindings for a workspace (convenience alias for load). */
    list(workspaceId: string): CommitChatBindings {
        return this.load(workspaceId);
    }
}
