import { useCallback, useState } from 'react';
import type { MouseEvent } from 'react';

export interface ScratchpadTabContextMenuState {
    filePath: string;
    x: number;
    y: number;
}

export function useScratchpadTabContextMenu() {
    const [ctxMenu, setCtxMenu] = useState<ScratchpadTabContextMenuState | null>(null);

    const openContextMenu = useCallback((event: MouseEvent, filePath: string) => {
        event.preventDefault();
        event.stopPropagation();
        setCtxMenu({ filePath, x: event.clientX, y: event.clientY });
    }, []);

    const closeContextMenu = useCallback(() => {
        setCtxMenu(null);
    }, []);

    return { ctxMenu, openContextMenu, closeContextMenu };
}
