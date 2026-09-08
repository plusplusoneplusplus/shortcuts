/**
 * unifiedDiffSources — the transient source registry behind `diff` tabs in the
 * unified right panel (AC-02, AC-04).
 *
 * A whisper diff is not a stored document. It is reconstructed synchronously
 * from one chat group's captured `edit`/`create`/`apply_patch` tool calls
 * (`WhisperDiffOpenContext` -> `useWhisperDiffState`), and that context only
 * exists while the transcript that produced it is in memory. A panel tab, by
 * contrast, is persisted. This module is the join between the two: the entry
 * point hands a context in and gets back a stable id, the tab stores that id as
 * its `resourceId`, and the view looks it up again when it renders.
 *
 * Three properties the diff tab depends on:
 *
 *  - **The id is derived from the group's content**, not minted per open, so
 *    opening the same group twice — from the footer and then from a file row —
 *    focuses one tab instead of stacking two, and a reload's persisted
 *    descriptor names the same source the chat would re-register.
 *  - **Re-registering an unchanged group keeps the existing record**, so a
 *    re-render of the popover cannot reset the selection the user made in the
 *    panel's file dropdown (`WhisperDiffPanel` re-initializes on a new context
 *    identity). Only a genuinely different open — a new focus target — replaces
 *    it.
 *  - **Nothing here survives a reload.** The registry is module state, bounded
 *    by `MAX_DIFF_SOURCES`; a restored descriptor whose source is gone renders
 *    the spec's expired state rather than a blank panel. Persisting the diff
 *    body instead would put a snapshot of content in the tab model, which
 *    AC-02 rules out.
 */

import { useSyncExternalStore } from 'react';
import type { WhisperDiffOpenContext } from '../../chat/conversation/tool-calls/WhisperCollapsedGroup';
import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';

/**
 * How many groups stay reconstructable at once. A cap rather than a release
 * hook on tab close: a diff tab can be closed and reopened from the same
 * transcript, and unmounting the panel (a route change) must not throw away a
 * source the strip still points at.
 */
export const MAX_DIFF_SOURCES = 20;

/** One registered group: the context to replay, plus its display routing. */
export interface UnifiedDiffSource {
    /** The captured group — `useWhisperDiffState`'s only input. */
    ctx: WhisperDiffOpenContext;
    /** Root of the workspace the paths are relative to, for the panel header. */
    workspaceRootPath?: string | null;
    /**
     * `whisperDiffSourceId(ctx)` for the stored context. Equal to the map key
     * for a content-addressed source; for a caller-supplied id (a chat's
     * Changes tab, whose id must outlive its content) it is what tells a
     * re-registration of the same content from one that actually grew.
     */
    contentKey?: string;
}

const sources = new Map<string, UnifiedDiffSource>();
const listeners = new Set<() => void>();

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** FNV-1a, 32-bit — a short, stable, dependency-free content key. */
function hash32(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
}

/**
 * The resource id a group is filed under.
 *
 * Derived from what the diff is actually reconstructed from — the ordered file
 * list with its per-file totals, plus the captured tool calls — so two opens of
 * the same group agree while two different groups that happen to touch the same
 * files do not. `focusPath` is deliberately excluded: a file row and the "N
 * files" footer open the same whole-group tab, differing only in which file it
 * lands on.
 */
export function whisperDiffSourceId(ctx: WhisperDiffOpenContext): string {
    const parts: string[] = [];
    for (const file of ctx.files) {
        const path = file.path.replace(/\\/g, '/');
        parts.push(
            `${path}:${file.netInsertions}:${file.netDeletions}:` +
            `${file.isCreate ? 'c' : ''}${file.isDeleted ? 'd' : ''}`,
        );
    }
    for (const call of ctx.toolCalls) {
        // The args are what the hunks are rebuilt from, so they belong to the
        // identity; truncated because one large edit's payload would dominate
        // the hash cost without adding distinguishing power.
        parts.push(`${call.toolName}${safeArgs(call.args).slice(0, 4096)}`);
    }
    if (ctx.workspaceId) parts.push(`@${ctx.workspaceId}`);
    return `whisper-${ctx.files.length}-${hash32(parts.join('\n'))}`;
}

