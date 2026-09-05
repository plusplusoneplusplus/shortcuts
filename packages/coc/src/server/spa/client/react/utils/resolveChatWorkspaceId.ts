/**
 * Resolves which workspace (repo) a chat belongs to.
 *
 * The workspace id normally arrives as a UI prop, but several mount paths have
 * none to give: `buildChatPopOutUrl` omits `?workspace=` when the caller has no
 * id, and the notification bell floats chats with an optional `workspaceId`.
 * A chat mounted that way still knows which repo it ran in — the process record
 * carries the id in `metadata.workspaceId` (`AIProcess` has no top-level field;
 * workspace is a store column whose in-payload home is `metadata`).
 *
 * Without this fallback such a chat has no canonical origin, so every
 * origin-scoped piece of chrome (the composer PR chips in particular) silently
 * renders nothing at all — no request, no error.
 *
 * Kept as a pure function so it is unit-testable without React, matching how
 * `composerPrChipFold` / `prChatAssociation` are factored.
 */
function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function resolveChatWorkspaceId(
    propWorkspaceId: string | undefined | null,
    processDetails?: { metadata?: Record<string, unknown> | null } | null,
    task?: { metadata?: Record<string, unknown> | null } | null,
): string | undefined {
    return asString(propWorkspaceId)
        || asString(processDetails?.metadata?.workspaceId)
        || asString(task?.metadata?.workspaceId)
        || undefined;
}
