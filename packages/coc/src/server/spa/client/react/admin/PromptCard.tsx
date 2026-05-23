/**
 * PromptCard — card displaying a built-in prompt.
 * Read-only for non-editable prompts; shows Edit/Save/Cancel/Reset for editable ones.
 */

import { useState } from 'react';

interface PromptCardProps {
    id: string;
    title: string;
    source: string;
    description: string;
    /** Built-in default text. */
    text: string;
    editable?: boolean;
    templateVars?: string[];
    hasOverride?: boolean;
    overrideText?: string;
    onSave?: (id: string, text: string) => Promise<void>;
    onReset?: (id: string) => Promise<void>;
}

export function PromptCard({
    id,
    title,
    source,
    description,
    text,
    editable,
    templateVars,
    hasOverride,
    overrideText,
    onSave,
    onReset,
}: PromptCardProps) {
    const [editing, setEditing] = useState(false);
    const [draftText, setDraftText] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const displayText = hasOverride && overrideText ? overrideText : text;

    function handleEdit() {
        setDraftText(displayText);
        setError(null);
        setEditing(true);
    }

    function handleCancel() {
        setEditing(false);
        setError(null);
    }

    async function handleSave() {
        if (!onSave) return;
        setSaving(true);
        setError(null);
        try {
            await onSave(id, draftText);
            setEditing(false);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }

    async function handleReset() {
        if (!onReset) return;
        setSaving(true);
        setError(null);
        try {
            await onReset(id);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="ar-prompt" data-testid="prompt-card">
            <div className="ar-prompt-head">
                <div className="min-w-0 flex-1">
                    <div className="ar-prompt-title">
                        {title}
                        <span className="ar-badge ar-mono">{source}</span>
                        {hasOverride && (
                            <span className="ar-badge" style={{ color: 'var(--vscode-charts-orange, #f0a31c)', borderColor: 'var(--vscode-charts-orange, #f0a31c)' }}>overridden</span>
                        )}
                    </div>
                    <div className="ar-prompt-desc">{description}</div>
                </div>
                {editable && !editing && (
                    <div className="flex gap-2 items-center flex-shrink-0 ml-2">
                        {hasOverride && (
                            <button
                                className="ar-btn ar-btn-ghost text-xs"
                                onClick={handleReset}
                                disabled={saving}
                                data-testid="prompt-reset-btn"
                                title="Reset to built-in default"
                            >
                                Reset
                            </button>
                        )}
                        <button
                            className="ar-btn ar-btn-secondary text-xs"
                            onClick={handleEdit}
                            data-testid="prompt-edit-btn"
                        >
                            Edit
                        </button>
                    </div>
                )}
            </div>

            {id === 'ralph-iteration-user' && (
                <div
                    className="ar-prompt-body"
                    style={{
                        backgroundColor: 'var(--vscode-inputValidation-warningBackground, #352a05)',
                        border: '1px solid var(--vscode-inputValidation-warningBorder, #cca700)',
                        borderRadius: '4px',
                        padding: '6px 8px',
                        marginBottom: '4px',
                        fontSize: '11px',
                        color: 'var(--vscode-inputValidation-warningForeground, #cca700)',
                    }}
                    data-testid="prompt-retriever-warning"
                >
                    ⚠ This prompt contains a <code>&lt;work_intent&gt;</code> block that signals the Copilot CLI skill retriever. Overrides that remove or alter this block may prevent project skills from being surfaced.
                </div>
            )}

            {editing ? (
                <div className="ar-prompt-body space-y-2">
                    {templateVars && templateVars.length > 0 && (
                        <div className="flex flex-wrap gap-1 text-xs">
                            <span className="text-[#848484]">Required vars:</span>
                            {templateVars.map(v => (
                                <span key={v} className="ar-badge ar-mono">{v}</span>
                            ))}
                        </div>
                    )}
                    <textarea
                        className="ar-textarea w-full"
                        rows={12}
                        value={draftText}
                        onChange={e => setDraftText(e.target.value)}
                        style={{ fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                        data-testid="prompt-editor"
                        disabled={saving}
                    />
                    {error && (
                        <div className="text-xs text-red-500" data-testid="prompt-save-error">{error}</div>
                    )}
                    <div className="flex gap-2">
                        <button
                            className="ar-btn ar-btn-primary text-xs"
                            onClick={handleSave}
                            disabled={saving || !draftText.trim()}
                            data-testid="prompt-save-btn"
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                            className="ar-btn ar-btn-ghost text-xs"
                            onClick={handleCancel}
                            disabled={saving}
                            data-testid="prompt-cancel-btn"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <div className="ar-prompt-body">
                    <pre className="ar-pre" data-testid="prompt-text">{displayText}</pre>
                </div>
            )}
        </div>
    );
}
