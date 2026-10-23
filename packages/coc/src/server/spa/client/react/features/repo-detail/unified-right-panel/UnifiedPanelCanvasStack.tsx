import { cn } from '../../../ui/cn';
import { UnifiedPanelTabOverflowMenu } from './UnifiedPanelTabOverflowMenu';
import type { UnifiedPanelTab } from './unifiedPanelTabsModel';

export const CANVAS_TAB_COMPRESSION_THRESHOLD = 4;

export function compressedCanvasTabs(
    tabs: readonly UnifiedPanelTab[],
    activeId: string | null,
): { visibleTabs: readonly UnifiedPanelTab[]; canvasTabs: readonly UnifiedPanelTab[] } {
    const canvasTabs = tabs.filter(tab => tab.kind === 'canvas');
    if (canvasTabs.length < CANVAS_TAB_COMPRESSION_THRESHOLD) return { visibleTabs: tabs, canvasTabs: [] };
    return {
        visibleTabs: tabs.filter(tab => tab.kind !== 'canvas' || tab.id === activeId),
        canvasTabs,
    };
}

interface UnifiedPanelCanvasStackProps {
    tabs: readonly UnifiedPanelTab[];
    activeId: string | null;
    dirtyIds: ReadonlySet<string>;
    errorIds: ReadonlySet<string>;
    onActivate: (id: string) => void;
    onClose: (id: string) => void;
    onCloseMany: (ids: readonly string[]) => void;
    /** Placement classes for the chip; defaults to the tab strip's spacing. */
    className?: string;
}

export function UnifiedPanelCanvasStack({
    tabs, activeId, dirtyIds, errorIds, onActivate, onClose, onCloseMany,
    className = 'mx-1 my-1 h-[27px]',
}: UnifiedPanelCanvasStackProps) {
    return <UnifiedPanelTabOverflowMenu
        title="Canvas tabs"
        tabs={tabs}
        activeId={activeId}
        dirtyIds={dirtyIds}
        errorIds={errorIds}
        onActivate={onActivate}
        onClose={onClose}
        onCloseMany={onCloseMany}
        popupRole="dialog"
        testIdPrefix="unified-panel-canvas-stack"
        strings={{
            searchLabel: 'Search canvas tabs',
            searchPlaceholder: 'Search open canvases…',
            empty: 'No matching canvases',
            closeOthers: 'Close other canvases',
            closeAll: 'Close all canvases',
        }}
        trigger={
            <button type="button"
                aria-label={`Show ${tabs.length} canvas tabs`}
                title={`${tabs.length} canvas tabs`}
                data-testid="unified-panel-canvas-stack"
                className={cn(
                    className,
                    'flex flex-shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 text-[11px]',
                    'border-[#b6b6b6] bg-transparent text-[#4b5563] hover:border-[#0078d4] hover:text-[#0078d4]',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4]',
                    'dark:border-[#555] dark:text-[#b8b8b8] dark:hover:border-[#3794ff] dark:hover:text-[#3794ff]',
                )}
            >
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                    <rect x="2.2" y="3" width="8.6" height="8.6" rx="1.2" />
                    <path d="M5.2 1.4h7.4c1.1 0 2 .9 2 2v7.4" />
                </svg>
                <span>Canvases {tabs.length}</span>
                <span aria-hidden="true">⌄</span>
            </button>
        }
    />;
}
