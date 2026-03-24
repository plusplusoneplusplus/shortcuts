/**
 * PromptCard — read-only card displaying a single built-in prompt.
 * Shows title, source file badge, one-line description, and full prompt text.
 */

interface PromptCardProps {
    title: string;
    source: string;
    description: string;
    text: string;
}

export function PromptCard({ title, source, description, text }: PromptCardProps) {
    return (
        <div
            className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded-lg p-4 space-y-2"
            data-testid="prompt-card"
        >
            <div className="space-y-1">
                <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{title}</div>
                <span className="font-mono text-[11px] bg-[#f3f3f3] dark:bg-[#2d2d30] px-2 py-0.5 rounded text-[#888] inline-block">
                    {source}
                </span>
                <div className="text-xs text-[#616161] dark:text-[#9d9d9d]">{description}</div>
            </div>
            <pre
                className="font-mono text-xs bg-[#f3f3f3] dark:bg-[#2d2d30] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-3 w-full whitespace-pre-wrap text-[#1e1e1e] dark:text-[#cccccc] overflow-x-auto"
                data-testid="prompt-text"
            >
                {text}
            </pre>
        </div>
    );
}
