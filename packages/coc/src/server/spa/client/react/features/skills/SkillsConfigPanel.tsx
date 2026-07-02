/**
 * SkillsConfigPanel — global skill configuration.
 *
 * Sections (top → bottom):
 *   1. Global Skills Directory   — read-only managed install location (`~/.coc/skills`).
 *   2. Global Extra Skill Folders — configurable read-only skill sources (all workspaces).
 *   3. Detected Skill Folders     — auto-detected OneDrive/CloudStorage folders + toggle.
 *   4. Effective Search Order     — read-only diagnostic of what the agent will use.
 *   5. Globally Disabled Skills   — skills disabled across all workspaces.
 *
 * The effective search order is fetched global-only (no active workspace on this
 * global tab); repo-local and per-repo extra folders are configured in each
 * repo's own settings and are intentionally NOT claimed to apply globally here.
 */

import { useState, useEffect, useCallback } from 'react';
import type {
    EffectiveSkillPath,
    EffectiveSkillPathSource,
    EffectiveSkillPathStatus,
} from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../api/cocClient';

const SOURCE_BADGES: Record<EffectiveSkillPathSource, { label: string; className: string }> = {
    'managed-global': { label: 'Managed', className: 'bg-[#0078d4]/15 text-[#0078d4]' },
    'configured': { label: 'Configured', className: 'bg-[#8b5cf6]/15 text-[#8b5cf6]' },
    'auto-detected': { label: 'Auto-detected', className: 'bg-[#0ca678]/15 text-[#0ca678]' },
    'repo': { label: 'Repo', className: 'bg-[#d9822b]/15 text-[#d9822b]' },
    'repo-extra': { label: 'Repo', className: 'bg-[#d9822b]/15 text-[#d9822b]' },
    'bundled': { label: 'Bundled', className: 'bg-[#6b7280]/15 text-[#6b7280]' },
};

const STATUS_BADGES: Record<EffectiveSkillPathStatus, { label: string; className: string }> = {
    'available': { label: 'Available', className: 'bg-[#2ea043]/15 text-[#2ea043]' },
    'no-skills': { label: 'No skills', className: 'bg-[#6b7280]/15 text-[#6b7280]' },
    'missing': { label: 'Missing', className: 'bg-[#f14c4c]/15 text-[#f14c4c]' },
    'skipped': { label: 'Skipped', className: 'bg-[#d4a72c]/15 text-[#d4a72c]' },
};

function SourceBadge({ source }: { source: EffectiveSkillPathSource }) {
    const badge = SOURCE_BADGES[source];
    return (
        <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium whitespace-nowrap ${badge.className}`}>
            {badge.label}
        </span>
    );
}

function StatusBadge({ status }: { status: EffectiveSkillPathStatus }) {
    const badge = STATUS_BADGES[status];
    return (
        <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium whitespace-nowrap ${badge.className}`}>
            {badge.label}
        </span>
    );
}

