import { useState, useCallback, useEffect, useMemo } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button, cn } from '../../ui';
import { useCocClient } from '../../repos/cloneRouting';
import type { WorkItemSyncProvider } from '@plusplusoneplusplus/coc-client';

export interface ImportFromGitHubDialogProps {
    open: boolean;
    onClose: () => void;
    workspaceId: string;
    originId?: string;
    initialProvider?: WorkItemSyncProvider;
    providerOptions?: readonly WorkItemSyncProvider[];
    onImported?: (item: any, provider: WorkItemSyncProvider) => void;
}

const PROVIDER_OPTIONS: Array<{ provider: WorkItemSyncProvider; label: string; description: string }> = [
    { provider: 'github', label: 'GitHub', description: 'Import an Epic issue tree' },
    { provider: 'azure-boards', label: 'Azure Boards', description: 'Import an Epic work item tree' },
];

export function ImportFromGitHubDialog({
    open,
    onClose,
    workspaceId,
    originId,
    initialProvider = 'github',
    providerOptions,
    onImported,
}: ImportFromGitHubDialogProps) {
    const cloneClient = useCocClient(workspaceId); // AC-07: import onto the selected clone's server.
    const workItemOriginId = originId ?? workspaceId;
    const providerOptionsKey = providerOptions?.join('|') ?? 'all';
    const allowedProviders = useMemo(() => {
        if (providerOptionsKey === 'all') return undefined;
        return new Set(providerOptionsKey.split('|') as WorkItemSyncProvider[]);
    }, [providerOptionsKey]);
    const visibleProviderOptions = useMemo(
        () => PROVIDER_OPTIONS.filter(option => !allowedProviders || allowedProviders.has(option.provider)),
        [allowedProviders],
    );
    const defaultProvider = visibleProviderOptions[0]?.provider ?? initialProvider;
    const [provider, setProvider] = useState<WorkItemSyncProvider>(initialProvider);
    const [remoteInput, setRemoteInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setProvider(visibleProviderOptions.some(option => option.provider === initialProvider) ? initialProvider : defaultProvider);
            setRemoteInput('');
            setLoading(false);
            setError(null);
        }
    }, [open, initialProvider, defaultProvider, visibleProviderOptions]);

    const handleImport = useCallback(async () => {
        const trimmedInput = remoteInput.trim();
        if (!trimmedInput) {
            setError(provider === 'github'
                ? 'Please enter a GitHub issue URL or issue number'
                : 'Please enter an Azure Boards work item URL or ID');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            if (provider === 'github') {
                const request = /^\d+$/.test(trimmedInput)
                    ? { issueNumber: Number(trimmedInput) }
                    : { issueUrl: trimmedInput };
                const item = await cloneClient.workItems.importFromGitHubForOrigin(workItemOriginId, request, { workspaceId });
                onImported?.(item, provider);
            } else {
                const request = /^\d+$/.test(trimmedInput)
                    ? { workItemId: Number(trimmedInput) }
                    : { workItemUrl: trimmedInput };
                const item = await cloneClient.workItems.importFromAzureBoardsForOrigin(workItemOriginId, request, { workspaceId });
                onImported?.(item, provider);
            }
            onClose();
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError(provider === 'github' ? 'Failed to import issue' : 'Failed to import Azure Boards work item');
            }
        } finally {
            setLoading(false);
        }
    }, [workspaceId, workItemOriginId, provider, remoteInput, onImported, onClose, cloneClient]);

    const isGitHub = provider === 'github';
    const inputTestId = isGitHub ? 'import-github-issue-input' : 'import-azure-boards-work-item-input';
    const errorTestId = isGitHub ? 'import-github-error' : 'import-azure-boards-error';

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Import Remote Work Item"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={loading}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleImport} disabled={loading || !remoteInput.trim()} loading={loading}>
                        {loading ? 'Importing…' : 'Import'}
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                {visibleProviderOptions.length > 1 && (
                    <div className="grid grid-cols-2 gap-2" data-testid="import-provider-selector">
                        {visibleProviderOptions.map(option => {
                            const active = provider === option.provider;
                            return (
                                <button
                                    key={option.provider}
                                    type="button"
                                    className={cn(
                                        'rounded-md border px-3 py-2 text-left transition-colors',
                                        active
                                            ? 'border-[#0969da] bg-[#ddf4ff] text-[#0969da] dark:border-[#0969da] dark:bg-[#0969da]/15 dark:text-[#58a6ff]'
                                            : 'border-[#d0d7de] dark:border-[#555] text-[#57606a] dark:text-[#9da7b3] hover:border-[#0969da]',
                                    )}
                                    onClick={() => {
                                        setProvider(option.provider);
                                        setRemoteInput('');
                                        setError(null);
                                    }}
                                    aria-pressed={active}
                                    data-testid={`import-provider-${option.provider}`}
                                >
                                    <span className="block text-xs font-semibold">{option.label}</span>
                                    <span className="block text-[11px] opacity-75">{option.description}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
                <div>
                    <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">
                        {isGitHub ? 'GitHub Issue URL or number' : 'Azure Boards work item URL or ID'}
                    </label>
                    <input
                        type="text"
                        className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                        value={remoteInput}
                        onChange={e => setRemoteInput(e.target.value)}
                        placeholder={isGitHub
                            ? '123 or https://github.com/<owner>/<repo>/issues/123'
                            : '12345 or https://dev.azure.com/<org>/<project>/_workitems/edit/12345'}
                        disabled={loading}
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleImport();
                            }
                        }}
                        data-testid={inputTestId}
                    />
                </div>
                <p className="text-[11px] text-[#848484] dark:text-[#999]">
                    {isGitHub
                        ? 'Paste a full issue URL or enter an issue number from your workspace-configured GitHub repository.'
                        : 'Paste a full work item URL or enter an ID from your workspace-configured Azure Boards project.'}
                </p>
            </div>
            {error && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-2" data-testid={errorTestId}>
                    {error}
                </p>
            )}
        </Dialog>
    );
}
