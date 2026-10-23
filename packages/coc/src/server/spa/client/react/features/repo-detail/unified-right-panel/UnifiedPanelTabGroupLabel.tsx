import { cn } from '../../../ui/cn';
import type { UnifiedTabStripGroup } from './unifiedPanelTabGroups';

export const TAB_GROUP_LABELS: Record<UnifiedTabStripGroup, string> = {
    tools: 'Tools', files: 'Files', web: 'Web', canvas: 'Canvas',
};

const ICONS: Record<UnifiedTabStripGroup, string> = {
    tools: '\uD83E\uDDF0', files: '\uD83D\uDCC4', web: '\uD83C\uDF10', canvas: '\uD83C\uDFA8',
};

export function UnifiedPanelTabGroupLabel({ group, count, folded, active, onToggle }: {
    group: UnifiedTabStripGroup;
    count: number;
    folded: boolean;
    active: boolean;
    onToggle: () => void;
}) {
    return (
        <button
            type="button"
            data-strip-stop
            data-testid={`unified-panel-group-${group}`}
            aria-label={`${TAB_GROUP_LABELS[group]}, ${count} tabs`}
            aria-expanded={!folded}
            onClick={onToggle}
            className={cn(
                'mx-1 my-1 flex flex-shrink-0 items-center gap-1 rounded border px-2 text-[11px]',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4]',
                active
                    ? 'border-[#0078d4] bg-[#e8f2fb] text-[#0078d4] dark:bg-[#37373d] dark:text-[#3794ff]'
                    : 'border-[#b6b6b6] text-[#616161] dark:border-[#555] dark:text-[#b8b8b8]',
            )}
        >
            <span aria-hidden="true">{folded ? '\u25B8' : '\u25BE'} {ICONS[group]}</span>
            <span>{TAB_GROUP_LABELS[group]} {count}</span>
        </button>
    );
}
