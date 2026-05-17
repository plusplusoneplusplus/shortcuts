/**
 * PromptCard — read-only card displaying a single built-in prompt.
 * Shows title, source file badge, one-line description, and full prompt text.
 *
 * Visuals come from `admin-redesign.css`.
 */

interface PromptCardProps {
    title: string;
    source: string;
    description: string;
    text: string;
}

export function PromptCard({ title, source, description, text }: PromptCardProps) {
    return (
        <div className="ar-prompt" data-testid="prompt-card">
            <div className="ar-prompt-head">
                <div className="min-w-0 flex-1">
                    <div className="ar-prompt-title">
                        {title}
                        <span className="ar-badge ar-mono">{source}</span>
                    </div>
                    <div className="ar-prompt-desc">{description}</div>
                </div>
            </div>
            <div className="ar-prompt-body">
                <pre className="ar-pre" data-testid="prompt-text">{text}</pre>
            </div>
        </div>
    );
}
