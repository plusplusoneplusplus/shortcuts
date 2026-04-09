export interface NotesViewProps {
    workspaceId: string;
}

export function NotesView({ workspaceId }: NotesViewProps) {
    return (
        <div className="flex items-center justify-center h-full text-sm text-[#616161] dark:text-[#999]"
             data-testid="notes-view">
            Notes — coming soon
        </div>
    );
}
