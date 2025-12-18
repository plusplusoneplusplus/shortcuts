/**
 * Mermaid diagram handling for the webview
 */

import { MarkdownComment } from '../types';
import { escapeHtml } from '../webview-logic/markdown-renderer';
import { checkBlockHasComments, parseCodeBlocks } from './code-block-handlers';
import { showFloatingPanel } from './panel-manager';
import { state } from './state';
import { CodeBlock } from './types';

/**
 * Zoom/pan state for each mermaid diagram
 */
interface MermaidViewState {
    scale: number;
    translateX: number;
    translateY: number;
    isDragging: boolean;
    dragStartX: number;
    dragStartY: number;
    lastTranslateX: number;
    lastTranslateY: number;
}

const mermaidViewStates: Map<string, MermaidViewState> = new Map();

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

/**
 * Edge selector mapping for different diagram types
 * Maps diagram types to their edge/link CSS selectors
 */
const EDGE_SELECTORS_BY_DIAGRAM_TYPE: Record<string, string[]> = {
    flowchart: ['.edge', '.flowchart-link', 'path.edge-pattern'],
    sequence: ['.messageLine0', '.messageLine1', '.loopLine'],
    state: ['.transition'],
    er: ['.er.relationshipLine'],
    class: ['.relation'],
    // Fallback for unknown types
    default: ['.edge', 'path[class*="link"]', 'path[class*="edge"]']
};

/**
 * Get edge selectors for a diagram type
 */
function getEdgeSelectorsForDiagram(diagramType: string): string[] {
    const normalizedType = diagramType?.toLowerCase() || 'default';
    return EDGE_SELECTORS_BY_DIAGRAM_TYPE[normalizedType] ||
           EDGE_SELECTORS_BY_DIAGRAM_TYPE.default;
}

/**
 * Get or create view state for a mermaid diagram
 */
function getViewState(diagramId: string): MermaidViewState {
    if (!mermaidViewStates.has(diagramId)) {
        mermaidViewStates.set(diagramId, {
            scale: 1,
            translateX: 0,
            translateY: 0,
            isDragging: false,
            dragStartX: 0,
            dragStartY: 0,
            lastTranslateX: 0,
            lastTranslateY: 0
        });
    }
    return mermaidViewStates.get(diagramId)!;
}

/**
 * Apply transform to mermaid diagram
 */
function applyTransform(container: HTMLElement, viewState: MermaidViewState): void {
    const svgWrapper = container.querySelector('.mermaid-svg-wrapper') as HTMLElement;
    if (svgWrapper) {
        svgWrapper.style.transform = `translate(${viewState.translateX}px, ${viewState.translateY}px) scale(${viewState.scale})`;
    }

    // Update zoom level display
    const zoomDisplay = container.querySelector('.mermaid-zoom-level') as HTMLElement;
    if (zoomDisplay) {
        zoomDisplay.textContent = Math.round(viewState.scale * 100) + '%';
    }
}

/**
 * Load mermaid.js lazily
 */
export function loadMermaid(callback: () => void): void {
    if (state.mermaidLoaded) {
        callback();
        return;
    }

    if (state.mermaidLoading) {
        state.addPendingMermaidBlock(callback);
        return;
    }

    state.setMermaidLoading(true);

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    script.onload = () => {
        state.setMermaidLoaded(true);
        state.setMermaidLoading(false);

        // Initialize mermaid with theme based on VSCode theme
        const isDark = document.body.classList.contains('vscode-dark') ||
            document.body.classList.contains('vscode-high-contrast');
        window.mermaid.initialize({
            startOnLoad: false,
            theme: isDark ? 'dark' : 'default',
            securityLevel: 'loose',
            flowchart: {
                useMaxWidth: true,
                htmlLabels: true,
                curve: 'basis',
                padding: 15
            },
            sequence: {
                useMaxWidth: true
            },
            gantt: {
                useMaxWidth: true
            },
            er: {
                useMaxWidth: true
            },
            pie: {
                useMaxWidth: true
            }
        });

        callback();

        // Process pending callbacks
        state.pendingMermaidBlocks.forEach(cb => cb());
        state.clearPendingMermaidBlocks();
    };
    script.onerror = () => {
        state.setMermaidLoading(false);
        console.error('Failed to load mermaid.js');
    };
    document.head.appendChild(script);
}

