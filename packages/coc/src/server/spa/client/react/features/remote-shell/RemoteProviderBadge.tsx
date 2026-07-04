/**
 * RemoteProviderBadge — renders the hosting provider as a small logo (GitHub /
 * Azure DevOps) instead of an uppercase text keyword. Unknown remotes fall back
 * to the plain "Remote" text label. The provider name is still exposed via
 * title/aria-label so the badge stays accessible and testable, and a
 * `data-provider` attribute carries the resolved kind for tests and styling.
 *
 * Distinct from `features/chat/ProviderBadge`, which badges the AI/model
 * provider (Copilot / Codex / Claude) for a chat.
 */
import { remoteProviderKind, remoteProviderLabel } from './shellModel';

function GitHubMark({ size }: { size: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
        </svg>
    );
}

function AzureDevOpsMark({ size }: { size: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M0 8.877L2.247 5.91l8.405-3.416V.022l7.37 5.393L2.966 8.338v8.225L0 15.707zm24-4.45v14.651l-5.753 4.9-9.303-3.057v3.056l-5.978-7.416 15.057 1.798V5.415z" />
        </svg>
    );
}

export interface RemoteProviderBadgeProps {
    /** Normalized remote URL (`host/user/repo`) whose provider drives the icon. */
    normalizedUrl: string | null | undefined;
    /** Wrapper classes (position/spacing/color); inherited by the icon via `currentColor`. */
    className?: string;
    /** Icon edge length in px. */
    iconSize?: number;
    /** Optional test id forwarded to the wrapper. */
    testId?: string;
}

export function RemoteProviderBadge({ normalizedUrl, className, iconSize = 12, testId }: RemoteProviderBadgeProps) {
    const kind = remoteProviderKind(normalizedUrl);
    const label = remoteProviderLabel(normalizedUrl);

    // Unknown/other remotes keep the readable text label — there's no logo to show.
    if (kind === 'remote') {
        return (
            <span className={className} data-testid={testId} data-provider={kind}>
                {label}
            </span>
        );
    }

    return (
        <span
            className={className}
            data-testid={testId}
            data-provider={kind}
            role="img"
            aria-label={label}
            title={label}
        >
            {kind === 'github' ? <GitHubMark size={iconSize} /> : <AzureDevOpsMark size={iconSize} />}
        </span>
    );
}
