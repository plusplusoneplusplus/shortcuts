/**
 * CommentPanelAdapter — discriminated wrapper that routes to either
 * the notes CommentsSidebar or the task/review CommentSidebar.
 *
 * Contains no business logic; conditional rendering only.
 */

import { CommentsSidebar, type CommentsSidebarProps } from '../repos/notes/CommentsSidebar';
import { CommentSidebar, type CommentSidebarProps } from '../tasks/comments/CommentSidebar';

export interface NotesCommentPanelProps extends CommentsSidebarProps {
    variant: 'notes';
}

export interface TaskCommentPanelProps extends CommentSidebarProps {
    variant: 'task';
}

export type CommentPanelAdapterProps = NotesCommentPanelProps | TaskCommentPanelProps;

export function CommentPanelAdapter(props: CommentPanelAdapterProps) {
    if (props.variant === 'notes') {
        const { variant: _, ...sidebarProps } = props;
        return <CommentsSidebar {...sidebarProps} />;
    }

    const { variant: _, ...sidebarProps } = props;
    return <CommentSidebar {...sidebarProps} />;
}