/**
 * Render a mermaid diagram
 */
async function renderMermaidDiagram(block: CodeBlock, container: HTMLElement): Promise<void> {
    try {
        const id = 'mermaid-' + block.startLine + '-' + Date.now();
        const { svg } = await window.mermaid.render(id, block.code);

        const previewDiv = container.querySelector('.mermaid-preview');
        if (previewDiv) {
            // Wrap SVG in a wrapper for zoom/pan transformations
            previewDiv.innerHTML = '<div class="mermaid-svg-wrapper">' + svg + '</div>';
            previewDiv.classList.remove('mermaid-loading');

            // Adjust SVG to better use available space
            const svgElement = previewDiv.querySelector('svg');
            if (svgElement) {
                // Remove fixed dimensions to allow CSS to control sizing
                svgElement.removeAttribute('style');
                // Set viewBox if not present to enable proper scaling
                if (!svgElement.getAttribute('viewBox')) {
                    const width = svgElement.getAttribute('width') || '100%';
                    const height = svgElement.getAttribute('height') || '100%';
                    const numWidth = parseFloat(width) || 800;
                    const numHeight = parseFloat(height) || 600;
                    svgElement.setAttribute('viewBox', `0 0 ${numWidth} ${numHeight}`);
                }
                // Remove fixed width/height to let CSS handle sizing
                svgElement.removeAttribute('width');
                svgElement.removeAttribute('height');
            }

            // Setup node and edge click handlers for commenting
            setupMermaidElementHandlers(previewDiv as HTMLElement, block);

            // Setup zoom/pan handlers for this diagram
            const diagramId = container.dataset.mermaidId || block.id;
            setupMermaidZoomPan(container, diagramId);
        }
    } catch (error) {
        const previewDiv = container.querySelector('.mermaid-preview');
        if (previewDiv) {
            previewDiv.classList.remove('mermaid-loading');
            previewDiv.innerHTML = '<div class="mermaid-error-message">Diagram Error: ' +
                escapeHtml((error as Error).message || 'Unknown error') + '</div>';
        }
        container.classList.add('mermaid-error');
    }
}

/**
 * Setup click handlers for mermaid diagram nodes and edges
 */
function setupMermaidElementHandlers(previewDiv: HTMLElement, block: CodeBlock): void {
    // Setup node handlers
    const nodes = previewDiv.querySelectorAll('.node, .cluster');
    nodes.forEach(node => {
        (node as HTMLElement).style.cursor = 'pointer';
        node.addEventListener('click', (e) => {
            e.stopPropagation();
            const nodeEl = node as HTMLElement;
            const nodeId = nodeEl.id || nodeEl.getAttribute('data-id') || 'unknown';
            const nodeLabel = node.textContent?.trim() || nodeId;

            // Open comment panel for this node
            openMermaidNodeComment(block, nodeId, nodeLabel, nodeEl);
        });
    });

    // Setup edge handlers
    const diagramType = block.language || 'flowchart';
    const edgeSelectors = getEdgeSelectorsForDiagram(diagramType);
    const edgeSelectorString = edgeSelectors.join(', ');
    const edges = previewDiv.querySelectorAll(edgeSelectorString);

    edges.forEach(edge => {
        const edgeEl = edge as SVGElement;

        // Skip if this is inside a node (some edges might be nested)
        if (edgeEl.closest('.node, .cluster')) {
            return;
        }

        // Add clickable styling
        edgeEl.style.cursor = 'pointer';
        edgeEl.classList.add('mermaid-edge-clickable');

        // Click handler
        edgeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const metadata = extractEdgeMetadata(edgeEl, diagramType);
            openMermaidEdgeComment(block, metadata, edgeEl);
        });

        // Hover effects
        edgeEl.addEventListener('mouseenter', () => {
            edgeEl.classList.add('mermaid-edge-hover');
        });

        edgeEl.addEventListener('mouseleave', () => {
            edgeEl.classList.remove('mermaid-edge-hover');
        });
    });
}

/**
 * Open comment panel for a mermaid node
 */
