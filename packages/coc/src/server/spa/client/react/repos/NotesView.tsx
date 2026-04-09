import { useState, useCallback, useEffect } from 'react';
import { ResponsiveSidebar } from '../shared/ResponsiveSidebar';
import { NotesSidebar } from './notes/NotesSidebar';
import { NoteEditor } from './notes/NoteEditor';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useApp } from '../context/AppContext';
import { buildNoteHash } from '../layout/Router';

export interface NotesViewProps {
    workspaceId: string;
    initialNotePath?: string | null;
}

export function NotesView({ workspaceId, initialNotePath }: NotesViewProps) {
    const { dispatch } = useApp();
    const [selectedPath, setSelectedPath] = useState<string | null>(initialNotePath ?? null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const { isMobile } = useBreakpoint();

    // Sync from external deep-link changes (e.g. back/forward navigation)
    useEffect(() => {
        if (initialNotePath !== undefined && initialNotePath !== selectedPath) {
            setSelectedPath(initialNotePath);
        }
    }, [initialNotePath]);

    const updateHash = useCallback((path: string | null) => {
        const target = path
            ? buildNoteHash(workspaceId, path)
            : '#repos/' + encodeURIComponent(workspaceId) + '/notes';
        if (location.hash !== target) {
            location.hash = target;
        }
    }, [workspaceId]);

    const handleSelectPage = useCallback((path: string) => {
        setSelectedPath(path);
        dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: path });
        updateHash(path);
        if (isMobile) setSidebarOpen(false);
    }, [isMobile, dispatch, updateHash]);

    const handleNoteRenamed = useCallback((oldPath: string, newPath: string) => {
        if (selectedPath === oldPath || selectedPath?.startsWith(oldPath + '/')) {
            const updated = selectedPath === oldPath
                ? newPath
                : newPath + selectedPath.substring(oldPath.length);
            setSelectedPath(updated);
            dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: updated });
            updateHash(updated);
        }
    }, [selectedPath, dispatch, updateHash]);

    const handleNoteCreated = useCallback((path: string) => {
        setSelectedPath(path);
        dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: path });
        updateHash(path);
    }, [dispatch, updateHash]);

    const handleNoteDeleted = useCallback((path: string) => {
        if (selectedPath === path || selectedPath?.startsWith(path + '/')) {
            setSelectedPath(null);
            dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: null });
            updateHash(null);
        }
    }, [selectedPath, dispatch, updateHash]);

    return (
        <div className="flex h-full" data-testid="notes-view">
            <ResponsiveSidebar
                width={280}
                tabletWidth={220}
                isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
            >
                <NotesSidebar
                    workspaceId={workspaceId}
                    selectedPath={selectedPath}
                    onSelectPage={handleSelectPage}
                    onNoteRenamed={handleNoteRenamed}
                    onNoteCreated={handleNoteCreated}
                    onNoteDeleted={handleNoteDeleted}
                />
            </ResponsiveSidebar>

            {/* Content area */}
            <div className="flex-1 flex flex-col min-w-0" data-testid="notes-content">
                {isMobile && (
                    <div className="h-10 flex items-center px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <button
                            className="text-xs text-[#0078d4] hover:underline"
                            onClick={() => setSidebarOpen(true)}
                            data-testid="notes-mobile-menu-btn"
                        >
                            ☰ Notes
                        </button>
                    </div>
                )}
                <NoteEditor workspaceId={workspaceId} notePath={selectedPath} />
            </div>
        </div>
    );
}
