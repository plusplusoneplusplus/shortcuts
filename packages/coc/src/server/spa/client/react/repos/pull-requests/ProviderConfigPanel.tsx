/**
 * ProviderConfigPanel — inline UI shown when a provider is detected from the
 * git remote URL but no credentials are configured. Renders the appropriate
 * token input field(s), saves via PUT /api/providers/config, and re-triggers
 * the PR fetch on success.
 */

import { useState } from 'react';
import { fetchApi } from '../../hooks/useApi';

export interface ProviderConfigPanelProps {
    detected: 'GitHub' | 'ADO' | string | null;
    remoteUrl?: string;
    onConfigured: () => void;
}

export function ProviderConfigPanel({ detected, remoteUrl, onConfigured }: ProviderConfigPanelProps) {
    const [token, setToken] = useState('');
    const [orgUrl, setOrgUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [showToken, setShowToken] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        setSaveError(null);
        const body = detected === 'ADO'
            ? { ado: { token, orgUrl } }
            : { github: { token } };
        try {
            await fetchApi('/providers/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            setSaveSuccess(true);
            setTimeout(() => onConfigured(), 800);
        } catch (err: any) {
            setSaveError(err.message ?? 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const isSaveDisabled = token.trim() === '' || saving;

    if (saveSuccess) {
        return (
            <div
                className="px-4 py-3 bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800"
                data-testid="save-success"
            >
                <p className="text-sm text-green-800 dark:text-green-200">
                    ✅ Configured! Loading pull requests...
                </p>
            </div>
        );
    }

    return (
        <div
            className="px-4 py-4 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800"
            data-testid="provider-config-panel"
        >
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                ⚠️ No provider configured for this repository.
            </p>

            {remoteUrl && (
                <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-1">
                    Remote: <span className="font-mono">{remoteUrl}</span>
                </p>
            )}

            {detected ? (
                <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-3">
                    Detected provider: <strong>{detected}</strong>
                </p>
            ) : (
                <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-3">
                    Provider could not be detected for this remote URL.
                </p>
            )}

            {detected ? (
                <>
                    <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-2">
                        To view pull requests, configure a personal access token:
                    </p>

                    <div className="flex flex-col gap-2">
                        {detected === 'ADO' && (
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-yellow-800 dark:text-yellow-200 w-36 shrink-0">
                                    Organization URL
                                </label>
                                <input
                                    type="text"
                                    className="flex-1 text-sm border border-yellow-300 dark:border-yellow-700 rounded px-2 py-1 bg-white dark:bg-gray-800"
                                    placeholder="https://dev.azure.com/org"
                                    value={orgUrl}
                                    onChange={e => setOrgUrl(e.target.value)}
                                    data-testid="org-url-input"
                                />
                            </div>
                        )}

                        <div className="flex items-center gap-2">
                            <label className="text-xs text-yellow-800 dark:text-yellow-200 w-36 shrink-0">
                                {detected === 'ADO' ? 'Personal Access Token' : 'GitHub Token'}
                            </label>
                            <div className="flex flex-1 gap-1">
                                <input
                                    type={showToken ? 'text' : 'password'}
                                    className="flex-1 text-sm border border-yellow-300 dark:border-yellow-700 rounded px-2 py-1 bg-white dark:bg-gray-800"
                                    placeholder="ghp_..."
                                    value={token}
                                    onChange={e => setToken(e.target.value)}
                                    data-testid="token-input"
                                />
                                <button
                                    type="button"
                                    className="px-2 text-yellow-700 dark:text-yellow-300 hover:text-yellow-900 dark:hover:text-yellow-100"
                                    onClick={() => setShowToken(v => !v)}
                                    aria-label={showToken ? 'Hide token' : 'Show token'}
                                    data-testid="toggle-token-visibility"
                                >
                                    👁
                                </button>
                                <button
                                    type="button"
                                    className="px-3 py-1 text-sm bg-yellow-600 hover:bg-yellow-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={handleSave}
                                    disabled={isSaveDisabled}
                                    data-testid="save-button"
                                >
                                    {saving ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            ) : null}

            {saveError && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="save-error">
                    ❌ Error: {saveError}
                </p>
            )}

            <p className="mt-3 text-xs text-yellow-600 dark:text-yellow-400">
                Token is stored locally in ~/.coc/providers.json
            </p>
        </div>
    );
}
