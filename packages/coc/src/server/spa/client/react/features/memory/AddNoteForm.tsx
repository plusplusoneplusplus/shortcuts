/**
 * AddNoteForm — inline form for creating a new memory note.
 */

import React, { useState } from 'react';

interface AddNoteFormProps {
    onSave: (content: string, tags: string[]) => Promise<void>;
    onCancel: () => void;
}

export function AddNoteForm({ onSave, onCancel }: AddNoteFormProps) {
    const [content, setContent] = useState('');
    const [tagInput, setTagInput] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const addTag = () => {
        const t = tagInput.trim();
        if (t && !tags.includes(t)) {
            setTags(prev => [...prev, t]);
        }
        setTagInput('');
    };

    const removeTag = (tag: string) => {
        setTags(prev => prev.filter(t => t !== tag));
    };

    const handleTagKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag();
        }
    };

    const handleSubmit = async () => {
        if (!content.trim() || isSubmitting) return;
        setIsSubmitting(true);
        try {
            await onSave(content.trim(), tags);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className="mb-3 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-3 bg-[#fafafa] dark:bg-[#1e1e1e]"
            data-testid="add-note-form"
        >
            <textarea
                autoFocus
                className="w-full text-xs text-[#1e1e1e] dark:text-[#cccccc] bg-transparent border border-[#c8c8c8] dark:border-[#555] rounded px-2 py-1.5 resize-none focus:outline-none focus:border-[#0078d4] mb-2"
                rows={3}
                placeholder="What do you want to remember about this repo?"
                value={content}
                onChange={e => setContent(e.target.value)}
                data-testid="add-note-content"
            />

            {/* Tags row */}
            <div className="flex items-center gap-1 flex-wrap mb-2">
                <span className="text-[11px] text-[#848484]">Tags (optional):</span>
                {tags.map(tag => (
                    <span
                        key={tag}
                        className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-[#0078d4]/10 text-[#0078d4] dark:text-[#4fc3f7]"
                    >
                        {tag}
                        <button
                            onClick={() => removeTag(tag)}
                            className="ml-0.5 opacity-60 hover:opacity-100"
                            aria-label={`Remove tag ${tag}`}
                        >
                            ×
                        </button>
                    </span>
                ))}
                <input
                    type="text"
                    placeholder="add tag…"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    onBlur={addTag}
                    className="text-[11px] px-1.5 py-0.5 border border-[#c8c8c8] dark:border-[#555] rounded bg-transparent focus:outline-none focus:border-[#0078d4] w-24"
                    data-testid="add-note-tag-input"
                />
            </div>

            {/* Action buttons */}
            <div className="flex justify-end gap-2">
                <button
                    onClick={onCancel}
                    disabled={isSubmitting}
                    className="text-xs px-2.5 py-1 rounded border border-[#848484]/50 text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors disabled:opacity-50"
                    data-testid="add-note-cancel-btn"
                >
                    Cancel
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={isSubmitting || !content.trim()}
                    className="text-xs px-2.5 py-1 rounded bg-[#0078d4] text-white hover:bg-[#106ebe] transition-colors disabled:opacity-50"
                    data-testid="add-note-save-btn"
                >
                    {isSubmitting ? 'Saving…' : 'Remember →'}
                </button>
            </div>
        </div>
    );
}
