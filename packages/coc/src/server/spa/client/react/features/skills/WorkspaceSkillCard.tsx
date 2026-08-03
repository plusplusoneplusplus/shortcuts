import type { SkillFileResponse } from '@plusplusoneplusplus/coc-client';
import { getSkillFileEntries, SkillVersionBadge } from '../../shared/SkillMetadata';
import { AgentSkillsIcons as I } from './agent-skills-icons';
import { SkillFilePreview } from './SkillFilePreview';
import type { Skill, SourceKind } from './skills-ui-model';

export interface WorkspaceSkillCardProps {
    workspaceId: string;
    skill: Skill;
    detail: Skill | null;
    detailLoading: boolean;
    detailError: string | null;
    isOpen: boolean;
    isEnabled: boolean;
    deleteConfirming: boolean;
    sourceLabel: string;
    sourceKind: SourceKind;
    sourcePillLabel: string;
    hideDelete: boolean;
    toggleDisabled: boolean;
    onToggleOpen: () => void;
    onToggleEnabled: (next: boolean) => void;
    onSetDeleteConfirm: (confirming: boolean) => void;
    onDelete: () => void;
    loadFile: (skillName: string, relativePath: string) => Promise<SkillFileResponse>;
}

export function WorkspaceSkillCard({
    workspaceId,
    skill,
    detail,
    detailLoading,
    detailError,
    isOpen,
    isEnabled,
    deleteConfirming,
    sourceLabel,
    sourceKind,
    sourcePillLabel,
    hideDelete,
    toggleDisabled,
    onToggleOpen,
    onToggleEnabled,
    onSetDeleteConfirm,
    onDelete,
    loadFile,
}: WorkspaceSkillCardProps) {
    const effectiveDetail = detail?.name === skill.name ? detail : skill;
    const fileEntries = getSkillFileEntries(effectiveDetail);
    const triggers = effectiveDetail.variables ?? [];
    const updatedRelative = (effectiveDetail as Skill & { updatedRelative?: string }).updatedRelative;

    return (
        <article
            className={`ask-skill ${isOpen ? 'is-open' : ''} ${isEnabled ? '' : 'is-disabled'}`}
            data-source={sourceKind}
            data-testid={`skill-item-${skill.name}`}
        >
            <div
                className="ask-skill-head"
                onClick={onToggleOpen}
                data-testid={`skill-expand-${skill.name}`}
                role="button"
                tabIndex={0}
                onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onToggleOpen();
                    }
                }}
            >
                <span className="ask-skill-spine" />
                <div className="ask-skill-body">
                    <div className="ask-skill-top">
                        <I.chevron
                            className="ask-icon"
                            style={{ transform: `rotate(${isOpen ? 90 : 0}deg)`, transition: 'transform .15s' }}
                        />
                        <span className="ask-name">{skill.name}</span>
                        <SkillVersionBadge version={skill.version} className="ask-version" />
                        <span className="ask-src-pill" data-kind={sourceKind}>
                            <span className="ask-dot" />
                            {sourcePillLabel}
                        </span>
                        {!isEnabled && <span className="ask-src-pill ask-pill-warn">Disabled</span>}
                    </div>
                    {skill.description && <div className="ask-skill-desc">{skill.description}</div>}
                    {(fileEntries.length > 0 || triggers.length > 0) && (
                        <div className="ask-skill-meta">
                            {fileEntries.length > 0 && (
                                <span><I.file className="ask-icon" />{fileEntries.length} file{fileEntries.length === 1 ? '' : 's'}</span>
                            )}
                            {updatedRelative && (
                                <span><I.clock className="ask-icon" />Updated {updatedRelative}</span>
                            )}
                            {triggers.length > 0 && (
                                <span className="ask-trigger">
                                    Triggers: <code>{triggers[0]}</code>
                                    {triggers.length > 1 && <span style={{ color: 'var(--ask-text-3)' }}>{` +${triggers.length - 1}`}</span>}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                <div className="ask-skill-right" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                    <button
                        type="button"
                        className={`ask-toggle ${isEnabled ? 'on' : ''}`}
                        aria-pressed={isEnabled}
                        title={isEnabled ? 'Disable' : 'Enable'}
                        disabled={toggleDisabled}
                        onClick={() => onToggleEnabled(!isEnabled)}
                        data-testid={`skill-toggle-${skill.name}`}
                    />
                    <button type="button" className="ask-icon-btn" title="Open SKILL.md" aria-label="Open SKILL.md" onClick={() => { if (!isOpen) {onToggleOpen();} }}>
                        <I.file className="ask-icon" />
                    </button>
                    {!hideDelete && (deleteConfirming ? (
                        <span className="ask-delete-confirm">
                            <span>Delete?</span>
                            <button type="button" className="ask-confirm-yes" onClick={onDelete} data-testid={`skill-delete-confirm-${skill.name}`}>Yes</button>
                            <button type="button" className="ask-confirm-no" onClick={() => onSetDeleteConfirm(false)}>No</button>
                        </span>
                    ) : (
                        <button
                            type="button"
                            className="ask-icon-btn ask-skill-delete"
                            title={`Delete ${skill.name}`}
                            aria-label={`Delete ${skill.name}`}
                            onClick={() => onSetDeleteConfirm(true)}
                            data-testid={`skill-delete-btn-${skill.name}`}
                        >
                            <I.trash className="ask-icon" />
                        </button>
                    ))}
                    <button type="button" className="ask-icon-btn" title="More" aria-label="More options">
                        <I.more className="ask-icon" />
                    </button>
                </div>
            </div>

            <SkillFilePreview
                workspaceId={workspaceId}
                skill={skill}
                detail={detail}
                detailLoading={detailLoading}
                detailError={detailError}
                isOpen={isOpen}
                sourceLabel={sourceLabel}
                loadFile={loadFile}
            />
        </article>
    );
}
