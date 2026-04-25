/**
 * SuggestionChips — renders server-provided follow-up suggestions as clickable rows.
 *
 * Default: single click populates the input field.
 * Ctrl/Meta+click: sends the suggestion immediately.
 * When ctrlHeld is true the chips show a "send" affordance visually.
 */
import { cn } from './cn';

export interface SuggestionChipsProps {
    suggestions: string[];
    onSelect: (text: string, event: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    /** Pass true when the Ctrl/Meta modifier is held to show the "send" visual state. */
    ctrlHeld?: boolean;
}

const fadeInStyle: React.CSSProperties = {
    animation: 'suggestionFadeIn 0.2s ease-out forwards',
};

const keyframesStyle = `@keyframes suggestionFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`;

export function SuggestionChips({ suggestions, onSelect, disabled, ctrlHeld }: SuggestionChipsProps) {
    if (suggestions.length === 0) return null;

    return (
        <>
            <style>{keyframesStyle}</style>
            <div
                className={`flex flex-wrap gap-1.5 w-full${disabled ? ' pointer-events-none opacity-50' : ''}`}
                style={fadeInStyle}
                data-testid="suggestion-chips"
            >
                {suggestions.map((text, i) => (
                    <button
                        key={i}
                        type="button"
                        className={cn(
                            'rounded-md border px-3 py-1.5 text-sm text-left cursor-pointer transition-colors',
                            ctrlHeld
                                ? 'border-[#0078d4] bg-[#e8f3ff] hover:bg-[#daeeff] text-[#0078d4] dark:bg-[#002d4e] dark:border-[#1177bb] dark:hover:bg-[#003a64] dark:text-[#4fc3f7]'
                                : 'border-[#e0e0e0] bg-white hover:bg-[#f3f3f3] text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:hover:bg-[#2a2d2e] dark:text-[#cccccc]',
                        )}
                        onClick={(e) => onSelect(text, e)}
                        title={ctrlHeld ? 'Click to send' : 'Click to edit · Ctrl+Click to send'}
                        data-testid="suggestion-chip"
                    >
                        <span className="mr-1.5">{ctrlHeld ? '↵' : '→'}</span>
                        {text}
                    </button>
                ))}
            </div>
        </>
    );
}
