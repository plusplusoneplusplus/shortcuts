/**
 * SuggestionChips — renders server-provided follow-up suggestions as clickable rows.
 */

export interface SuggestionChipsProps {
    suggestions: string[];
    onSelect: (text: string) => void;
    disabled?: boolean;
}

const fadeInStyle: React.CSSProperties = {
    animation: 'suggestionFadeIn 0.2s ease-out forwards',
};

const keyframesStyle = `@keyframes suggestionFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`;

export function SuggestionChips({ suggestions, onSelect, disabled }: SuggestionChipsProps) {
    if (suggestions.length === 0) return null;

    return (
        <>
            <style>{keyframesStyle}</style>
            <div
                className={`flex flex-col gap-1.5 w-full${disabled ? ' pointer-events-none opacity-50' : ''}`}
                style={fadeInStyle}
                data-testid="suggestion-chips"
            >
                {suggestions.map((text, i) => (
                    <button
                        key={i}
                        type="button"
                        className="rounded-md border px-3 py-1.5 text-sm text-left cursor-pointer transition-colors border-[#e0e0e0] bg-white hover:bg-[#f3f3f3] text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:hover:bg-[#2a2d2e] dark:text-[#cccccc]"
                        onClick={() => onSelect(text)}
                        data-testid="suggestion-chip"
                    >
                        <span className="text-[#0078d4] mr-1.5">→</span>
                        {text}
                    </button>
                ))}
            </div>
        </>
    );
}
