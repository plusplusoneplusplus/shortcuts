import { useState, useCallback, useEffect } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui';
import { getSpaCocClient } from '../../api/cocClient';

export interface ImportFromGitHubDialogProps {
    open: boolean;
    onClose: () => void;
    workspaceId: string;
    onImported?: (item: any) => void;
}

export function ImportFromGitHubDialog({ open, onClose, workspaceId, onImported }: ImportFromGitHubDialogProps) {
    const [issueUrl, setIssueUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setIssueUrl('');
            setLoading(false);
            setError(null);
        }
    }, [open]);

    const handleImport = useCallback(async () => {
        const trimmedUrl = issueUrl.trim();
        if (!trimmedUrl) {
            setError('Please enter a GitHub issue URL');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const item = await getSpaCocClient().workItems.importFromGitHub(workspaceId, { issueUrl: trimmedUrl });
            onImported?.(item);
            onClose();
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError('Failed to import issue');
            }
        } finally {
            setLoading(false);
        }
    }, [workspaceId, issueUrl, onImported, onClose]);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Import GitHub Issue"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={loading}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleImport} disabled={loading || !issueUrl.trim()} loading={loading}>
                        {loading ? 'Importing…' : 'Import'}
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <div>
                    <label className="block text-xs font-medium text-[#848484] dark:text-[#999] mb-1">
                        GitHub Issue URL
                    </label>
                    <input
                        type="url"
                        className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                        value={issueUrl}
                        onChange={e => setIssueUrl(e.target.value)}
                        placeholder="https://github.com/<owner>/<repo>/issues/<number>"
                        disabled={loading}
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleImport();
                            }
                        }}
                        data-testid="import-github-url-input"
                    />
                </div>
                <p className="text-[11px] text-[#848484] dark:text-[#999]">
                    Imports the issue from your workspace-configured GitHub repository and creates a mirrored Epic tree.
                </p>
            </div>
            {error && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-2" data-testid="import-github-error">
                    {error}
                </p>
            )}
        </Dialog>
    );
}
