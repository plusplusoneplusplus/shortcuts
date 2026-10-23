/**
 * SuggestionChips — renders server-provided follow-up suggestions as one compact row.
 *
 * Default: single click populates the input field.
 * Ctrl/Meta+click: sends the suggestion immediately.
 * When ctrlHeld is true the chips show a "send" affordance visually.
 * Long suggestions are truncated; the full text is in the chip tooltip.
 */
import { cn } from './cn';

export interface SuggestionChipsProps {
    suggestions: string[];
    onSelect: (text: string, event: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    /** Pass true when the Ctrl/Meta modifier is held to show the "send" visual state. */
    ctrlHeld?: boolean;
    /** When set, renders an inline dismiss button at the end of the row. */
    onDismiss?: () => void;
}

const fadeInStyle: React.CSSProperties = {
    animation: 'suggestionFadeIn 0.2s ease-out forwards',
};

const keyframesStyle = `@keyframes suggestionFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`;

export function SuggestionChips({ suggestions, onSelect, disabled, ctrlHeld, onDismiss }: SuggestionChipsProps) {
    if (suggestions.length === 0) return null;

    const hint = ctrlHeld ? 'Click to send' : 'Click to edit · Ctrl+Click to send';

    return (
        <>
            <style>{keyframesStyle}</style>
            <div className="flex items-center gap-1.5 w-full min-w-0" style={fadeInStyle}>
                <div
                    className={cn(
                        'flex flex-nowrap items-center gap-1.5 flex-1 min-w-0 overflow-x-auto',
                        disabled && 'pointer-events-none opacity-50',
                    )}
                    data-testid="suggestion-chips"
                >
                    {suggestions.map((text, i) => (
                        <button
                            key={i}
                            type="button"
                            className={cn(
                                'shrink-0 max-w-[16rem] truncate rounded-full border bg-transparent px-2.5 py-0.5 text-xs text-left cursor-pointer transition-colors',
                                ctrlHeld
                                    ? 'border-[#0078d4] hover:bg-[#e8f3ff] text-[#0078d4] dark:border-[#1177bb] dark:hover:bg-[#002d4e] dark:text-[#4fc3f7]'
                                    : 'border-[#e0e0e0] hover:bg-[#f3f3f3] text-[#1e1e1e] dark:border-[#3c3c3c] dark:hover:bg-[#2a2d2e] dark:text-[#cccccc]',
                            )}
                            disabled={disabled}
                            onClick={(e) => onSelect(text, e)}
                            title={`${text}\n${hint}`}
                            data-testid="suggestion-chip"
                        >
                            <span className="mr-1">{ctrlHeld ? '↵' : '→'}</span>
                            {text}
                        </button>
                    ))}
                </div>
                {onDismiss && (
                    <button
                        type="button"
                        className="shrink-0 h-5 w-5 flex items-center justify-center rounded-full text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] text-[10px] leading-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#0078d4]/50"
                        onClick={onDismiss}
                        aria-label="Dismiss suggestions"
                        title="Dismiss suggestions"
                        data-testid="dismiss-suggestions-btn"
                    >
                        ✕
                    </button>
                )}
            </div>
        </>
    );
}
