/**
 * Banner above the classic viewer saying why the editor view is not shown.
 */

import {
    FALLBACK_REASON_MESSAGE,
    isRetryableFallback,
    type DiffEngineFallbackReason,
} from './diffEngineResolution';

export interface DiffEngineFallbackBannerProps {
    reason: DiffEngineFallbackReason;
    onRetry?: () => void;
}

export function DiffEngineFallbackBanner({ reason, onRetry }: DiffEngineFallbackBannerProps) {
    return (
        <div
            role="status"
            className="flex items-center gap-2 px-3 py-1.5 mb-1 text-xs rounded bg-[#f6f8fa] dark:bg-[#2d2d30] text-[#616161] dark:text-[#bbb] border border-[#e0e0e0] dark:border-[#3c3c3c]"
            data-testid="diff-engine-fallback-banner"
            data-reason={reason}
        >
            <span className="flex-1">{FALLBACK_REASON_MESSAGE[reason]}</span>
            {onRetry && isRetryableFallback(reason) && (
                <button
                    className="text-[#0366d6] dark:text-[#58a6ff] underline hover:no-underline font-medium"
                    onClick={onRetry}
                    data-testid="diff-engine-fallback-retry"
                >
                    Retry
                </button>
            )}
        </div>
    );
}
