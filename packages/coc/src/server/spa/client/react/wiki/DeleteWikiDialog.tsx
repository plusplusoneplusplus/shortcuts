import { useState, useCallback } from 'react';
import { Dialog, Button } from '../shared';
import { getApiBase } from '../utils/config';

interface DeleteWikiDialogProps {
    open: boolean;
    wiki: { id: string; name?: string; title?: string };
    onClose: () => void;
    onDeleted: () => void;
}

export function DeleteWikiDialog({ open, wiki, onClose, onDeleted }: DeleteWikiDialogProps) {
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const name = wiki.name || wiki.title || wiki.id;

    const handleDelete = useCallback(async () => {
        setSubmitting(true);
        setError('');
        try {
            const res = await fetch(getApiBase() + '/wikis/' + encodeURIComponent(wiki.id), {
                method: 'DELETE',
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({ error: 'Failed to delete wiki' }));
                setError(body.error || 'Failed to delete wiki');
                setSubmitting(false);
                return;
            }
            onDeleted();
        } catch {
            setError('Network error');
        }
        setSubmitting(false);
    }, [wiki.id, onDeleted]);

    return (
        <Dialog
            id="delete-wiki-overlay"
            open={open}
            onClose={onClose}
            title="Delete Wiki"
            footer={
                <>
                    <Button variant="secondary" id="delete-wiki-cancel-btn" onClick={onClose}>Cancel</Button>
                    <Button variant="danger" loading={submitting} id="delete-wiki-confirm" onClick={handleDelete}>Delete</Button>
                </>
            }
        >
            <p className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                Are you sure you want to delete <strong id="delete-wiki-name">{name}</strong>? This action cannot be undone.
            </p>
            {error && <p className="text-xs text-[#f14c4c] mt-2">{error}</p>}
        </Dialog>
    );
}
