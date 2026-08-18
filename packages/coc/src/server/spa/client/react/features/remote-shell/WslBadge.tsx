/**
 * WslBadge — the small `WSL` pill shown on repo-picker rows whose checkout
 * lives inside WSL, so a user with both a native-Windows and a WSL clone of the
 * same remote can tell them apart at a glance.
 *
 * Purely presentational: the server decides whether a workspace is WSL-hosted
 * (`workspace.wsl`, see `src/server/wsl-workspace.ts`) and the SPA only renders
 * the marker. There is no client-side path sniffing here by design.
 *
 * The distro never becomes visible row text — it would compete with the repo
 * name for the row's narrow width — so it lives in the hover/accessible text
 * only: `Hosted in WSL (Ubuntu)`, or `Hosted in WSL` when unknown.
 */

/** Hover + accessible label for the pill. */
export function wslBadgeLabel(distro?: string | null): string {
    const name = distro?.trim();
    return name ? `Hosted in WSL (${name})` : 'Hosted in WSL';
}

export interface WslBadgeProps {
    /** Distro name from the server marker; `null`/absent renders the generic label. */
    distro?: string | null;
    /** testid override; defaults to `wsl-badge`. */
    testId?: string;
}

export function WslBadge({ distro, testId = 'wsl-badge' }: WslBadgeProps) {
    const label = wslBadgeLabel(distro);
    return (
        <span
            data-testid={testId}
            title={label}
            aria-label={label}
            className="inline-flex items-center h-[16px] px-1.5 rounded-full text-[9.5px] font-bold uppercase tracking-[0.06em] leading-none flex-shrink-0 bg-black/[0.06] dark:bg-white/[0.10] text-[#555] dark:text-[#bbb]"
        >
            WSL
        </span>
    );
}
