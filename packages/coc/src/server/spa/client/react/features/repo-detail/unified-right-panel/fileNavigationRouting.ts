import type { NavigationDirection } from './unifiedPanelNavigationHistory';

export function keyboardNavigationDirection(event: Pick<
    KeyboardEvent,
    'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
>): NavigationDirection | null {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
    if (event.key === 'ArrowLeft') return 'back';
    if (event.key === 'ArrowRight') return 'forward';
    return null;
}

export function mouseNavigationDirection(
    event: Pick<MouseEvent, 'button'>,
): NavigationDirection | null {
    if (event.button === 3) return 'back';
    if (event.button === 4) return 'forward';
    return null;
}

export function panelOwnsFileNavigation({
    panelVisible,
    interactionOwned,
    activeFile,
}: {
    panelVisible: boolean;
    interactionOwned: boolean;
    activeFile: boolean;
}): boolean {
    return panelVisible && interactionOwned && activeFile;
}
