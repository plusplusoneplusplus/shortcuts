import { useEffect, useMemo, useState } from 'react';
import type { EnDevXDpuWorkspaceConfig } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useGlobalToast } from '../../contexts/ToastContext';

interface EnDevXDpuSettingsSectionProps {
    workspaceId: string;
    rootPath: string;
    initialConfig?: EnDevXDpuWorkspaceConfig;
}

interface WslWorkspaceDefaults {
    supported: boolean;
    wslDistro?: string;
    xstoreRepoRoot?: string;
}

export function deriveEnDevXDpuWorkspaceDefaults(rootPath: string): WslWorkspaceDefaults {
    const trimmed = rootPath.trim();
    if (!trimmed) {
        return { supported: false };
    }

    const wslUnc = trimmed.match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)?$/i);
    if (wslUnc) {
        const suffix = (wslUnc[2] ?? '').replace(/^\\+/, '').replace(/\\/g, '/');
        return {
            supported: true,
            wslDistro: wslUnc[1],
            xstoreRepoRoot: suffix ? `/${suffix}` : '/',
        };
    }

    const wslUri = trimmed.match(/^wsl:\/\/([^/]+)(\/.*)?$/i);
    if (wslUri) {
        return {
            supported: true,
            wslDistro: wslUri[1].toLowerCase() === 'default' ? undefined : wslUri[1],
            xstoreRepoRoot: wslUri[2] ?? '/',
        };
    }

    if (trimmed.startsWith('/')) {
        return { supported: true, xstoreRepoRoot: trimmed };
    }

    return { supported: false };
}

function applyDefaults(
    config: EnDevXDpuWorkspaceConfig | undefined,
    defaults: WslWorkspaceDefaults,
): EnDevXDpuWorkspaceConfig {
    return {
        enabled: config?.enabled === true,
        wslDistro: config?.wslDistro ?? defaults.wslDistro ?? '',
        xstoreRepoRoot: config?.xstoreRepoRoot ?? defaults.xstoreRepoRoot ?? '',
    };
}

function normalizeForSave(config: EnDevXDpuWorkspaceConfig): EnDevXDpuWorkspaceConfig {
    const wslDistro = config.wslDistro?.trim();
    const xstoreRepoRoot = config.xstoreRepoRoot?.trim();
    return {
        enabled: config.enabled === true,
        ...(wslDistro ? { wslDistro } : {}),
        ...(xstoreRepoRoot ? { xstoreRepoRoot } : {}),
    };
}

export function EnDevXDpuSettingsSection({
    workspaceId,
    rootPath,
    initialConfig,
}: EnDevXDpuSettingsSectionProps) {
    const { addToast } = useGlobalToast();
    const defaults = useMemo(() => deriveEnDevXDpuWorkspaceDefaults(rootPath), [rootPath]);
    const [config, setConfig] = useState<EnDevXDpuWorkspaceConfig>(() => applyDefaults(initialConfig, defaults));
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setConfig(applyDefaults(initialConfig, defaults));
        setDirty(false);
        setError(null);
    }, [defaults, initialConfig]);

    async function persist(nextConfig: EnDevXDpuWorkspaceConfig, successMessage?: string): Promise<boolean> {
        const normalized = normalizeForSave(nextConfig);
        setSaving(true);
        setError(null);
        try {
            await getSpaCocClient().workspaces.update(workspaceId, { endevXDpu: normalized });
            setConfig(applyDefaults(normalized, defaults));
            setDirty(false);
            if (successMessage) {
                addToast(successMessage, 'success');
            }
            return true;
        } catch (e: unknown) {
            setError(getSpaCocClientErrorMessage(e, 'Failed to save EnDev-xDpu settings'));
            return false;
        } finally {
            setSaving(false);
        }
    }

    async function handleToggle(enabled: boolean) {
        if (enabled && !defaults.supported) {
            setError('EnDev-xDpu requires a WSL workspace root.');
            return;
        }

        const previous = config;
        const next = applyDefaults({ ...config, enabled }, defaults);
        setConfig(next);
        const saved = await persist(next, enabled ? 'EnDev-xDpu enabled' : 'EnDev-xDpu disabled');
        if (!saved) {
            setConfig(previous);
        }
    }

    function updateField(field: 'wslDistro' | 'xstoreRepoRoot', value: string) {
        setConfig(prev => ({ ...prev, [field]: value }));
        setDirty(true);
    }

    const unsupported = !defaults.supported;

    return (
        <section className="flex flex-col gap-4 max-w-2xl" data-testid="endev-xdpu-settings-section">
            <div>
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">EnDev-xDpu</h3>
                <p className="text-xs text-[#6a6a6a] dark:text-[#9d9d9d]">
                    Enable workspace-local EnDev xDPU capabilities for WSL xStore repos without using nested EnDev Copilot sessions.
                </p>
            </div>

            <label className="flex items-start gap-3 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-3">
                <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={config.enabled === true}
                    disabled={saving || unsupported}
                    onChange={e => handleToggle(e.currentTarget.checked)}
                    data-testid="endev-xdpu-toggle"
                />
                <span className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">Enable EnDev-xDpu for this workspace</span>
                    <span className="text-xs text-[#6a6a6a] dark:text-[#9d9d9d]">
                        Disabled by default. When enabled, CoC stores only the WSL distro and xStore WSL repo root in this workspace setting.
                    </span>
                </span>
            </label>

            {unsupported && (
                <div className="text-xs text-amber-700 dark:text-amber-300" data-testid="endev-xdpu-unsupported">
                    This workspace root is not a WSL path. Register a WSL repo path such as \\wsl$\Ubuntu\home\xstore or a Linux absolute path.
                </div>
            )}

            {config.enabled && (
                <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-2 items-center">
                    <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]" htmlFor="endev-xdpu-distro">
                        WSL distro
                    </label>
                    <input
                        id="endev-xdpu-distro"
                        className="text-xs text-[#1e1e1e] dark:text-[#cccccc] bg-transparent border border-[#848484]/40 rounded px-2 py-1.5 focus:outline-none focus:border-[#0078d4] dark:focus:border-[#3794ff]"
                        value={config.wslDistro ?? ''}
                        placeholder="Ubuntu"
                        disabled={saving}
                        onChange={e => updateField('wslDistro', e.currentTarget.value)}
                        data-testid="endev-xdpu-distro"
                    />
                    <label className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]" htmlFor="endev-xdpu-root">
                        xStore WSL repo root
                    </label>
                    <input
                        id="endev-xdpu-root"
                        className="text-xs text-[#1e1e1e] dark:text-[#cccccc] bg-transparent border border-[#848484]/40 rounded px-2 py-1.5 focus:outline-none focus:border-[#0078d4] dark:focus:border-[#3794ff]"
                        value={config.xstoreRepoRoot ?? ''}
                        placeholder="/home/user/xstore"
                        disabled={saving}
                        onChange={e => updateField('xstoreRepoRoot', e.currentTarget.value)}
                        data-testid="endev-xdpu-root"
                    />
                </div>
            )}

            {config.enabled && (
                <div className="flex items-center gap-2">
                    <button
                        className="px-3 py-1.5 text-xs rounded bg-[#0078d4] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!dirty || saving}
                        onClick={() => persist(config, 'EnDev-xDpu settings saved')}
                        data-testid="endev-xdpu-save"
                    >
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                    {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
                </div>
            )}

            {!config.enabled && error && (
                <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
            )}
        </section>
    );
}