function openMermaidNodeComment(
    block: CodeBlock,
    nodeId: string,
    nodeLabel: string,
    element: HTMLElement
): void {
    state.setPendingSelection({
        startLine: block.startLine,
        startColumn: 1,
        endLine: block.endLine,
        endColumn: 1,
        selectedText: '[Mermaid Node: ' + nodeLabel + ']',
        mermaidContext: {
            diagramId: block.id,
            nodeId: nodeId,
            nodeLabel: nodeLabel,
            diagramType: block.language,
            elementType: 'node'
        }
    });

    const rect = element.getBoundingClientRect();
    showFloatingPanel(rect, 'Mermaid Node: ' + nodeLabel);
}

/**
 * Edge metadata extracted from SVG element
 */
interface EdgeMetadata {
    edgeId: string;
    edgeLabel: string;
    sourceNode?: string;
    targetNode?: string;
}

/**
 * Extract edge metadata from SVG element
 * Handles various diagram types and edge representations
 */
function extractEdgeMetadata(
    edgeElement: SVGElement,
    diagramType: string
): EdgeMetadata {
    const edgeId = edgeElement.id ||
                   edgeElement.getAttribute('data-id') ||
                   'edge-' + Date.now();

    // Try to find edge label
    let edgeLabel = '';

    // Method 1: Look for associated label element (common in flowcharts)
    const parentGroup = edgeElement.closest('g');
    const labelElement = parentGroup?.querySelector('.edgeLabel, .label, text');
    if (labelElement) {
        edgeLabel = labelElement.textContent?.trim() || '';
    }

    // Method 2: Check for title or aria-label attributes
    if (!edgeLabel) {
        edgeLabel = edgeElement.getAttribute('title') ||
                   edgeElement.getAttribute('aria-label') || '';
    }

    // Method 3: Check for data attributes
    if (!edgeLabel) {
        edgeLabel = edgeElement.getAttribute('data-label') || '';
    }

    // Extract source and target nodes from class names or data attributes
    let sourceNode: string | undefined;
    let targetNode: string | undefined;

    const classNames = edgeElement.className?.baseVal || '';
    // Match patterns like "L-A-B" or "LS-A-B" (flowchart edge classes)
    const classMatch = classNames.match(/L[ES]?-(\w+)-(\w+)/);
    if (classMatch) {
        sourceNode = classMatch[1];
        targetNode = classMatch[2];
    }

    // Fallback: Look for data-from and data-to attributes
    if (!sourceNode) {
        sourceNode = edgeElement.getAttribute('data-from') || undefined;
        targetNode = edgeElement.getAttribute('data-to') || undefined;
    }

    // Generate friendly label if none found
    if (!edgeLabel) {
        if (sourceNode && targetNode) {
            edgeLabel = sourceNode + ' → ' + targetNode;
        } else {
            edgeLabel = 'Edge';
        }
    }

    return {
        edgeId,
        edgeLabel,
        sourceNode,
        targetNode
    };
}

/**
 * Open comment panel for a mermaid edge
 */
function openMermaidEdgeComment(
    block: CodeBlock,
    edgeMetadata: EdgeMetadata,
    element: SVGElement
): void {
    state.setPendingSelection({
        startLine: block.startLine,
        startColumn: 1,
        endLine: block.endLine,
        endColumn: 1,
        selectedText: '[Mermaid Edge: ' + edgeMetadata.edgeLabel + ']',
        mermaidContext: {
            diagramId: block.id,
            edgeId: edgeMetadata.edgeId,
            edgeLabel: edgeMetadata.edgeLabel,
            edgeSourceNode: edgeMetadata.sourceNode,
            edgeTargetNode: edgeMetadata.targetNode,
            diagramType: block.language,
            elementType: 'edge'
        }
    });

    const rect = element.getBoundingClientRect();
    showFloatingPanel(rect, 'Mermaid Edge: ' + edgeMetadata.edgeLabel);
}

/**
 * Render a mermaid block container
 */
