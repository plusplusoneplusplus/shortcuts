/**
 * EditWikiDialog — dialog for editing an existing wiki.
 */

import { useState, useCallback } from 'react';
import { Dialog, Button } from '../shared';
import { getApiBase } from '../../config';

const COLOR_PRESETS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#848484'];

interface EditWikiDialogProps {
    open: boolean;
    wiki: { id: string; name?: string; title?: string; repoPath?: string; color?: string };
    onClose: () => void;
    onUpdated: () => void;
}

export function EditWikiDialog({ open, wiki, onClose, onUpdated }: EditWikiDialogProps) {
    const [name, setName] = useState(wiki.name || wiki.title || wiki.id);
    const [color, setColor] = useState(wiki.color || '#848484');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = useCallback(async () => {
        if (!name.trim()) { setError('Name is required'); return; }
        setSubmitting(true);
        setError('');
        try {
            const res = await fetch(getApiBase() + '/wikis/' + encodeURIComponent(wiki.id), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), color }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({ error: 'Failed to update wiki' }));
                setError(body.error || 'Failed to update wiki');
                setSubmitting(false);
                return;
            }
            onUpdated();
            onClose();
        } catch {
            setError('Network error');
        }
        setSubmitting(false);
    }, [name, color, wiki.id, onUpdated, onClose]);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Edit Wiki"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button loading={submitting} onClick={handleSubmit}>Save</Button>
                </>
            }
        >
            <div className="space-y-3">
                <div>
                    <label className="block text-xs font-medium mb-1">Name</label>
                    <input
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                        value={name}
                        onChange={e => { setName(e.target.value); setError(''); }}
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium mb-1">Repository Path</label>
                    <input
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none opacity-60"
                        value={wiki.repoPath || ''}
                        disabled
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium mb-1">Color</label>
                    <div className="flex gap-2">
                        {COLOR_PRESETS.map(c => (
                            <button
                                key={c}
                                className={`w-6 h-6 rounded-full border-2 transition-all ${color === c ? 'border-[#0078d4] scale-110' : 'border-transparent'}`}
                                style={{ background: c }}
                                onClick={() => setColor(c)}
                                type="button"
                            />
                        ))}
                    </div>
                </div>
                {error && <p className="text-xs text-[#f14c4c]">{error}</p>}
            </div>
        </Dialog>
    );
}
