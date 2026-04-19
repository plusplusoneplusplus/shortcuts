/**
 * CapacityBar — reusable progress bar showing character usage for bounded memory.
 *
 * Renders a thin progress bar (green < 80%, yellow 80–95%, red > 95%)
 * with text: [67% — 2,010/3,000 chars].
 */

interface CapacityBarProps {
    charCount: number;
    charLimit: number;
    className?: string;
}

export function CapacityBar({ charCount, charLimit, className = '' }: CapacityBarProps) {
    const percent = charLimit > 0 ? Math.min(100, Math.round((charCount / charLimit) * 100)) : 0;

    const barColor =
        percent > 95 ? 'bg-red-500' :
        percent > 80 ? 'bg-yellow-500' :
        'bg-green-500';

    const textColor =
        percent > 95 ? 'text-red-600 dark:text-red-400' :
        percent > 80 ? 'text-yellow-600 dark:text-yellow-400' :
        'text-[#848484]';

    return (
        <div className={`flex items-center gap-2 ${className}`} data-testid="capacity-bar">
            <div className="flex-1 h-1.5 bg-[#e0e0e0] dark:bg-[#3c3c3c] rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${percent}%` }}
                    data-testid="capacity-bar-fill"
                />
            </div>
            <span className={`text-[11px] whitespace-nowrap ${textColor}`} data-testid="capacity-bar-text">
                {percent}% — {charCount.toLocaleString()}/{charLimit.toLocaleString()} chars
            </span>
        </div>
    );
}
