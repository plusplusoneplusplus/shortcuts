import type { NoteTreeNode } from '../notesApi';
import { Spinner } from '../../../ui/Spinner';
import { NotesTree, type NotesTreeProps } from './NotesTree';
import { NotesSectionHeader, type NotesSectionHeaderAction } from './NotesSectionHeader';

/** Header configuration for a stacked section. Omit to render a bare tree (AC-07). */
export interface NotesRootSectionHeader {
    /** The root's label. */
    label: string;
    expanded: boolean;
    onToggle: () => void;
    /** Muted page count shown after the label. */
    count?: number;
    isDefault?: boolean;
    isProtected?: boolean;
    protectedReason?: string;
    actions?: NotesSectionHeaderAction[];
}

export interface NotesRootSectionProps {
    /**
     * When present the section renders a collapsible header above its body and
     * hides the body while collapsed. When absent the body renders bare — the
     * single-root sidebar keeps exactly today's markup (AC-07).
     */
    header?: NotesRootSectionHeader;
    /**
     * Appended to every `data-testid` this section owns so stacked sections stay
     * addressable. Omit for the single-root case, which keeps the bare names
     * (`notes-tree`, `notes-loading`, …) existing tests rely on.
     */
    testIdSuffix?: string;
    loading: boolean;
    error: string | null;
    tree: NoteTreeNode[] | null;
    /** Raw search text, echoed in the "no matches" message. */
    searchQuery: string;
    /** Active search filter, or null when not searching. */
    filter: { visible: Set<string> } | null;
    /** Everything the inner `NotesTree` needs, minus `nodes`/`visiblePaths`. */
    treeProps: Omit<NotesTreeProps, 'nodes' | 'visiblePaths'>;
}

/**
 * One notes root rendered as a section: an optional collapsible header plus the
 * root's tree and its loading / error / empty / no-search-match states.
 *
 * The section deliberately does NOT own a scroll container — all sections share
 * the sidebar's single scroll area so headers can stick within it.
 */
export function NotesRootSection({
    header,
    testIdSuffix,
    loading,
    error,
    tree,
    searchQuery,
    filter,
    treeProps,
}: NotesRootSectionProps) {
    const tid = (base: string) => (testIdSuffix ? `${base}-${testIdSuffix}` : base);
    const collapsed = Boolean(header) && !header!.expanded;

    const body = (
        <>
            {loading && (
                <div className="flex items-center justify-center py-6" data-testid={tid('notes-loading')}>
                    <Spinner size="md" />
                </div>
            )}

            {error && !loading && (
                <div
                    className="py-6 px-4 text-center text-xs text-red-500 dark:text-red-400"
                    data-testid={tid('notes-error')}
                >
                    {error}
                </div>
            )}

            {!loading && !error && tree && tree.length === 0 && (
                <div
                    className="py-6 px-4 text-center text-xs text-[#656d76] dark:text-[#666] italic"
                    data-testid={tid('notes-empty')}
                >
                    No notebooks yet
                </div>
            )}

            {!loading && !error && tree && tree.length > 0 && (
                <NotesTree {...treeProps} nodes={tree} visiblePaths={filter?.visible ?? null} />
            )}

            {!loading && !error && tree && tree.length > 0 && filter && filter.visible.size === 0 && (
                <div
                    className="py-6 px-4 text-center text-xs text-[#656d76] dark:text-[#9d9d9d] italic"
                    data-testid={tid('notes-search-empty')}
                >
                    No notes match “{searchQuery.trim()}”
                </div>
            )}
        </>
    );

    if (!header) return body;

    return (
        <div data-testid={tid('notes-root-section')} data-expanded={header.expanded ? 'true' : 'false'}>
            <NotesSectionHeader
                label={header.label}
                expanded={header.expanded}
                onToggle={header.onToggle}
                count={header.count}
                isDefault={header.isDefault}
                isProtected={header.isProtected}
                protectedReason={header.protectedReason}
                actions={header.actions}
                testId={tid('notes-section-header')}
            />
            {!collapsed && body}
        </div>
    );
}