function safeArgs(args: unknown): string {
    if (args === undefined) return '';
    try {
        return JSON.stringify(args) ?? '';
    } catch {
        // Cyclic or non-serializable args: a shape-only marker rather than a
        // failed open.
        return typeof args;
    }
}

/** The tab label for a group — the whole group, not the focused file. */
export function whisperDiffTabLabel(ctx: WhisperDiffOpenContext): string {
    const n = ctx.files.length;
    return n > 0 ? `${n} file${n !== 1 ? 's' : ''} changed` : 'Changes';
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Register (or refresh) a group and return its source id.
 *
 * An identical re-registration keeps the stored record, so the view's context
 * identity — and with it the user's file selection — survives a re-render of
 * whatever dispatched the open.
 *
 * `options.sourceId` overrides the content-derived id. A chat's whole-chat
 * Changes source needs a fixed id — its content grows as the chat edits more
 * files, and a re-hash would open a second tab instead of refreshing the one
 * the user has — so the content hash moves to `contentKey`, which is what the
 * unchanged check compares.
 */
export function registerUnifiedDiffSource(
    ctx: WhisperDiffOpenContext,
    options: { workspaceRootPath?: string | null; sourceId?: string } = {},
): string {
    const contentKey = whisperDiffSourceId(ctx);
    const id = options.sourceId ?? contentKey;
    const rootPath = options.workspaceRootPath ?? null;
    const existing = sources.get(id);
    const unchanged =
        existing !== undefined &&
        (existing.contentKey ?? id) === contentKey &&
        existing.ctx.focusPath === ctx.focusPath &&
        (existing.workspaceRootPath ?? null) === rootPath;

    const record: UnifiedDiffSource = unchanged
        ? (existing as UnifiedDiffSource)
        : { ctx, workspaceRootPath: rootPath, contentKey };

    // Delete before set so the map's insertion order stays a recency order for
    // the cap below.
    sources.delete(id);
    sources.set(id, record);
    while (sources.size > MAX_DIFF_SOURCES) {
        const oldest = sources.keys().next();
        if (oldest.done) break;
        sources.delete(oldest.value);
    }
    if (!unchanged) notify();
    return id;
}

/** The registered group, or null when it has expired (or never existed). */
export function getUnifiedDiffSource(sourceId: string): UnifiedDiffSource | null {
    return sources.get(sourceId) ?? null;
}

/** Drop every registered group. Test isolation only. */
export function clearUnifiedDiffSources(): void {
    if (sources.size === 0) return;
    sources.clear();
    notify();
}

function notify(): void {
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Subscribe a view to one source. Reactive because a tab can exist before its
 * group does: an entry point may file the descriptor while the transcript that
 * owns the context is still mounting, and a later registration has to replace
 * the expired state rather than leave a dead tab.
 */
export function useUnifiedDiffSource(sourceId: string): UnifiedDiffSource | null {
    return useSyncExternalStore(
        subscribe,
        () => sources.get(sourceId) ?? null,
        () => null,
    );
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

/**
 * Turn a group into the descriptor an entry point opens, registering its
 * context on the way. The tab is chat-owned (a diff belongs to the chat whose
 * transcript produced it) and carries no `readOnly` flag: a diff surface has no
 * write path to suppress in the first place.
 */
export function whisperDiffTabInput(input: {
    ctx: WhisperDiffOpenContext;
    /** The clone the edited files belong to — not the page origin. */
    ownerWorkspaceId: string;
    /** The originating chat, not whichever chat is selected when this lands. */
    chatId: string | null;
    repoLabel?: string;
    workspaceRootPath?: string | null;
}): OpenUnifiedTabInput {
    const resourceId = registerUnifiedDiffSource(input.ctx, {
        workspaceRootPath: input.workspaceRootPath,
    });
    return {
        kind: 'diff',
        ownerWorkspaceId: input.ownerWorkspaceId,
        chatId: input.chatId,
        resourceId,
        label: whisperDiffTabLabel(input.ctx),
        ...(input.repoLabel === undefined ? {} : { repoLabel: input.repoLabel }),
    };
}
