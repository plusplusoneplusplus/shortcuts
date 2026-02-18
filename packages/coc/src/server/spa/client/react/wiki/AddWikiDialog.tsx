/**
 * AddWikiDialog — dialog for creating a new wiki.
 */

import { useState, useCallback } from 'react';
import { Dialog, Button } from '../shared';
import { getApiBase } from '../../config';

const COLOR_PRESETS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#848484'];

interface AddWikiDialogProps {
    open: boolean;
    onClose: () => void;
    onAdded: () => void;
}

export function AddWikiDialog({ open, onClose, onAdded }: AddWikiDialogProps) {
    const [name, setName] = useState('');
    const [repoPath, setRepoPath] = useState('');
    const [color, setColor] = useState(COLOR_PRESETS[0]);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = useCallback(async () => {
        if (!name.trim()) { setError('Name is required'); return; }
        if (!repoPath.trim()) { setError('Repository path is required'); return; }
        setSubmitting(true);
        setError('');
        try {
            const res = await fetch(getApiBase() + '/wikis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), repoPath: repoPath.trim(), color }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({ error: 'Failed to create wiki' }));
                setError(body.error || 'Failed to create wiki');
                setSubmitting(false);
                return;
            }
            setName('');
            setRepoPath('');
            setColor(COLOR_PRESETS[0]);
            onAdded();
            onClose();
        } catch {
            setError('Network error');
        }
        setSubmitting(false);
    }, [name, repoPath, color, onAdded, onClose]);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Add Wiki"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button loading={submitting} onClick={handleSubmit}>Create</Button>
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
                        placeholder="My Project Wiki"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium mb-1">Repository Path</label>
                    <input
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                        value={repoPath}
                        onChange={e => { setRepoPath(e.target.value); setError(''); }}
                        placeholder="/path/to/repo"
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
