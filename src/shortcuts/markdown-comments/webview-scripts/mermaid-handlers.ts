/**
 * Mermaid diagram handling for the webview
 */

import { state } from './state';
import { showFloatingPanel } from './panel-manager';
import { escapeHtml } from '../webview-logic/markdown-renderer';
import { checkBlockHasComments } from './code-block-handlers';
import { parseCodeBlocks } from './code-block-handlers';
import { MarkdownComment } from '../types';
import { CodeBlock } from './types';

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
            securityLevel: 'loose'
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
            previewDiv.innerHTML = svg;
            previewDiv.classList.remove('mermaid-loading');
            
            // Setup node click handlers for commenting
            setupMermaidNodeHandlers(previewDiv as HTMLElement, block);
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
 * Setup click handlers for mermaid diagram nodes
 */
function setupMermaidNodeHandlers(previewDiv: HTMLElement, block: CodeBlock): void {
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
            diagramType: block.language
        }
    });
    
    const rect = element.getBoundingClientRect();
    showFloatingPanel(rect, 'Mermaid Node: ' + nodeLabel);
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
    
    return '<div class="' + containerClass + '" data-start-line="' + block.startLine + 
           '" data-end-line="' + block.endLine + '" data-mermaid-id="' + block.id + '">' +
        '<div class="mermaid-header">' +
            '<span class="mermaid-label">📊 Mermaid Diagram</span>' +
            '<div class="mermaid-actions">' +
                '<button class="mermaid-action-btn mermaid-toggle-btn" title="Toggle source/preview">🔄 Toggle</button>' +
                '<button class="mermaid-action-btn mermaid-comment-btn" title="Add comment to diagram">💬</button>' +
            '</div>' +
        '</div>' +
        '<div class="mermaid-preview mermaid-loading">Loading diagram...</div>' +
        '<div class="mermaid-source" style="display: none;"><code>' + escapeHtml(block.code) + '</code></div>' +
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
 * Setup handlers for mermaid actions
 */
export function setupMermaidHandlers(): void {
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

