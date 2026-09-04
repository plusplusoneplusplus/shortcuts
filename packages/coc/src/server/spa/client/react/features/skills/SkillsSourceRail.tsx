import { useEffect, useState } from 'react';
import { AgentSkillsIcons as I } from './agent-skills-icons';
import type { SkillsSourceItem } from './skills-ui-model';

export interface SkillsSourceRailProps {
    scopeKey: string;
    sources: SkillsSourceItem[];
    activeSource: string;
    onSelect: (source: SkillsSourceItem) => void;
    onRemove: (source: SkillsSourceItem) => void;
    onAddFolder: (folderPath: string) => void;
    /**
     * Read-only rail: the source list still filters, but nothing that mutates the
     * source set is offered. A repo group has no skills folder of its own, so
     * adding folders / linking repos / removing sources have nowhere to land.
     */
    readOnly?: boolean;
}

function SourceRow({
    source,
    active,
    onSelect,
    onRemove,
}: {
    source: SkillsSourceItem;
    active: boolean;
    onSelect: () => void;
    onRemove?: () => void;
}) {
    return (
        <button
            type="button"
            className={`ask-source ${active ? 'active' : ''}`}
            data-kind={source.kind}
            onClick={onSelect}
            data-testid={`source-${source.id}`}
        >
            <span
                className="ask-swatch"
                style={source.kind === 'linked' && source.repoColor ? { background: source.repoColor } : undefined}
            />
            <div className="ask-source-meta">
                <span className="ask-name">{source.name}</span>
                {source.path && <span className="ask-path">{source.path}</span>}
            </div>
            <span className="ask-count">{source.count}</span>
            {onRemove && source.removable && (
                <span
                    role="button"
                    tabIndex={0}
                    className="ask-source-remove"
                    title="Remove this source"
                    onClick={event => {
                        event.stopPropagation();
                        onRemove();
                    }}
                    onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            onRemove();
                        }
                    }}
                >
                    <I.x className="ask-icon" style={{ width: 10, height: 10 }} />
                </span>
            )}
        </button>
    );
}

export function SkillsSourceRail({
    scopeKey,
    sources,
    activeSource,
    onSelect,
    onRemove,
    onAddFolder,
    readOnly = false,
}: SkillsSourceRailProps) {
    const [showAddFolder, setShowAddFolder] = useState(false);
    const [folderInput, setFolderInput] = useState('');

    useEffect(() => {
        setShowAddFolder(false);
        setFolderInput('');
    }, [scopeKey]);

    const submitFolder = () => {
        const folderPath = folderInput.trim();
        if (!folderPath) {return;}
        onAddFolder(folderPath);
        setFolderInput('');
        setShowAddFolder(false);
    };

    return (
        <aside className="ask-rail">
            <h4>Sources</h4>
            <div className="ask-source-list">
                {sources.map(source => (
                    <SourceRow
                        key={source.id}
                        source={source}
                        active={activeSource === source.id}
                        onSelect={() => onSelect(source)}
                        onRemove={source.removable && !readOnly ? () => onRemove(source) : undefined}
                    />
                ))}
            </div>

            {readOnly ? null : showAddFolder ? (
                <div className="ask-source-input-row" data-testid="extra-folder-input-row">
                    <input
                        type="text"
                        placeholder="/path/to/folder"
                        value={folderInput}
                        onChange={event => setFolderInput(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter') {submitFolder();}
                            if (event.key === 'Escape') {
                                setFolderInput('');
                                setShowAddFolder(false);
                            }
                        }}
                        autoFocus
                        data-testid="extra-folder-input"
                    />
                    <button
                        type="button"
                        className="ask-btn ask-sm"
                        disabled={!folderInput.trim()}
                        onClick={submitFolder}
                        data-testid="extra-folder-add-btn"
                    >
                        Add
                    </button>
                    <button
                        type="button"
                        className="ask-btn ask-sm ask-ghost"
                        onClick={() => {
                            setFolderInput('');
                            setShowAddFolder(false);
                        }}
                        aria-label="Cancel"
                    >
                        <I.x className="ask-icon" />
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    className="ask-source-add"
                    onClick={() => setShowAddFolder(true)}
                    data-testid="source-add-folder-btn"
                >
                    <I.plus className="ask-icon" /> Add folder or link repo
                </button>
            )}

            <div className="ask-rail-help">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <I.zap className="ask-icon" />
                    <b>How resolution works</b>
                </div>
                When two skills share a name, the first one wins by source order:
                <div className="ask-mono" style={{ marginTop: 6, color: 'var(--ask-text-2)' }}>
                    repo → global → linked → extra
                </div>
                <a href="https://agentskills.io" target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8 }}>
                    Read the spec →
                </a>
            </div>
        </aside>
    );
}
