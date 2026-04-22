import { useState, useEffect, useCallback } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui';
import { fetchApi } from '../../hooks/useApi';

export interface CreateWorkItemDialogProps {
    open: boolean;
    onClose: () => void;
    workspaceId: string;
    onCreated?: (item: any) => void;
    /** Pre-fill from a chat session */
    fromChatId?: string;
    /** Work item type — 'work-item' (default) or 'bug'. */
    itemType?: 'work-item' | 'bug';
}

export function CreateWorkItemDialog({ open, onClose, workspaceId, onCreated, fromChatId, itemType = 'work-item' }: CreateWorkItemDialogProps) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState<'normal' | 'high' | 'low'>('normal');
    const [tags, setTags] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setTitle('');
            setDescription('');
            setPriority('normal');
            setTags('');
            setLoading(false);
            setError(null);
        }
    }, [open]);

    const handleSubmit = useCallback(async () => {
        if (!fromChatId && !title.trim()) {
            setError('Title is required');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const basePath = `/workspaces/${encodeURIComponent(workspaceId)}/work-items`;
            let data: any;
            if (fromChatId) {
                data = await fetchApi(basePath + '/from-chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ processId: fromChatId }),
                });
            } else {
                const parsedTags = tags.split(',').map(t => t.trim()).filter(Boolean);
                data = await fetchApi(basePath, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: title.trim(),
                        description: description.trim() || undefined,
                        priority,
                        tags: parsedTags.length > 0 ? parsedTags : undefined,
                        source: 'manual',
                        type: itemType,
                    }),
                });
            }
            onCreated?.(data);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create work item');
        } finally {
            setLoading(false);
        }
    }, [workspaceId, fromChatId, title, description, priority, tags, onCreated, onClose]);

    const isBug = itemType === 'bug';
    const dialogTitle = isBug ? 'Create Bug' : 'Create Work Item';
    const titlePlaceholder = isBug ? 'Bug title' : 'Work item title';

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={dialogTitle}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={loading}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleSubmit} disabled={loading} loading={loading}>
                        {loading ? 'Creating…' : 'Create'}
                    </Button>
                </>
            }
        >
            {fromChatId && (
                <p className="text-xs text-[#0078d4] dark:text-[#3794ff] mb-3">
                    💬 Creating from chat session
                </p>
            )}
            {!fromChatId && (
                <div className="space-y-3">
                    <div>
                        <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">Title *</label>
                        <input
                            type="text"
                            className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder={titlePlaceholder}
                            disabled={loading}
                            onKeyDown={e => {
                                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                    e.preventDefault();
                                    handleSubmit();
                                }
                            }}
                            data-testid="create-work-item-title"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">Description</label>
                        <textarea
                            className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                            rows={4}
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Optional description…"
                            disabled={loading}
                            data-testid="create-work-item-description"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">Priority</label>
                        <select
                            className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                            value={priority}
                            onChange={e => setPriority(e.target.value as 'normal' | 'high' | 'low')}
                            disabled={loading}
                            data-testid="create-work-item-priority"
                        >
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                            <option value="low">Low</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">Tags</label>
                        <input
                            type="text"
                            className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                            value={tags}
                            onChange={e => setTags(e.target.value)}
                            placeholder="Comma-separated tags (e.g., frontend, bug)"
                            disabled={loading}
                            data-testid="create-work-item-tags"
                        />
                    </div>
                </div>
            )}
            {error && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-2" data-testid="create-work-item-error">{error}</p>
            )}
        </Dialog>
    );
}
