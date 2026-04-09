import type { NoteTreeNode } from '../notesApi';
import { NotesTreeItem } from './NotesTreeItem';

export interface NotesTreeProps {
    nodes: NoteTreeNode[];
    selectedPath: string | null;
    expandedPaths: Set<string>;
    depth?: number;
    onToggleExpand: (path: string) => void;
    onSelectPage: (path: string) => void;
    onContextMenu: (node: NoteTreeNode, x: number, y: number) => void;
}

export function NotesTree({
    nodes,
    selectedPath,
    expandedPaths,
    depth = 0,
    onToggleExpand,
    onSelectPage,
    onContextMenu,
}: NotesTreeProps) {
    return (
        <div role="tree" data-testid={depth === 0 ? 'notes-tree' : undefined}>
            {nodes.map(node => {
                const isFolder = node.type === 'notebook' || node.type === 'section';
                const isExpanded = expandedPaths.has(node.path);
                return (
                    <div key={node.path}>
                        <NotesTreeItem
                            node={node}
                            selectedPath={selectedPath}
                            isExpanded={isExpanded}
                            depth={depth}
                            onToggleExpand={onToggleExpand}
                            onSelectPage={onSelectPage}
                            onContextMenu={onContextMenu}
                        />
                        {isFolder && isExpanded && node.children && node.children.length > 0 && (
                            <NotesTree
                                nodes={node.children}
                                selectedPath={selectedPath}
                                expandedPaths={expandedPaths}
                                depth={depth + 1}
                                onToggleExpand={onToggleExpand}
                                onSelectPage={onSelectPage}
                                onContextMenu={onContextMenu}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
