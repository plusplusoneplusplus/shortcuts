import { useEffect, useState } from 'react';
import type { SkillInfo } from '@plusplusoneplusplus/coc-client';
import { useAdminServer } from './adminTarget';
import { loadEnabledAdminWorkspaceSkills } from './adminWorkspaceSkills';

export function AdminSkillSelect({ workspaceId, value, onChange, label, 'data-testid': testId }: {
    workspaceId: string;
    value: string;
    onChange(value: string): void;
    label: string;
    'data-testid': string;
}) {
    const adminServer = useAdminServer();
    const [result, setResult] = useState<{
        owner: typeof adminServer;
        workspaceId: string;
        skills?: SkillInfo[];
        error?: string;
    } | null>(null);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let current = true;
        setResult(null);
        if (workspaceId) {
            void loadEnabledAdminWorkspaceSkills(adminServer.client, workspaceId).then(skills => {
                if (current) setResult({ owner: adminServer, workspaceId, skills });
            }).catch(() => {
                if (current) setResult({ owner: adminServer, workspaceId,
                    error: 'Unable to load dispatcher skills. Check the execution workspace and refresh before saving.' });
            });
        }
        return () => { current = false; };
    }, [adminServer, workspaceId, retry]);
    const scoped = result?.owner === adminServer && result.workspaceId === workspaceId ? result : null;
    const skills = scoped?.skills;
    const unavailable = skills !== undefined && value !== '' && !skills.some(skill => skill.name === value);
    return (
        <div className="ar-workspace-select">
            <select className="ar-select ar-med" aria-label={label} data-testid={testId}
                value={value} disabled={skills === undefined}
                onChange={event => onChange(event.target.value)}>
                <option value="">{!workspaceId ? 'Select an execution workspace first'
                    : scoped?.error ? 'Skills unavailable'
                    : skills === undefined ? 'Loading skills...' : 'Select a dispatcher skill'}</option>
                {value && !skills?.some(skill => skill.name === value) && (
                    <option value={value}>{value} (unavailable)</option>
                )}
                {skills?.map(skill => <option key={skill.name} value={skill.name}>{skill.name}</option>)}
            </select>
            {unavailable && <p className="ar-teams-error" role="alert">The saved dispatcher skill is missing or disabled in this workspace. Select an enabled skill.</p>}
            {skills?.length === 0 && <p className="ar-hint">Install or enable a dispatcher skill in this workspace first.</p>}
            {scoped?.error && <p className="ar-teams-error" role="alert">{scoped.error}</p>}
            <button type="button" className="ar-btn ar-btn-ghost ar-btn-sm" disabled={!workspaceId}
                onClick={() => setRetry(current => current + 1)} aria-label={`Refresh ${label.toLowerCase()} list`}>
                Refresh skills
            </button>
        </div>
    );
}