export function renderMermaidContainer(
    block: CodeBlock,
    commentsMap: Map<number, MarkdownComment[]>
): string {
    const hasBlockComments = checkBlockHasComments(block.startLine, block.endLine, commentsMap);
    const containerClass = 'mermaid-container' + (hasBlockComments ? ' has-comments' : '');
    const lineCount = block.code.split('\n').length;

    return '<div class="' + containerClass + '" data-start-line="' + block.startLine +
        '" data-end-line="' + block.endLine + '" data-mermaid-id="' + block.id + '">' +
        '<div class="mermaid-header">' +
        '<div class="mermaid-header-left">' +
        '<button class="mermaid-action-btn mermaid-collapse-btn" title="Collapse diagram">▼</button>' +
        '<span class="mermaid-label">Mermaid Diagram</span>' +
        '<span class="mermaid-line-count">(' + lineCount + ' line' + (lineCount !== 1 ? 's' : '') + ')</span>' +
        '</div>' +
        '<div class="mermaid-zoom-controls">' +
        '<button class="mermaid-zoom-btn mermaid-zoom-out" title="Zoom out (−)">−</button>' +
        '<span class="mermaid-zoom-level">100%</span>' +
        '<button class="mermaid-zoom-btn mermaid-zoom-in" title="Zoom in (+)">+</button>' +
        '<button class="mermaid-zoom-btn mermaid-zoom-reset" title="Reset view">⟲</button>' +
        '</div>' +
        '<div class="mermaid-actions">' +
        '<button class="mermaid-action-btn mermaid-toggle-btn" title="Toggle source/preview">🔄 Toggle</button>' +
        '<button class="mermaid-action-btn mermaid-comment-btn" title="Add comment to diagram">💬</button>' +
        '</div>' +
        '</div>' +
        '<div class="mermaid-content">' +
        '<div class="mermaid-preview mermaid-loading">Loading diagram...</div>' +
        '<div class="mermaid-source" style="display: none;"><code>' + escapeHtml(block.code) + '</code></div>' +
        '</div>' +
        '</div>';
}

/**
 * Render all mermaid diagrams in the content
 */
export function renderMermaidDiagrams(): void {
    const mermaidContainers = document.querySelectorAll('.mermaid-container');
    if (mermaidContainers.length === 0) return;

    const codeBlocks = parseCodeBlocks(state.currentContent);
    const mermaidBlocks = codeBlocks.filter(b => b.isMermaid);

    loadMermaid(() => {
        mermaidContainers.forEach((container, index) => {
            const block = mermaidBlocks[index];
            if (block) {
                renderMermaidDiagram(block, container as HTMLElement);
            }
        });
    });

    // Setup mermaid action handlers
    setupMermaidHandlers();
}

/**
 * Setup zoom and pan handlers for a mermaid diagram
 */
function setupMermaidZoomPan(container: HTMLElement, diagramId: string): void {
    const viewState = getViewState(diagramId);
    const previewDiv = container.querySelector('.mermaid-preview') as HTMLElement;
    const svgWrapper = container.querySelector('.mermaid-svg-wrapper') as HTMLElement;

    if (!previewDiv || !svgWrapper) return;

    // Zoom in button
    const zoomInBtn = container.querySelector('.mermaid-zoom-in');
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            viewState.scale = Math.min(MAX_ZOOM, viewState.scale + ZOOM_STEP);
            applyTransform(container, viewState);
        });
    }

    // Zoom out button
    const zoomOutBtn = container.querySelector('.mermaid-zoom-out');
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            viewState.scale = Math.max(MIN_ZOOM, viewState.scale - ZOOM_STEP);
            applyTransform(container, viewState);
        });
    }

    // Reset button
    const resetBtn = container.querySelector('.mermaid-zoom-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            viewState.scale = 1;
            viewState.translateX = 0;
            viewState.translateY = 0;
            applyTransform(container, viewState);
        });
    }

    // Mouse wheel zoom
    previewDiv.addEventListener('wheel', (e) => {
        // Only zoom if Ctrl/Cmd is held
        if (!e.ctrlKey && !e.metaKey) return;

        e.preventDefault();
        e.stopPropagation();

        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewState.scale + delta));

        // Zoom towards mouse position
        if (newScale !== viewState.scale) {
            const rect = previewDiv.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Calculate the point under the mouse in diagram coordinates
            const pointX = (mouseX - viewState.translateX) / viewState.scale;
            const pointY = (mouseY - viewState.translateY) / viewState.scale;

            viewState.scale = newScale;

            // Adjust translation to keep the point under the mouse
            viewState.translateX = mouseX - pointX * viewState.scale;
            viewState.translateY = mouseY - pointY * viewState.scale;

            applyTransform(container, viewState);
        }
    }, { passive: false });

    // Mouse drag for panning
    previewDiv.addEventListener('mousedown', (e) => {
        // Only pan with middle mouse button or when holding space
        // Or with left click when not clicking on a node
        const target = e.target as HTMLElement;
        const isNode = target.closest('.node, .cluster, .label');

        if (e.button === 1 || (e.button === 0 && !isNode)) {
            if (e.button === 0 && isNode) return; // Let node click handler handle it

            viewState.isDragging = true;
            viewState.dragStartX = e.clientX;
            viewState.dragStartY = e.clientY;
            viewState.lastTranslateX = viewState.translateX;
            viewState.lastTranslateY = viewState.translateY;
            previewDiv.classList.add('mermaid-dragging');
            e.preventDefault();
        }
    });

    previewDiv.addEventListener('mousemove', (e) => {
        if (!viewState.isDragging) return;

        const deltaX = e.clientX - viewState.dragStartX;
        const deltaY = e.clientY - viewState.dragStartY;

        viewState.translateX = viewState.lastTranslateX + deltaX;
        viewState.translateY = viewState.lastTranslateY + deltaY;

        applyTransform(container, viewState);
    });

    const stopDragging = () => {
        if (viewState.isDragging) {
            viewState.isDragging = false;
            previewDiv.classList.remove('mermaid-dragging');
        }
    };

    previewDiv.addEventListener('mouseup', stopDragging);
    previewDiv.addEventListener('mouseleave', stopDragging);
}

