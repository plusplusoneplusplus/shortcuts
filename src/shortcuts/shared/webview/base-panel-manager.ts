/**
 * Base Panel Manager
 * 
 * Provides common panel management functionality for webview scripts.
 * Includes drag functionality, positioning, and viewport bounds checking.
 */

/**
 * Panel position configuration
 */
export interface PanelPosition {
    left: number;
    top: number;
}

/**
 * Panel dimensions
 */
export interface PanelDimensions {
    width: number;
    height: number;
}

/**
 * Viewport bounds
 */
export interface ViewportBounds {
    minPadding: number;
    maxWidth: number;
    maxHeight: number;
}

/**
 * Default viewport bounds
 */
export const DEFAULT_VIEWPORT_BOUNDS: ViewportBounds = {
    minPadding: 20,
    maxWidth: 600,
    maxHeight: 500
};

/**
 * Calculate position to keep panel within viewport bounds
 */
export function constrainToViewport(
    position: PanelPosition,
    dimensions: PanelDimensions,
    bounds: ViewportBounds = DEFAULT_VIEWPORT_BOUNDS
): PanelPosition {
    let { left, top } = position;
    const { width, height } = dimensions;
    const { minPadding } = bounds;

    // Constrain horizontal position
    if (left + width > window.innerWidth - minPadding) {
        left = window.innerWidth - width - minPadding;
    }
    if (left < minPadding) {
        left = minPadding;
    }

    // Constrain vertical position
    if (top + height > window.innerHeight - minPadding) {
        top = window.innerHeight - height - minPadding;
    }
    if (top < minPadding) {
        top = minPadding;
    }

    return { left, top };
}

/**
 * Calculate optimal position for a panel below a selection rect
 */
export function calculatePanelPositionBelowRect(
    rect: DOMRect,
    panelDimensions: PanelDimensions,
    bounds: ViewportBounds = DEFAULT_VIEWPORT_BOUNDS
): PanelPosition {
    const { width: panelWidth, height: panelHeight } = panelDimensions;
    const { minPadding } = bounds;

    let left = rect.left;
    let top = rect.bottom + 10;

    // Adjust if panel would go off-screen vertically at the bottom
    if (top + panelHeight > window.innerHeight - minPadding) {
        // Try to position above the selection
        const topAbove = rect.top - panelHeight - 10;

        if (topAbove >= minPadding) {
            top = topAbove;
        } else {
            // Not enough room above either - position at the best visible spot
            const spaceBelow = window.innerHeight - rect.bottom - minPadding;
            const spaceAbove = rect.top - minPadding;

            if (spaceBelow >= spaceAbove) {
                top = Math.min(rect.bottom + 10, window.innerHeight - panelHeight - minPadding);
            } else {
                top = Math.max(minPadding, rect.top - panelHeight - 10);
            }
        }
    }

    return constrainToViewport({ left, top }, panelDimensions, bounds);
}

/**
 * Setup drag functionality for a panel
 * @param panel - The panel element to make draggable
 * @param headerSelector - CSS selector for the drag handle (usually the header)
 * @param excludeSelector - CSS selector for elements that should not trigger drag
 * @param onDragStart - Optional callback when drag starts
 * @param onDragEnd - Optional callback when drag ends
 */
export function setupPanelDrag(
    panel: HTMLElement,
    headerSelector: string,
    excludeSelector: string = '.close-btn, button',
    onDragStart?: () => void,
    onDragEnd?: () => void
): void {
    const header = panel.querySelector(headerSelector);
    if (!header) return;

    let isDragging = false;
    let startX: number, startY: number;
    let initialLeft: number, initialTop: number;

    const handleMouseDown = (e: Event) => {
        const event = e as MouseEvent;
        // Only start drag if not clicking on excluded elements
        if ((event.target as HTMLElement).closest(excludeSelector)) return;

        isDragging = true;
        panel.classList.add('dragging');
        onDragStart?.();

        startX = event.clientX;
        startY = event.clientY;
        
        // Get current position
        const rect = panel.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        // Ensure we're using fixed positioning for dragging
        panel.style.position = 'fixed';

        event.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;

        // Keep panel within viewport bounds
        const panelWidth = panel.offsetWidth;
        const panelHeight = panel.offsetHeight;

        newLeft = Math.max(10, Math.min(newLeft, window.innerWidth - panelWidth - 10));
        newTop = Math.max(10, Math.min(newTop, window.innerHeight - panelHeight - 10));

        panel.style.left = newLeft + 'px';
        panel.style.top = newTop + 'px';
        panel.style.right = 'auto'; // Clear right positioning
    };

    const handleMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            panel.classList.remove('dragging');
            onDragEnd?.();
        }
    };

    header.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Add cursor style to indicate draggable header
    (header as HTMLElement).style.cursor = 'move';
}

