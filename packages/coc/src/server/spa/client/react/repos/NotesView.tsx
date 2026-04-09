import { useState, useCallback } from 'react';
import { ResponsiveSidebar } from '../shared/ResponsiveSidebar';
import { NotesSidebar } from './notes/NotesSidebar';
import { useBreakpoint } from '../hooks/useBreakpoint';

export interface NotesViewProps {
    workspaceId: string;
}

export function NotesView({ workspaceId }: NotesViewProps) {
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const { isMobile } = useBreakpoint();

    const handleSelectPage = useCallback((path: string) => {
        setSelectedPath(path);
        if (isMobile) setSidebarOpen(false);
    }, [isMobile]);

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
                <div className="flex-1 flex items-center justify-center text-sm text-[#616161] dark:text-[#999]">
                    {selectedPath
                        ? <span data-testid="notes-selected-path">{selectedPath}</span>
                        : <span className="italic">Select a page to start editing</span>}
                </div>
            </div>
        </div>
    );
}
