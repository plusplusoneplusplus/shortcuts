import { AgentSkillsIcons as I } from './agent-skills-icons';
import type { SkillsResolutionItem } from './skills-ui-model';

export function SkillsResolutionOrder({
    items,
    onMove,
}: {
    items: SkillsResolutionItem[];
    /** Omitted when the caller has nowhere to write a new order — a repo group has no skills folder of its own. */
    onMove?: (folderPath: string, delta: -1 | 1) => void;
}) {
    if (items.length === 0) {return null;}
    return (
        <div className="ask-resolution" data-testid="skills-resolution-order">
            <h3>Resolution order</h3>
            <p>
                When two skills share a name, the first matching folder wins.
                {onMove ? ' Use the arrow buttons to reorder extra folders.' : ''}
            </p>
            <div className="ask-order-list">
                {items.map((item, index) => (
                    <div key={item.id} className="ask-order-row" data-kind={item.kind} data-testid={`resolution-item-${item.id}`}>
                        <span className="ask-idx">{index + 1}</span>
                        <span className="ask-swatch" />
                        <div className="ask-label">
                            <span className="ask-label-name">{item.label}</span>
                            <span className="ask-path">{item.path}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 2 }}>
                            <button
                                type="button"
                                className="ask-icon-btn"
                                title="Move up"
                                onClick={() => item.folderPath && onMove?.(item.folderPath, -1)}
                                disabled={!onMove || !item.reorderable || item.upDisabled}
                            >
                                ↑
                            </button>
                            <button
                                type="button"
                                className="ask-icon-btn"
                                title="Move down"
                                onClick={() => item.folderPath && onMove?.(item.folderPath, 1)}
                                disabled={!onMove || !item.reorderable || item.downDisabled}
                            >
                                ↓
                            </button>
                            <button
                                type="button"
                                className="ask-icon-btn"
                                title="Drag"
                                style={{ cursor: onMove && item.reorderable ? 'grab' : 'default' }}
                                disabled={!onMove || !item.reorderable}
                            >
                                <I.grip className="ask-icon" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
