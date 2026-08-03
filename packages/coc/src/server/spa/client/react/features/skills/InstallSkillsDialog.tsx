import { useGlobalToast } from '../../contexts/ToastContext';
import { AgentSkillsIcons as I } from './agent-skills-icons';
import { useSkillInstallController } from './useSkillInstallController';
import type { WorkspaceSkillsClientResolver } from './useWorkspaceSkillsController';

export interface InstallSkillsDialogProps {
    workspaceId: string;
    resolveClient: WorkspaceSkillsClientResolver;
    onClose: () => void;
    onInstalled: () => void;
}

export function InstallSkillsDialog({ workspaceId, resolveClient, onClose, onInstalled }: InstallSkillsDialogProps) {
    const { addToast } = useGlobalToast();
    const controller = useSkillInstallController({ workspaceId, resolveClient, onInstalled, notify: addToast });

    return (
        <div
            className="agent-skills-redesign-overlay"
            onClick={event => { if (event.target === event.currentTarget) {onClose();} }}
            data-testid="install-skills-dialog"
        >
            <div className="agent-skills-redesign-modal agent-skills-redesign">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--ask-border)' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Install Skills</h3>
                    <button type="button" className="ask-icon-btn" onClick={onClose} aria-label="Close" data-testid="install-dialog-close">
                        <I.x className="ask-icon" />
                    </button>
                </div>

                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--ask-border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ask-text-3)', marginBottom: 8 }}>Source</div>
                    <div style={{ display: 'flex', gap: 16 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                            <input type="radio" value="bundled" checked={controller.source === 'bundled'} onChange={() => controller.selectSource('bundled')} />
                            Built-in skills
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                            <input type="radio" value="github" checked={controller.source === 'github'} onChange={() => controller.selectSource('github')} />
                            GitHub URL
                        </label>
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                    {controller.source === 'bundled' ? (
                        controller.loadingBundled ? (
                            <div className="ask-loading">Loading bundled skills…</div>
                        ) : controller.bundledError ? (
                            <div className="ask-loading" style={{ color: 'var(--ask-danger)' }} data-testid="bundled-skills-error">{controller.bundledError}</div>
                        ) : controller.bundledSkills.length === 0 ? (
                            <div className="ask-loading">No bundled skills available.</div>
                        ) : (
                            <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
                                {controller.bundledSkills.map(skill => (
                                    <li key={skill.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                        <input
                                            type="checkbox"
                                            id={`bundled-${skill.name}`}
                                            checked={controller.selectedBundled.has(skill.name)}
                                            onChange={event => controller.toggleBundled(skill.name, event.target.checked)}
                                            style={{ marginTop: 3 }}
                                        />
                                        <label htmlFor={`bundled-${skill.name}`} style={{ flex: 1, cursor: 'pointer' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ask-text)' }}>
                                                {skill.name}
                                                {skill.alreadyExists && <span style={{ fontSize: 10, color: 'var(--ask-text-3)', background: 'var(--ask-surface-2)', padding: '1px 7px', borderRadius: 999 }}>installed</span>}
                                            </div>
                                            {skill.description && <div style={{ fontSize: 12, color: 'var(--ask-text-2)' }}>{skill.description}</div>}
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div>
                                <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--ask-text-3)', display: 'block', marginBottom: 4 }}>GitHub URL</label>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <input
                                        type="text"
                                        value={controller.githubUrl}
                                        onChange={event => controller.setGithubUrl(event.target.value)}
                                        placeholder="https://github.com/owner/repo/tree/main/skills"
                                        disabled={controller.scanning}
                                        onKeyDown={event => { if (event.key === 'Enter' && controller.githubUrl) {void controller.scan();} }}
                                        data-testid="github-url-input"
                                        style={{ flex: 1, padding: '6px 8px', borderRadius: 'var(--ask-radius-sm)', border: '1px solid var(--ask-border)', background: 'var(--ask-surface)', color: 'var(--ask-text)', fontSize: 12, outline: 'none' }}
                                    />
                                    <button type="button" className="ask-btn ask-sm" onClick={() => void controller.scan()} disabled={!controller.githubUrl || controller.scanning} data-testid="scan-btn">
                                        {controller.scanning ? '…' : 'Scan'}
                                    </button>
                                </div>
                                {controller.scanError && <div style={{ fontSize: 12, color: 'var(--ask-danger)', marginTop: 4 }} data-testid="scan-error">{controller.scanError}</div>}
                            </div>
                            {controller.scanResult && controller.scanResult.skills.length > 0 && (
                                <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
                                    {controller.scanResult.skills.map(skill => (
                                        <li key={skill.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                            <input
                                                type="checkbox"
                                                id={`github-${skill.name}`}
                                                checked={controller.selectedGithub.has(skill.name)}
                                                onChange={event => controller.toggleGithub(skill.name, event.target.checked)}
                                                style={{ marginTop: 3 }}
                                            />
                                            <label htmlFor={`github-${skill.name}`} style={{ flex: 1, cursor: 'pointer' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ask-text)' }}>
                                                    {skill.name}
                                                    {skill.alreadyExists && <span style={{ fontSize: 10, color: 'var(--ask-warn)', background: 'color-mix(in oklab, var(--ask-warn) 15%, transparent)', padding: '1px 7px', borderRadius: 999 }}>will replace</span>}
                                                </div>
                                                {skill.description && <div style={{ fontSize: 12, color: 'var(--ask-text-2)' }}>{skill.description}</div>}
                                            </label>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--ask-border)' }}>
                    <button type="button" className="ask-btn ask-sm" onClick={onClose} data-testid="install-dialog-cancel">Cancel</button>
                    <button
                        type="button"
                        className="ask-btn ask-sm ask-primary"
                        onClick={() => void controller.install()}
                        disabled={!controller.canInstall || controller.installing}
                        data-testid="install-dialog-submit"
                    >
                        {controller.installing ? 'Installing…' : `Install (${controller.selectedCount})`}
                    </button>
                </div>
            </div>
        </div>
    );
}
