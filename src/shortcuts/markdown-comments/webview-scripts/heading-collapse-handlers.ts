/**
 * Heading collapse handlers for the markdown review editor
 *
 * Provides collapse/expand functionality for markdown sections based on headings.
 * Each section includes the heading and all content until the next heading of the
 * same or higher level.
 */

import { state } from './state';
import { render } from './render';
import { buildSectionMap } from '../webview-logic/heading-parser';

// Re-export pure logic functions from the shared module
export {
    buildSectionMap,
    findSectionEndLine,
    generateAnchorId,
    getHeadingAnchorId,
    getHeadingLevel,
    HeadingInfo,
    parseHeadings
} from '../webview-logic/heading-parser';

/**
 * Check if a line number is within a collapsed section
 *
 * @param lineNum - 1-based line number to check
 * @param content - The markdown content
 * @returns true if the line is within a collapsed section
 */
export function isLineInCollapsedSection(lineNum: number, content: string): boolean {
    const sectionMap = buildSectionMap(content);

    for (const [anchorId, range] of sectionMap) {
        if (state.isSectionCollapsed(anchorId)) {
            // Line is in collapsed section if it's after the heading line (not including heading itself)
            if (lineNum > range.startLine && lineNum <= range.endLine) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Setup click handlers for heading collapse buttons
 * Call this after render to attach event listeners
 */
export function setupHeadingCollapseHandlers(): void {
    // Handle collapse button clicks
    document.querySelectorAll('.heading-collapse-btn').forEach(btn => {
        btn.addEventListener('click', handleCollapseButtonClick);
    });
}

/**
 * Handle click on a heading collapse button
 */
function handleCollapseButtonClick(e: Event): void {
    e.stopPropagation();
    e.preventDefault();

    const button = e.target as HTMLButtonElement;
    const lineRow = button.closest('.line-row') as HTMLElement;
    const anchorId = lineRow?.dataset.sectionAnchor;

    if (!anchorId) {
        console.warn('[HeadingCollapse] No anchor ID found for collapse button');
        return;
    }

    // Toggle collapsed state
    const isNowCollapsed = state.toggleSectionCollapsed(anchorId);

    // Re-render to apply the new state
    render(false);

    // Notify VS Code to persist the state
    state.vscode.postMessage({
        type: 'collapsedSectionsChanged',
        collapsedSections: state.getCollapsedSectionsArray()
    });
}

/**
 * Collapse all sections in the document
 */
export function collapseAllSections(): void {
    const sectionMap = buildSectionMap(state.currentContent);
    for (const anchorId of sectionMap.keys()) {
        state.setSectionCollapsed(anchorId, true);
    }
    render(false);

    state.vscode.postMessage({
        type: 'collapsedSectionsChanged',
        collapsedSections: state.getCollapsedSectionsArray()
    });
}

/**
 * Expand all sections in the document
 */
export function expandAllSections(): void {
    const sectionMap = buildSectionMap(state.currentContent);
    for (const anchorId of sectionMap.keys()) {
        state.setSectionCollapsed(anchorId, false);
    }
    render(false);

    state.vscode.postMessage({
        type: 'collapsedSectionsChanged',
        collapsedSections: state.getCollapsedSectionsArray()
    });
}

