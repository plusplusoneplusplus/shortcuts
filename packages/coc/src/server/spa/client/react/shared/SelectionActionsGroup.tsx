import { forwardRef, type CSSProperties, type ReactNode } from 'react';

export const SELECTION_ACTION_BUTTON_CLASS = 'px-2 py-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500';

export interface SelectionActionsGroupProps {
    /** Absolute coordinates inside the selection host's positioned wrapper. */
    style: CSSProperties;
    /** Focus left the group: hide it. */
    onDismiss: () => void;
    children: ReactNode;
}

/**
 * The floating "Selection actions" pill shared by editor and rendered-document
 * selections. Pointer presses are swallowed so clicking a button keeps the
 * selection it acts on.
 */
export const SelectionActionsGroup = forwardRef<HTMLDivElement, SelectionActionsGroupProps>(function SelectionActionsGroup({ style, onDismiss, children }, ref) {
    return (
        <div
            ref={ref}
            role="group"
            aria-label="Selection actions"
            className="pointer-events-auto absolute z-20 flex flex-wrap w-max rounded-full border border-gray-300 bg-white text-xs text-gray-800 shadow dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            style={style}
            onPointerDownCapture={event => { event.preventDefault(); event.stopPropagation(); }}
            onMouseDownCapture={event => { event.preventDefault(); event.stopPropagation(); }}
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onDismiss(); }}
        >
            {children}
        </div>
    );
});
