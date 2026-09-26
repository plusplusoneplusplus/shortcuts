import { isMacPlatform } from '../../../utils/composerKeyboardShortcuts';
import type { NavigationDirection } from './unifiedPanelNavigationHistory';

/**
 * VS Code's Go Back / Go Forward keys: Ctrl+- / Ctrl+Shift+- on macOS, where
 * Alt+Arrow is word movement and stays with the editor, and Alt+Left /
 * Alt+Right elsewhere.
 */
export function keyboardNavigationDirection(
    event: Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
    mac = isMacPlatform(),
): NavigationDirection | null {
    if (mac) {
        if (!event.ctrlKey || event.altKey || event.metaKey || event.code !== 'Minus') return null;
        return event.shiftKey ? 'forward' : 'back';
    }
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