export function SkillsConfigPanel() {
    const [disabledSkills, setDisabledSkills] = useState<string[]>([]);
    const [globalDir, setGlobalDir] = useState<string>('');
    const [globalExtraFolders, setGlobalExtraFolders] = useState<string[]>([]);
    const [autoDetect, setAutoDetect] = useState<boolean>(true);
    const [effectivePaths, setEffectivePaths] = useState<EffectiveSkillPath[]>([]);
    const [loading, setLoading] = useState(true);
    const [newDisabledSkill, setNewDisabledSkill] = useState('');
    const [newExtraFolder, setNewExtraFolder] = useState('');

    const loadEffectivePaths = useCallback(() => {
        // Global-only view: no workspace id, so the API returns global-scoped paths.
        return getSpaCocClient().skills.getEffectivePaths()
            .then(res => setEffectivePaths(Array.isArray(res?.paths) ? res.paths : []))
            .catch(() => {});
    }, []);

    const loadConfig = useCallback(() => {
        setLoading(true);
        Promise.all([
            getSpaCocClient().skills.getGlobalConfig()
                .then(data => {
                    setDisabledSkills(Array.isArray(data.globalDisabledSkills) ? data.globalDisabledSkills : []);
                    setGlobalDir(data.globalSkillsDir ?? '');
                    setGlobalExtraFolders(Array.isArray(data.globalExtraFolders) ? data.globalExtraFolders : []);
                    setAutoDetect(data.autoDetectDefaultFolders !== false);
                })
                .catch(() => {}),
            loadEffectivePaths(),
        ]).finally(() => setLoading(false));
    }, [loadEffectivePaths]);

    useEffect(() => { loadConfig(); }, [loadConfig]);

    // ── Globally disabled skills ───────────────────────────────────────────
    const updateDisabledSkills = useCallback((updated: string[]) => {
        setDisabledSkills(updated);
        getSpaCocClient().skills.updateGlobalConfig({ globalDisabledSkills: updated }).catch(() => {});
    }, []);

    const handleAddDisabled = useCallback(() => {
        const name = newDisabledSkill.trim();
        if (!name || disabledSkills.includes(name)) return;
        updateDisabledSkills([...disabledSkills, name]);
        setNewDisabledSkill('');
    }, [newDisabledSkill, disabledSkills, updateDisabledSkills]);

    const handleRemoveDisabled = useCallback((name: string) => {
        updateDisabledSkills(disabledSkills.filter(s => s !== name));
    }, [disabledSkills, updateDisabledSkills]);

    // ── Global extra skill folders ─────────────────────────────────────────
    const persistExtraFolders = useCallback((updated: string[]) => {
        setGlobalExtraFolders(updated);
        // Send disabled list alongside so the required field stays intact; the
        // server merges only the provided fields into the config file.
        getSpaCocClient().skills
            .updateGlobalConfig({ globalDisabledSkills: disabledSkills, globalExtraFolders: updated })
            .then(() => loadEffectivePaths())
            .catch(() => {});
    }, [disabledSkills, loadEffectivePaths]);

    const handleAddExtraFolder = useCallback(() => {
        const folder = newExtraFolder.trim();
        if (!folder || globalExtraFolders.includes(folder)) return;
        persistExtraFolders([...globalExtraFolders, folder]);
        setNewExtraFolder('');
    }, [newExtraFolder, globalExtraFolders, persistExtraFolders]);

    const handleRemoveExtraFolder = useCallback((folder: string) => {
        persistExtraFolders(globalExtraFolders.filter(f => f !== folder));
    }, [globalExtraFolders, persistExtraFolders]);

    // ── Auto-detect toggle ─────────────────────────────────────────────────
    const handleToggleAutoDetect = useCallback(() => {
        const next = !autoDetect;
        setAutoDetect(next);
        getSpaCocClient().skills
            .updateGlobalConfig({ globalDisabledSkills: disabledSkills, autoDetectDefaultFolders: next })
            .then(() => loadEffectivePaths())
            .catch(() => {});
    }, [autoDetect, disabledSkills, loadEffectivePaths]);

    if (loading) {
        return <div className="p-4 text-sm text-[#848484]">Loading config…</div>;
    }

    const detected = effectivePaths.filter(p => p.source === 'auto-detected');
    const detectedVisible = detected.filter(p => p.status !== 'skipped');
    const detectedSkipped = detected.filter(p => p.status === 'skipped');

    return (
        <div className="p-4 flex flex-col gap-5 max-w-2xl" data-testid="skills-config-panel">
            {/* 1. Global skills directory (managed) */}
            <div>
                <label className="block text-xs font-medium text-[#616161] dark:text-[#999] mb-1">
                    Global Skills Directory
                </label>
                <div className="text-sm font-mono text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#333] px-3 py-2 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {globalDir || '~/.coc/skills/'}
                </div>
                <div className="text-xs text-[#848484] mt-1">
                    CoC-managed install location. Skills installed on this page live here and apply to all repos.
                </div>
            </div>

            {/* 2. Global extra skill folders (configured, read-only sources) */}
            <div data-testid="skills-global-extra-folders">
                <label className="block text-xs font-medium text-[#616161] dark:text-[#999] mb-1">
                    Global Extra Skill Folders
                </label>
                <div className="text-xs text-[#848484] mb-2">
                    Read-only skill-source folders applied across all workspaces. CoC never installs or deletes
                    skills in these folders. Use absolute paths or <code>~</code> for your home directory.
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {globalExtraFolders.map(folder => (
                        <span
                            key={folder}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-[#0078d4]/10 text-[#0078d4] border border-[#0078d4]/30 font-mono"
                        >
                            {folder}
                            <button
                                onClick={() => handleRemoveExtraFolder(folder)}
                                className="hover:text-[#005a9e] ml-0.5"
                                title="Remove folder"
                            >
                                ✕
                            </button>
                        </span>
                    ))}
                    {globalExtraFolders.length === 0 && (
                        <span className="text-xs text-[#848484]">No global extra folders configured.</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={newExtraFolder}
                        onChange={(e) => setNewExtraFolder(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddExtraFolder()}
                        placeholder="Extra skill folder path…"
                        className="flex-1 text-sm px-2 py-1.5 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] font-mono"
                    />
                    <button
                        className="text-xs px-3 py-1.5 bg-[#0078d4] text-white rounded disabled:opacity-50"
                        disabled={!newExtraFolder.trim()}
                        onClick={handleAddExtraFolder}
                    >
                        Add
                    </button>
                </div>
            </div>

            {/* 3. Detected skill folders (auto-detected OneDrive/CloudStorage) */}
            <div data-testid="skills-detected-folders">
                <label className="block text-xs font-medium text-[#616161] dark:text-[#999] mb-1">
                    Detected Skill Folders
                </label>
                <label className="flex items-center gap-2 text-xs text-[#616161] dark:text-[#cccccc] mb-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={autoDetect}
                        onChange={handleToggleAutoDetect}
                        aria-label="Auto-detect default skill folders"
                    />
                    Auto-detect default skill folders (OneDrive / CloudStorage)
                </label>
                {!autoDetect ? (
                    <div className="text-xs text-[#848484]">Auto-detection is disabled.</div>
                ) : detectedVisible.length === 0 && detectedSkipped.length === 0 ? (
                    <div className="text-xs text-[#848484]">No OneDrive skill folders detected.</div>
                ) : (
                    <div className="flex flex-col gap-1.5">
                        {detectedVisible.map((p, i) => (
                            <div
                                key={`${p.path}-${i}`}
                                className="flex items-center gap-2 text-xs bg-[#f3f3f3] dark:bg-[#2a2a2a] px-2 py-1.5 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]"
                            >
                                <StatusBadge status={p.status} />
                                <code className="flex-1 break-all text-[#1e1e1e] dark:text-[#cccccc]">{p.path}</code>
                                {typeof p.skillCount === 'number' && (
                                    <span className="text-[#848484] whitespace-nowrap">
                                        {p.skillCount} skill{p.skillCount === 1 ? '' : 's'}
                                    </span>
                                )}
                            </div>
                        ))}
                        {detectedSkipped.length > 0 && (
                            <details className="text-xs text-[#848484]">
                                <summary className="cursor-pointer">
                                    Diagnostics ({detectedSkipped.length} skipped)
                                </summary>
                                <div className="flex flex-col gap-1 mt-1">
                                    {detectedSkipped.map((p, i) => (
                                        <div key={`${p.path}-${i}`} className="flex items-center gap-2">
                                            <StatusBadge status={p.status} />
                                            <code className="flex-1 break-all">{p.path}</code>
                                            {p.note && <span className="italic">{p.note}</span>}
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )}
                    </div>
                )}
            </div>

            {/* 4. Effective search order (read-only diagnostic) */}
            <div data-testid="skills-effective-search-order">
                <label className="block text-xs font-medium text-[#616161] dark:text-[#999] mb-1">
                    Effective Search Order
                </label>
                <div className="text-xs text-[#848484] mb-2">
                    Read-only. The order the agent searches for skills. Showing global paths only — repo-local and
                    per-repo extra folders are configured in each repo&apos;s settings and are not applied globally.
                </div>
                {effectivePaths.length === 0 ? (
                    <div className="text-xs text-[#848484]">No effective skill paths.</div>
                ) : (
                    <ol className="flex flex-col gap-1.5">
                        {effectivePaths.map((p, i) => (
                            <li
                                key={`${p.source}-${p.path}-${i}`}
                                data-testid={`effective-path-${i}`}
                                className="flex items-center gap-2 text-xs bg-[#f3f3f3] dark:bg-[#2a2a2a] px-2 py-1.5 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]"
                            >
                                <SourceBadge source={p.source} />
                                <StatusBadge status={p.status} />
                                <code className="flex-1 break-all text-[#1e1e1e] dark:text-[#cccccc]">{p.path}</code>
                                {typeof p.skillCount === 'number' && (
                                    <span className="text-[#848484] whitespace-nowrap">
                                        {p.skillCount} skill{p.skillCount === 1 ? '' : 's'}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ol>
                )}
            </div>

            {/* 5. Globally disabled skills */}
            <div>
                <label className="block text-xs font-medium text-[#616161] dark:text-[#999] mb-1">
                    Globally Disabled Skills
                </label>
                <div className="text-xs text-[#848484] mb-2">
                    Skills listed here are disabled across all workspaces. Per-repo disabled skills are managed in each repo&apos;s Copilot settings.
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {disabledSkills.map(name => (
                        <span
                            key={name}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-[#f14c4c]/10 text-[#f14c4c] border border-[#f14c4c]/30"
                        >
                            {name}
                            <button
                                onClick={() => handleRemoveDisabled(name)}
                                className="hover:text-[#d32f2f] ml-0.5"
                                title="Re-enable"
                            >
                                ✕
                            </button>
                        </span>
                    ))}
                    {disabledSkills.length === 0 && (
                        <span className="text-xs text-[#848484]">No globally disabled skills.</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={newDisabledSkill}
                        onChange={(e) => setNewDisabledSkill(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddDisabled()}
                        placeholder="Skill name to disable…"
                        className="flex-1 text-sm px-2 py-1.5 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]"
                    />
                    <button
                        className="text-xs px-3 py-1.5 bg-[#f14c4c] text-white rounded disabled:opacity-50"
                        disabled={!newDisabledSkill.trim()}
                        onClick={handleAddDisabled}
                    >
                        Disable
                    </button>
                </div>
            </div>
        </div>
    );
}
