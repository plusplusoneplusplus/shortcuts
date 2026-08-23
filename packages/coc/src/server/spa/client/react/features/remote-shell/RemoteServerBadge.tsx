/**
 * RemoteServerBadge — the tiny cloud glyph on a repo-picker group row whose
 * collection includes at least one clone served by another CoC server, so a
 * user scanning the picker can tell "this one isn't all local" at a glance.
 *
 * Purely presentational, and deliberately just a glyph: the row is already
 * carrying a name, a sublabel, a clone count and an unread badge, so a text
 * pill would crowd it. Server names live in the hover/accessible text only —
 * `Includes a repo from remote server Dev Box`, or the generic
 * `Includes a repo from a remote server` when no name is known.
 */

function CloudGlyph() {
    return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4.5 12.5h6.8a2.7 2.7 0 0 0 .3-5.38A4 4 0 0 0 4.2 6.6a2.95 2.95 0 0 0 .3 5.9Z" />
        </svg>
    );
}

/** Hover + accessible label for the marker. */
export function remoteServerBadgeLabel(servers: readonly string[]): string {
    const names = servers.filter(name => name.trim());
    if (names.length === 0) return 'Includes a repo from a remote server';
    return `Includes a repo from remote server ${names.join(', ')}`;
}

export interface RemoteServerBadgeProps {
    /** Server display names of the group's remote clones (see `getGroupRemoteServers`). */
    servers: readonly string[];
    /** testid override; defaults to `remote-server-badge`. */
    testId?: string;
}

export function RemoteServerBadge({ servers, testId = 'remote-server-badge' }: RemoteServerBadgeProps) {
    const label = remoteServerBadgeLabel(servers);
    return (
        <span
            data-testid={testId}
            title={label}
            aria-label={label}
            role="img"
            className="inline-flex items-center justify-center flex-shrink-0 text-[#0969da] dark:text-[#79c0ff]"
        >
            <CloudGlyph />
        </span>
    );
}
