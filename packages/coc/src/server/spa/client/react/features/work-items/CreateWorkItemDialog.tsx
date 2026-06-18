import { useState, useEffect, useCallback } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui';
import { useCocClient } from '../../repos/cloneRouting';
import { isWorkItemsHierarchyEnabled, isWorkItemsWorkflowEnabled } from '../../utils/config';
import { resolveWorkItemOriginId } from './workItemOriginScope';

type WorkItemTypeAll = 'work-item' | 'bug' | 'goal' | 'epic' | 'feature' | 'pbi';

const TYPE_LABELS: Record<WorkItemTypeAll, string> = {
    epic:        'Epic',
    feature:     'Feature',
    pbi:         'PBI / Story',
    'work-item': 'Work Item',
    bug:         'Bug',
    goal:        'Goal',
};

export interface CreateWorkItemDialogProps {
    open: boolean;
    onClose: () => void;
    workspaceId: string;
    originId?: string;
    onCreated?: (item: any) => void;
    /** Pre-fill from a chat session */
    fromChatId?: string;
    /** Work item type — 'work-item' (default), 'bug', or hierarchy types when enabled. */
    itemType?: WorkItemTypeAll;
    /** Parent work item ID (hierarchy). Only used when hierarchy is enabled. */
    parentId?: string;
}

export function CreateWorkItemDialog({ open, onClose, workspaceId, originId, onCreated, fromChatId, itemType = 'work-item', parentId }: CreateWorkItemDialogProps) {
    const cloneClient = useCocClient(workspaceId); // AC-07: create on the selected clone's server.
    const workItemOriginId = originId ?? resolveWorkItemOriginId({ workspaceId });
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState<'normal' | 'high' | 'low'>('normal');
    const [tags, setTags] = useState('');
    const [successCriteria, setSuccessCriteria] = useState('');
    const [selectedType, setSelectedType] = useState<WorkItemTypeAll>(itemType);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hierarchyEnabled = isWorkItemsHierarchyEnabled();
    const workflowEnabled = isWorkItemsWorkflowEnabled();

    useEffect(() => {
        if (open) {
            setTitle('');
            setDescription('');
            setPriority('normal');
            setTags('');
            setSuccessCriteria('');
            setSelectedType(itemType);
            setLoading(false);
            setError(null);
        }
    }, [open, itemType]);

    const handleSubmit = useCallback(async () => {
        if (!fromChatId && !title.trim()) {
            setError('Title is required');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            let data: any;
            if (fromChatId) {
                data = await cloneClient.workItems.createFromChat(workspaceId, { processId: fromChatId });
            } else {
                const parsedTags = tags.split(',').map(t => t.trim()).filter(Boolean);
                data = await cloneClient.workItems.createForOrigin(workItemOriginId, {
                    title: title.trim(),
                    description: description.trim() || undefined,
                    priority,
                    tags: parsedTags.length > 0 ? parsedTags : undefined,
                    source: 'manual',
                    type: selectedType,
                    successCriteria: (selectedType === 'goal' && successCriteria.trim()) ? successCriteria.trim() : undefined,
                    parentId: (hierarchyEnabled && parentId) ? parentId : undefined,
                }, { workspaceId });
            }
            onCreated?.(data);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create work item');
        } finally {
            setLoading(false);
        }
    }, [workspaceId, workItemOriginId, fromChatId, title, description, priority, tags, successCriteria, selectedType, hierarchyEnabled, parentId, onCreated, onClose, cloneClient]);

    const effectiveType = selectedType;
    const isBug = effectiveType === 'bug';
    const isContainer = ['epic', 'feature', 'pbi'].includes(effectiveType);
    const workflowShellType = workflowEnabled && (effectiveType === 'work-item' || effectiveType === 'goal');
    const showTypeSelector = hierarchyEnabled || workflowShellType;
    const typeOptions: WorkItemTypeAll[] = hierarchyEnabled
        ? ['epic', 'feature', 'pbi', 'work-item', 'bug', 'goal']
        : ['work-item', 'goal'];
    const dialogTitle = hierarchyEnabled
        ? `Create ${TYPE_LABELS[effectiveType]}`
        : workflowShellType ? 'Create Work Item or Goal'
        : (isBug ? 'Create Bug' : 'Create Work Item');
    const titlePlaceholder = effectiveType === 'goal'
        ? 'Goal title'
        : isBug ? 'Bug title' : isContainer ? `${TYPE_LABELS[effectiveType]} title` : 'Work item title';

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
                    {/* Type selector — hierarchy shows all types; workflow v1 exposes Work Item vs Goal. */}
                    {showTypeSelector && (
                        <div>
                            <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">Type</label>
                            <select
                                className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                value={selectedType}
                                onChange={e => setSelectedType(e.target.value as WorkItemTypeAll)}
                                disabled={loading}
                                data-testid="create-work-item-type"
                            >
                                {typeOptions.map(type => (
                                    <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                                ))}
                            </select>
                        </div>
                    )}
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
                    {effectiveType === 'goal' && (
                        <div>
                            <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">Success Criteria</label>
                            <textarea
                                className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                rows={3}
                                value={successCriteria}
                                onChange={e => setSuccessCriteria(e.target.value)}
                                placeholder="What defines this goal as achieved?"
                                disabled={loading}
                                data-testid="create-work-item-success-criteria"
                            />
                        </div>
                    )}
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
