/**
 * ProviderTokensSection — Admin panel card for viewing and updating provider tokens.
 * Loads current sanitized config (tokens shown as ****) via GET /api/providers/config
 * and saves updates via PUT /api/providers/config.
 */

import { useState, useEffect } from 'react';
import { Card } from '../shared';
import { getApiBase } from '../utils/config';

interface ProviderTokensSectionProps {
    onError: (msg: string) => void;
    onSuccess: (msg: string) => void;
}

type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

export function ProviderTokensSection({ onError, onSuccess }: ProviderTokensSectionProps) {
    const [hasGithubToken, setHasGithubToken] = useState(false);
    const [adoOrgUrlSaved, setAdoOrgUrlSaved] = useState('');

    const [githubToken, setGithubToken] = useState('');
    const [showGithubToken, setShowGithubToken] = useState(false);

    const [adoOrgUrl, setAdoOrgUrl] = useState('');

    const [githubStatus, setGithubStatus] = useState<SaveStatus>('idle');
    const [githubError, setGithubError] = useState('');
    const [adoStatus, setAdoStatus] = useState<SaveStatus>('idle');
    const [adoError, setAdoError] = useState('');

    useEffect(() => {
        async function load() {
            try {
                const res = await fetch(getApiBase() + '/providers/config');
                if (!res.ok) throw new Error('Failed to load provider config');
                const data = await res.json();
                const providers = data?.providers ?? {};
                setHasGithubToken(!!providers?.github?.hasToken);
                if (providers?.ado?.orgUrl) {
                    setAdoOrgUrlSaved(providers.ado.orgUrl);
                    setAdoOrgUrl(providers.ado.orgUrl);
                }
            } catch (err: any) {
                onError(err.message || 'Failed to load provider config');
            }
        }
        load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSaveGithub = async () => {
        if (!githubToken.trim()) return;
        setGithubStatus('saving');
        setGithubError('');
        try {
            const res = await fetch(getApiBase() + '/providers/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ github: { token: githubToken } }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error((body as any).error || `Error ${res.status}`);
            }
            setGithubToken('');
            setHasGithubToken(true);
            setGithubStatus('success');
            onSuccess('GitHub token saved');
            setTimeout(() => setGithubStatus('idle'), 3000);
        } catch (err: any) {
            setGithubError(err.message || 'Failed to save');
            setGithubStatus('error');
        }
    };

    const handleSaveAdo = async () => {
        if (!adoOrgUrl.trim()) return;
        setAdoStatus('saving');
        setAdoError('');
        try {
            const res = await fetch(getApiBase() + '/providers/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ado: { orgUrl: adoOrgUrl } }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error((body as any).error || `Error ${res.status}`);
            }
            setAdoOrgUrlSaved(adoOrgUrl);
            setAdoStatus('success');
            onSuccess('ADO settings saved');
            setTimeout(() => setAdoStatus('idle'), 3000);
        } catch (err: any) {
            setAdoError(err.message || 'Failed to save');
            setAdoStatus('error');
        }
    };

    const inputClass = 'flex-1 px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]';
    const labelClass = 'text-xs w-28 shrink-0 text-[#616161] dark:text-[#999]';
    const subHeadClass = 'text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2';

    return (
        <Card className="p-4" data-testid="provider-tokens-section">
            <h3 className="text-sm font-semibold mb-3 text-[#1e1e1e] dark:text-[#cccccc]">Provider Tokens</h3>
            <p className="text-xs text-[#616161] dark:text-[#999] mb-4">
                Update the GitHub PAT used by the Pull Requests feature. Tokens are stored locally in{' '}
                <span className="font-mono">~/.coc/providers.json</span>.
            </p>

            {/* GitHub */}
            <div className="mb-5" data-testid="github-subsection">
                <p className={subHeadClass}>GitHub</p>
                {hasGithubToken && (
                    <p className="text-xs text-[#616161] dark:text-[#999] mb-2" data-testid="github-token-saved">
                        A token is already saved (<span className="font-mono">****</span>). Enter a new value to replace it.
                    </p>
                )}
                <div className="flex items-center gap-2">
                    <label className={labelClass} htmlFor="github-token-input">GitHub Token</label>
                    <div className="flex flex-1 gap-1">
                        <input
                            id="github-token-input"
                            type={showGithubToken ? 'text' : 'password'}
                            className={inputClass}
                            placeholder={hasGithubToken ? '****' : 'ghp_...'}
                            value={githubToken}
                            onChange={e => setGithubToken(e.target.value)}
                            data-testid="github-token-input"
                        />
                        <button
                            type="button"
                            className="px-2 text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                            onClick={() => setShowGithubToken(v => !v)}
                            aria-label={showGithubToken ? 'Hide GitHub token' : 'Show GitHub token'}
                            data-testid="github-toggle-visibility"
                        >
                            👁
                        </button>
                        <button
                            type="button"
                            className="px-3 py-1 text-sm bg-[#0078d4] hover:bg-[#106ebe] text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={handleSaveGithub}
                            disabled={githubToken.trim() === '' || githubStatus === 'saving'}
                            data-testid="github-save-button"
                        >
                            {githubStatus === 'saving' ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </div>
                {githubStatus === 'success' && (
                    <p className="mt-2 text-xs text-green-600 dark:text-green-400" data-testid="github-save-success">
                        ✅ GitHub token saved.
                    </p>
                )}
                {githubStatus === 'error' && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="github-save-error">
                        ❌ Error: {githubError}
                    </p>
                )}
            </div>

            {/* ADO */}
            <div data-testid="ado-subsection">
                <p className={subHeadClass}>Azure DevOps</p>
                <p className="text-xs text-[#616161] dark:text-[#999] mb-2">
                    Authentication uses <span className="font-mono">az account get-access-token</span> automatically.
                </p>
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <label className={labelClass} htmlFor="ado-org-url-input">Organization URL</label>
                        <input
                            id="ado-org-url-input"
                            type="text"
                            className={inputClass}
                            placeholder={adoOrgUrlSaved || 'https://dev.azure.com/org'}
                            value={adoOrgUrl}
                            onChange={e => setAdoOrgUrl(e.target.value)}
                            data-testid="ado-org-url-input"
                        />
                        <button
                            type="button"
                            className="px-3 py-1 text-sm bg-[#0078d4] hover:bg-[#106ebe] text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={handleSaveAdo}
                            disabled={adoOrgUrl.trim() === '' || adoStatus === 'saving'}
                            data-testid="ado-save-button"
                        >
                            {adoStatus === 'saving' ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </div>
                {adoStatus === 'success' && (
                    <p className="mt-2 text-xs text-green-600 dark:text-green-400" data-testid="ado-save-success">
                        ✅ ADO settings saved.
                    </p>
                )}
                {adoStatus === 'error' && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="ado-save-error">
                        ❌ Error: {adoError}
                    </p>
                )}
            </div>
        </Card>
    );
}
