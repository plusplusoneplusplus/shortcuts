import { useEffect, useMemo, useState } from 'react';
import type { EnDevXDpuActivationResponse, EnDevXDpuWorkspaceConfig } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useGlobalToast } from '../../contexts/ToastContext';

interface EnDevXDpuSettingsSectionProps {
    workspaceId: string;
    rootPath: string;
    initialConfig?: EnDevXDpuWorkspaceConfig;
    onActivated?: (result: EnDevXDpuActivationResponse) => void;
}

interface WslWorkspaceDefaults {
    supported: boolean;
    requiresDistro?: boolean;
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
            requiresDistro: true,
            wslDistro: wslUnc[1],
            xstoreRepoRoot: suffix ? `/${suffix}` : '/',
        };
    }

    const wslUri = trimmed.match(/^wsl:\/\/([^/]+)(\/.*)?$/i);
    if (wslUri) {
        return {
            supported: true,
            requiresDistro: true,
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
        ...(config?.mcpConfigPath ? { mcpConfigPath: config.mcpConfigPath } : {}),
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
    onActivated,
}: EnDevXDpuSettingsSectionProps) {
    const { addToast } = useGlobalToast();
    const defaults = useMemo(() => deriveEnDevXDpuWorkspaceDefaults(rootPath), [rootPath]);
    const [config, setConfig] = useState<EnDevXDpuWorkspaceConfig>(() => applyDefaults(initialConfig, defaults));
    const [saving, setSaving] = useState(false);
    const [discovering, setDiscovering] = useState(false);
    const [discovery, setDiscovery] = useState<EnDevXDpuActivationResponse | null>(null);
    const [dirty, setDirty] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setConfig(applyDefaults(initialConfig, defaults));
        setDirty(false);
        setDiscovery(null);
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
        setDiscovery(null);
    }

    async function handleDiscover() {
        const normalized = normalizeForSave(config);
        if (!normalized.enabled) {
            setError('Enable EnDev-xDpu before running setup discovery.');
            return;
        }
        if (unsupported) {
            setError('EnDev-xDpu requires a WSL workspace root.');
            return;
        }
        if (defaults.requiresDistro && !normalized.wslDistro) {
            setError('Enter the WSL distro for this xStore workspace.');
            return;
        }
        if (!normalized.xstoreRepoRoot) {
            setError('Enter the xStore WSL repo root as a Linux absolute path.');
            return;
        }

        setDiscovering(true);
        setDiscovery(null);
        setError(null);
        try {
            if (dirty) {
                const saved = await persist(config);
                if (!saved) {
                    return;
                }
            }

            const result = await getSpaCocClient().workspaces.discoverEnDevXDpu(workspaceId);
            setConfig(applyDefaults({
                enabled: true,
                wslDistro: result.wslDistro,
                xstoreRepoRoot: result.xstoreRepoRoot,
                ...(result.mcpConfigPath ? { mcpConfigPath: result.mcpConfigPath } : {}),
            }, defaults));
            setDirty(false);
            setDiscovery(result);
            onActivated?.(result);
            addToast('EnDev-xDpu setup validated and skills refreshed', 'success');
        } catch (e: unknown) {
            setError(getSpaCocClientErrorMessage(e, 'Failed to run EnDev-xDpu setup discovery'));
        } finally {
            setDiscovering(false);
        }
    }

    const unsupported = !defaults.supported;
    const busy = saving || discovering;

    if (unsupported) {
        return null;
    }

    return (
        <section className="flex flex-col gap-4 max-w-2xl" data-testid="endev-xdpu-settings-section">
            <div>
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">EnDev-xDpu WSL bundle</h3>
                <p className="text-xs text-[#6a6a6a] dark:text-[#9d9d9d]">
                    Enables the CoC integration bundle for xDPU development workspaces that live inside WSL. The EnDev bundle must already be set up in this WSL environment; CoC links its plugin skills, stores the Linux xStore root on this workspace, and either bridges the WSL MCP server from Windows or uses native local MCP when CoC runs inside WSL.
                </p>
            </div>

            <label className="flex items-start gap-3 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-3">
                <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={config.enabled === true}
                    disabled={busy || unsupported}
                    onChange={e => handleToggle(e.currentTarget.checked)}
                    data-testid="endev-xdpu-toggle"
                />
                <span className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">Enable EnDev-xDpu for this workspace</span>
                    <span className="text-xs text-[#6a6a6a] dark:text-[#9d9d9d]">
                        Disabled by default. Use this only for WSL xDPU workspaces where EnDev is installed and `endev doctor` passes inside the distro.
                    </span>
                </span>
            </label>

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
                        disabled={busy}
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
                        disabled={busy}
                        onChange={e => updateField('xstoreRepoRoot', e.currentTarget.value)}
                        data-testid="endev-xdpu-root"
                    />
                </div>
            )}

            {config.enabled && (
                <div className="flex items-center gap-2">
                    <button
                        className="px-3 py-1.5 text-xs rounded bg-[#0078d4] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!dirty || busy}
                        onClick={() => persist(config, 'EnDev-xDpu settings saved')}
                        data-testid="endev-xdpu-save"
                    >
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                        className="px-3 py-1.5 text-xs rounded border border-[#848484]/40 text-[#1e1e1e] dark:text-[#cccccc] disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={busy}
                        onClick={handleDiscover}
                        data-testid="endev-xdpu-discover"
                    >
                        {discovering ? 'Running setup...' : dirty ? 'Save and run setup' : 'Run setup check'}
                    </button>
                    {error && <span className="text-xs text-red-600 dark:text-red-400" data-testid="endev-xdpu-discovery-error">{error}</span>}
                </div>
            )}

            {config.enabled && discovery && (
                <div
                    className="rounded border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/20 p-3 text-xs text-green-800 dark:text-green-200"
                    data-testid="endev-xdpu-discovery-success"
                >
                    <div className="font-medium">EnDev setup is ready for this workspace.</div>
                    <div className="mt-1">
                        Added plugin skills from <code className="font-mono">{discovery.extraSkillFolder}</code> and bridged <code className="font-mono">funbird-mcp</code>.
                    </div>
                    {discovery.mcpConfigPath && (
                        <div className="mt-1">
                            MCP config: <code className="font-mono">{discovery.mcpConfigPath}</code>
                        </div>
                    )}
                    {discovery.doctorOutput && (
                        <details className="mt-2">
                            <summary className="cursor-pointer">endev doctor output</summary>
                            <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{discovery.doctorOutput}</pre>
                        </details>
                    )}
                </div>
            )}

            {!config.enabled && error && (
                <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
            )}
        </section>
    );
}
