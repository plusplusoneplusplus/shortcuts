/**
 * Adapters mapping a read-only {@link NativeCliSessionDetail} into the minimal
 * `task` / `metadataProcess` shapes the existing chat sub-components
 * (`ChatHeader`, `ConversationMetadataPopover`) consume, so the CLI Sessions
 * detail view can be presented with the same UI as a CoC chat activity without
 * forking those components.
 *
 * Native sessions are external, static transcripts: they have no CoC process
 * lifecycle (no run status, queue task, session-id link, token usage, or
 * mutable turns). The shapes produced here therefore carry only the fields the
 * chat components read for presentation, and deliberately leave the rest
 * undefined so the dependent UI (resume link, fork, live token gauge, etc.)
 * hides itself gracefully.
 *
 * Fields with no natural home in the chat metadata popover's built-in row set
 * (repository, branch, cwd, host, created/updated, stored summary) are surfaced
 * through {@link buildNativeSessionMetadataExtraRows} as explicit extra rows.
 */

import type {
    NativeCliSessionDetail,
    NativeCliSessionProviderId,
} from '@plusplusoneplusplus/coc-client';

/** Minimal `task` shape consumed by `ChatHeader` for the provider badge. */
export interface NativeSessionHeaderTask {
    type: 'chat';
    metadata: { provider: NativeCliSessionProviderId };
}

/** Minimal `process` shape consumed by `ConversationMetadataPopover`/`buildRows`. */
export interface NativeSessionMetadataProcess {
    metadata: { provider: NativeCliSessionProviderId; model?: string };
}

/**
 * One extra metadata row for the conversation metadata popover. Structurally a
 * subset of the popover's internal `MetaRow` (no `link`), so it can be appended
 * to the standard rows without a popover-internal change beyond an optional
 * pass-through prop.
 */
export interface NativeSessionMetaRow {
    label: string;
    value: string;
    breakAll?: boolean;
    mono?: boolean;
}

/**
 * Header title for a native session. The session id is the only stable,
 * human-addressable identifier these external transcripts carry, so it doubles
 * as the chat-header title (mirroring how a CoC chat falls back to an id-like
 * title when no custom title is set).
 */
export function nativeSessionTitle(detail: NativeCliSessionDetail): string {
    return detail.id;
}

/**
 * Best-effort model label for the session: the model of the most recent
 * assistant turn that recorded one. Returns `undefined` when no assistant turn
 * carries a model, so the popover falls back to chat's default-model copy.
 */
export function deriveNativeSessionModel(detail: NativeCliSessionDetail): string | undefined {
    const conversation = detail.conversation;
    if (!Array.isArray(conversation)) {
        return undefined;
    }
    for (let i = conversation.length - 1; i >= 0; i--) {
        const turn = conversation[i];
        if (turn && turn.role === 'assistant' && typeof turn.model === 'string') {
            const model = turn.model.trim();
            if (model) {
                return model;
            }
        }
    }
    return undefined;
}

/** Build the `ChatHeader` `task` prop (drives the provider badge). */
export function toNativeSessionHeaderTask(detail: NativeCliSessionDetail): NativeSessionHeaderTask {
    return { type: 'chat', metadata: { provider: detail.provider } };
}

/** Build the `ConversationMetadataPopover` `process` prop (Agent Provider + Model rows). */
export function toNativeSessionMetadataProcess(detail: NativeCliSessionDetail): NativeSessionMetadataProcess {
    const model = deriveNativeSessionModel(detail);
    return { metadata: { provider: detail.provider, ...(model ? { model } : {}) } };
}

/**
 * Format a stored ISO timestamp for display, mirroring the panel's existing
 * `formatTimestamp`: `null`/blank → `null` (row omitted), unparseable → the raw
 * value, otherwise a locale string.
 */
export function formatNativeSessionTimestamp(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
        return trimmed;
    }
    return new Date(parsed).toLocaleString();
}

function pushRow(
    rows: NativeSessionMetaRow[],
    label: string,
    value: string | null | undefined,
    opts?: { breakAll?: boolean; mono?: boolean },
): void {
    if (value === null || value === undefined) {
        return;
    }
    const str = value.trim();
    if (!str) {
        return;
    }
    rows.push({ label, value: str, ...(opts ?? {}) });
}

/**
 * Native-session metadata that has no built-in chat-popover row: repository,
 * branch, working directory, host, created/updated timestamps, and the stored
 * summary. Empty/absent fields are skipped so the popover stays clean.
 */
export function buildNativeSessionMetadataExtraRows(detail: NativeCliSessionDetail): NativeSessionMetaRow[] {
    const rows: NativeSessionMetaRow[] = [];
    pushRow(rows, 'Repository', detail.repository, { breakAll: true });
    pushRow(rows, 'Branch', detail.branch);
    pushRow(rows, 'Working Directory', detail.cwd, { breakAll: true });
    pushRow(rows, 'Host', detail.hostType);
    pushRow(rows, 'Created', formatNativeSessionTimestamp(detail.createdAt));
    pushRow(rows, 'Updated', formatNativeSessionTimestamp(detail.updatedAt));
    pushRow(rows, 'Summary', detail.summary, { breakAll: true });
    return rows;
}