/**
 * Resize handle directions
 */
export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Resize constraints
 */
export interface ResizeConstraints {
    minWidth: number;
    minHeight: number;
    maxWidth: number;
    maxHeight: number;
}

/**
 * Default resize constraints
 */
export const DEFAULT_RESIZE_CONSTRAINTS: ResizeConstraints = {
    minWidth: 280,
    minHeight: 120,
    maxWidth: window.innerWidth - 40,
    maxHeight: window.innerHeight - 40
};

/**
 * Setup resize functionality for an element
 */
export function setupElementResize(
    element: HTMLElement,
    handleSelector: string,
    constraints: ResizeConstraints = DEFAULT_RESIZE_CONSTRAINTS,
    onResizeStart?: () => void,
    onResizeEnd?: () => void
): void {
    const handles = element.querySelectorAll(handleSelector);
    if (handles.length === 0) return;

    let isResizing = false;
    let currentHandle: ResizeDirection | null = null;
    let startX: number, startY: number;
    let initialWidth: number, initialHeight: number;
    let initialLeft: number, initialTop: number;

    handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            const event = e as MouseEvent;
            event.preventDefault();
            event.stopPropagation();

            isResizing = true;
            currentHandle = (handle as HTMLElement).dataset.resize as ResizeDirection || null;
            element.classList.add('resizing');
            (handle as HTMLElement).classList.add('active');
            onResizeStart?.();

            startX = event.clientX;
            startY = event.clientY;
            initialWidth = element.offsetWidth;
            initialHeight = element.offsetHeight;
            initialLeft = parseInt(element.style.left) || 0;
            initialTop = parseInt(element.style.top) || 0;
        });
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing || !currentHandle) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        const { minWidth, minHeight, maxWidth, maxHeight } = constraints;

        let newWidth = initialWidth;
        let newHeight = initialHeight;
        let newLeft = initialLeft;
        let newTop = initialTop;

        // Calculate new dimensions based on which handle is being dragged
        switch (currentHandle) {
            case 'e':
                newWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth + deltaX));
                break;
            case 's':
                newHeight = Math.max(minHeight, Math.min(maxHeight, initialHeight + deltaY));
                break;
            case 'se':
                newWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth + deltaX));
                newHeight = Math.max(minHeight, Math.min(maxHeight, initialHeight + deltaY));
                break;
            case 'w':
                newWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth - deltaX));
                newLeft = initialLeft + (initialWidth - newWidth);
                break;
            case 'n':
                newHeight = Math.max(minHeight, Math.min(maxHeight, initialHeight - deltaY));
                newTop = initialTop + (initialHeight - newHeight);
                break;
            case 'sw':
                newWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth - deltaX));
                newHeight = Math.max(minHeight, Math.min(maxHeight, initialHeight + deltaY));
                newLeft = initialLeft + (initialWidth - newWidth);
                break;
            case 'ne':
                newWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth + deltaX));
                newHeight = Math.max(minHeight, Math.min(maxHeight, initialHeight - deltaY));
                newTop = initialTop + (initialHeight - newHeight);
                break;
            case 'nw':
                newWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth - deltaX));
                newHeight = Math.max(minHeight, Math.min(maxHeight, initialHeight - deltaY));
                newLeft = initialLeft + (initialWidth - newWidth);
                newTop = initialTop + (initialHeight - newHeight);
                break;
        }

        // Keep within viewport bounds
        if (newLeft < 10) {
            newWidth = newWidth - (10 - newLeft);
            newLeft = 10;
        }
        if (newTop < 10) {
            newHeight = newHeight - (10 - newTop);
            newTop = 10;
        }
        if (newLeft + newWidth > window.innerWidth - 10) {
            newWidth = window.innerWidth - newLeft - 10;
        }
        if (newTop + newHeight > window.innerHeight - 10) {
            newHeight = window.innerHeight - newTop - 10;
        }

        // Apply new dimensions
        element.style.width = newWidth + 'px';
        element.style.height = newHeight + 'px';
        element.style.left = newLeft + 'px';
        element.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            currentHandle = null;
            element.classList.remove('resizing');
            element.querySelectorAll(handleSelector).forEach(h => {
                h.classList.remove('active');
            });
            onResizeEnd?.();
        }
    });
}

/**
 * Format a date for display in comment bubbles
 */
