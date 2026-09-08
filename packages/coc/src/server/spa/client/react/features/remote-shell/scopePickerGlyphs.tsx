/**
 * scopePickerGlyphs — the icon set and badge helpers shared by every scope
 * picker surface: the desktop dropdown (`WorkspaceIdentityChip`), the mobile
 * bottom sheet (`ScopePickerSheet`), and the mobile scope list
 * (`MobileScopeList`).
 *
 * They live here rather than in any one surface so the two shells cannot drift
 * into different markers for the same thing. Everything is an inline SVG on
 * purpose — emoji glyph coverage varies by platform (see the `⧉` note in
 * `spa/shell.md`), so a repo group is a drawn icon, never a `📦`.
 */

/** Filled when pinned, outline when not — the row's pin toggle. */
export function PinGlyph({ filled }: { filled: boolean }) {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
            <path d="M12 15v5" />
        </svg>
    );
}

export function Chevron() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
        </svg>
    );
}

export function PlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
        </svg>
    );
}

export function KebabGlyph() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
        </svg>
    );
}

/** Stacked-layers icon marking repo-group entries apart from plain repos. */
export function RepoGroupGlyph() {
    return (
        <svg data-testid="repo-group-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l9 5-9 5-9-5 9-5z" />
            <path d="M3 13l9 5 9-5" />
        </svg>
    );
}

export function CloneGlyph() {
    return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
        </svg>
    );
}

export const unreadBadgeClass = 'min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d16969] text-white text-[8px] font-semibold flex items-center justify-center leading-none';

export function formatUnreadCount(count: number): string {
    return count > 99 ? '99+' : String(count);
}

/** The `⧉N` clone-count pill on a git-remote cluster row. */
export function CloneCountBadge({ count, className = '' }: { count: number; className?: string }) {
    return (
        <span
            data-testid="clone-count-badge"
            className={'inline-flex items-center gap-0.5 h-[16px] px-1.5 rounded-full text-[10px] font-semibold leading-none bg-black/[0.06] dark:bg-white/[0.10] text-[#555] dark:text-[#bbb] ' + className}
        >
            <CloneGlyph />
            {count}
        </span>
    );
}

/** The red unseen-chat count carried by both cluster and pinned rows. */
export function UnseenBadge({ count, testId = 'remote-unseen-badge' }: { count: number; testId?: string }) {
    return (
        <span className={unreadBadgeClass} data-testid={testId} aria-label={`${count} unread`}>
            {formatUnreadCount(count)}
        </span>
    );
}
