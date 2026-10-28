import { useEffect, useState } from 'react';
import type { WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { useAdminServer } from './adminTarget';
import { isRepoGroupWorkspaceId } from '../repos/virtualWorkspaceIds';

export function AdminWorkspaceSelect({ value, onChange, label, includeRepoGroups = false, 'data-testid': testId }: {
    value: string;
    onChange(value: string): void;
    label: string;
    includeRepoGroups?: boolean;
    'data-testid': string;
}) {
    const adminServer = useAdminServer();
    const [workspaces, setWorkspaces] = useState<WorkspaceInfo[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let current = true;
        setWorkspaces(null);
        setError(null);
        void adminServer.client.workspaces.list().then(result => {
            if (current) setWorkspaces(result.workspaces.filter(workspace =>
                (!workspace.virtual || (includeRepoGroups && isRepoGroupWorkspaceId(workspace.id)))
                && !!workspace.rootPath?.trim()));
        }).catch(() => {
            if (current) setError('Unable to load workspaces from the configured machine. Retry before selecting a target.');
        });
        return () => { current = false; };
    }, [adminServer, retry, includeRepoGroups]);
    const unavailable = workspaces !== null && value !== '' && !workspaces.some(workspace => workspace.id === value);
    return (
        <div className="ar-workspace-select">
            <select className="ar-select ar-med" aria-label={label} data-testid={testId}
                value={value} disabled={workspaces === null}
                onChange={event => onChange(event.target.value)}>
                <option value="">{workspaces === null ? 'Loading workspaces...'
                    : includeRepoGroups ? 'Select a local workspace or repo group' : 'Select a local workspace'}</option>
                {value && !workspaces?.some(workspace => workspace.id === value) && (
                    <option value={value}>{value} (unavailable)</option>
                )}
                {workspaces?.map(workspace => (
                    <option key={workspace.id} value={workspace.id}>
                        {workspace.name}{workspace.virtual ? ' [Repo group]' : ''} ({workspace.id})
                    </option>
                ))}
            </select>
            {unavailable && <p className="ar-teams-error" role="alert">The saved workspace is not available on this machine. Select a registered local workspace{includeRepoGroups ? ' or repo group' : ''}.</p>}
            {workspaces?.length === 0 && <p className="ar-hint">Register a local workspace{includeRepoGroups ? ' or repo group' : ''} on this machine first.</p>}
            {error && <p className="ar-teams-error" role="alert">{error}</p>}
            <button type="button" className="ar-btn ar-btn-ghost ar-btn-sm"
                onClick={() => setRetry(current => current + 1)} aria-label={`Refresh ${label.toLowerCase()} list`}>
                Refresh workspaces
            </button>
        </div>
    );
}