/**
 * Setup handlers for mermaid actions
 */
export function setupMermaidHandlers(): void {
    // Collapse/expand button handlers
    document.querySelectorAll('.mermaid-collapse-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const button = btn as HTMLButtonElement;
            const container = button.closest('.mermaid-container') as HTMLElement;
            const content = container.querySelector('.mermaid-content') as HTMLElement;
            const zoomControls = container.querySelector('.mermaid-zoom-controls') as HTMLElement;
            const actions = container.querySelector('.mermaid-actions') as HTMLElement;
            // Find the parent block-row to access the line number column
            const blockRow = container.closest('.block-row') as HTMLElement;
            const lineNumberColumn = blockRow?.querySelector('.line-number-column') as HTMLElement;

            if (container.classList.contains('collapsed')) {
                container.classList.remove('collapsed');
                content.style.display = 'block';
                if (zoomControls) zoomControls.style.display = 'flex';
                if (actions) actions.style.display = 'flex';
                if (lineNumberColumn) lineNumberColumn.style.display = 'block';
                button.textContent = '▼';
                button.title = 'Collapse diagram';
            } else {
                container.classList.add('collapsed');
                content.style.display = 'none';
                if (zoomControls) zoomControls.style.display = 'none';
                if (actions) actions.style.display = 'none';
                if (lineNumberColumn) lineNumberColumn.style.display = 'none';
                button.textContent = '▶';
                button.title = 'Expand diagram';
            }
        });
    });

    // Toggle button handlers
    document.querySelectorAll('.mermaid-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const container = (btn as HTMLElement).closest('.mermaid-container') as HTMLElement;
            const preview = container.querySelector('.mermaid-preview') as HTMLElement;
            const source = container.querySelector('.mermaid-source') as HTMLElement;

            if (preview.style.display === 'none') {
                preview.style.display = 'flex';
                source.style.display = 'none';
                btn.textContent = '🔄 Toggle';
            } else {
                preview.style.display = 'none';
                source.style.display = 'block';
                btn.textContent = '👁️ Preview';
            }
        });
    });

    // Comment button handlers for diagrams
    document.querySelectorAll('.mermaid-comment-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const container = (btn as HTMLElement).closest('.mermaid-container') as HTMLElement;
            const startLine = parseInt(container.dataset.startLine || '');
            const endLine = parseInt(container.dataset.endLine || '');
            const diagramId = container.dataset.mermaidId;

            state.setPendingSelection({
                startLine,
                startColumn: 1,
                endLine,
                endColumn: 1,
                selectedText: '[Mermaid Diagram: lines ' + startLine + '-' + endLine + ']',
                mermaidContext: {
                    diagramId: diagramId || '',
                    diagramType: 'mermaid'
                }
            });

            showFloatingPanel(btn.getBoundingClientRect(), 'Mermaid Diagram');
        });
    });
}