export function formatCommentDate(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
        return 'just now';
    } else if (diffMins < 60) {
        return `${diffMins}m ago`;
    } else if (diffHours < 24) {
        return `${diffHours}h ago`;
    } else if (diffDays < 7) {
        return `${diffDays}d ago`;
    } else {
        return date.toLocaleDateString();
    }
}

/**
 * Escape HTML for safe display
 */
export function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Setup drag functionality for a bubble/floating element
 * Similar to setupPanelDrag but designed for dynamically created bubbles
 * that may not have a dedicated header element.
 * 
 * @param bubble - The bubble element to make draggable
 * @param headerSelector - CSS selector for the drag handle (usually the header)
 * @param excludeSelector - CSS selector for elements that should not trigger drag
 * @param onDragStart - Optional callback when drag starts
 * @param onDragEnd - Optional callback when drag ends
 */
export function setupBubbleDrag(
    bubble: HTMLElement,
    headerSelector: string = '.bubble-header',
    excludeSelector: string = '.bubble-action-btn, button',
    onDragStart?: () => void,
    onDragEnd?: () => void
): void {
    const header = bubble.querySelector(headerSelector);
    if (!header) return;

    let isDragging = false;
    let startX: number, startY: number;
    let initialLeft: number, initialTop: number;

    const handleMouseDown = (e: Event) => {
        const event = e as MouseEvent;
        // Only start drag if not clicking on excluded elements
        if ((event.target as HTMLElement).closest(excludeSelector)) return;

        isDragging = true;
        bubble.classList.add('dragging');
        onDragStart?.();

        startX = event.clientX;
        startY = event.clientY;
        
        // Get current position
        const rect = bubble.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        // Ensure we're using fixed positioning for dragging
        bubble.style.position = 'fixed';

        event.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;

        // Keep bubble within viewport bounds
        const bubbleWidth = bubble.offsetWidth;
        const bubbleHeight = bubble.offsetHeight;

        newLeft = Math.max(10, Math.min(newLeft, window.innerWidth - bubbleWidth - 10));
        newTop = Math.max(10, Math.min(newTop, window.innerHeight - bubbleHeight - 10));

        bubble.style.left = newLeft + 'px';
        bubble.style.top = newTop + 'px';
    };

    const handleMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            bubble.classList.remove('dragging');
            onDragEnd?.();
        }
    };

    header.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Add cursor style to indicate draggable header
    (header as HTMLElement).style.cursor = 'move';
}

/**
 * Create resize handles HTML for a bubble element
 * Returns the HTML string for resize handles that can be appended to a bubble
 */
export function createResizeHandlesHTML(): string {
    return `
        <div class="resize-handle resize-handle-se" data-resize="se"></div>
        <div class="resize-handle resize-handle-e" data-resize="e"></div>
        <div class="resize-handle resize-handle-s" data-resize="s"></div>
        <div class="resize-grip"></div>
    `;
}

/**
 * Calculate optimal bubble dimensions based on content characteristics
 * @param commentLength - Length of the comment text
 * @param selectedTextLength - Length of the selected text
 * @param hasCodeBlocks - Whether the comment contains code blocks
 * @param hasLongLines - Whether the comment has lines > 60 chars
 * @param lineCount - Number of lines in the comment
 */
export function calculateBubbleDimensions(
    commentLength: number,
    selectedTextLength: number,
    hasCodeBlocks: boolean,
    hasLongLines: boolean,
    lineCount: number
): { width: number; height: number } {
    const minWidth = 280;
    const maxWidth = 600;
    const minHeight = 120;
    const maxHeight = 500;
    
    const totalLength = commentLength + selectedTextLength;
    
    // Calculate width based on content characteristics
    let width: number;
    if (hasCodeBlocks || hasLongLines) {
        // Code blocks and long lines need more width
        width = Math.min(maxWidth, Math.max(450, minWidth));
    } else if (totalLength < 100) {
        // Short comments can be narrower
        width = minWidth;
    } else if (totalLength < 300) {
        // Medium comments
        width = Math.min(380, minWidth + (totalLength - 100) * 0.5);
    } else {
        // Longer comments get wider
        width = Math.min(maxWidth, 380 + (totalLength - 300) * 0.3);
    }
    
    // Calculate height based on content
    // Approximate: ~50px for header, ~80px for selected text, rest for comment
    const baseHeight = 130; // header + selected text area + padding
    const lineHeight = 20; // approximate line height for comment text
    const estimatedCommentLines = Math.max(lineCount, Math.ceil(commentLength / (width / 8)));
    let height = baseHeight + (estimatedCommentLines * lineHeight);
    
    // Clamp height
    height = Math.max(minHeight, Math.min(maxHeight, height));
    
    return { width, height };
}

