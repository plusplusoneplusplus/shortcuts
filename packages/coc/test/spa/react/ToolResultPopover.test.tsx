/**
 * Tests for ToolResultPopover component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolResultPopover } from '../../../src/server/spa/client/react/processes/ToolResultPopover';

vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

function makeAnchorRect(overrides: Partial<DOMRect> = {}): DOMRect {
    return {
        top: 100,
        left: 50,
        bottom: 120,
        right: 250,
        width: 200,
        height: 20,
        x: 50,
        y: 100,
        toJSON: () => ({}),
        ...overrides,
    } as DOMRect;
}

const defaultHandlers = { onMouseEnter: () => {}, onMouseLeave: () => {} };

describe('ToolResultPopover', () => {
    it('renders result text in a portal on document.body', () => {
        render(
            <ToolResultPopover
                result="Hello from the task agent"
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Hello from the task agent');
        expect(popover!.textContent).toContain('Result Preview');
    });

    it('truncates text longer than 2000 chars', () => {
        const longText = 'a'.repeat(2500);
        render(
            <ToolResultPopover
                result={longText}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('… (truncated — click to see full)');
    });

    it('does not truncate text under 2000 chars', () => {
        const shortText = 'b'.repeat(1999);
        render(
            <ToolResultPopover
                result={shortText}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).not.toContain('truncated');
    });

    it('calls onMouseEnter when hovering the popover', () => {
        let entered = false;
        render(
            <ToolResultPopover
                result="test"
                anchorRect={makeAnchorRect()}
                onMouseEnter={() => { entered = true; }}
                onMouseLeave={() => {}}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]')!;
        fireEvent.mouseEnter(popover);
        expect(entered).toBe(true);
    });

    it('calls onMouseLeave when leaving the popover', () => {
        let left = false;
        render(
            <ToolResultPopover
                result="test"
                anchorRect={makeAnchorRect()}
                onMouseEnter={() => {}}
                onMouseLeave={() => { left = true; }}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]')!;
        fireEvent.mouseLeave(popover);
        expect(left).toBe(true);
    });

    // --- view tool: markdown files ---

    it('renders markdown popover for view tool with .md file', () => {
        render(
            <ToolResultPopover
                result="1. # Hello\n2. Some **bold** text"
                toolName="view"
                args={{ path: '/project/README.md' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('File Preview');
        expect(popover!.textContent).not.toContain('Result Preview');
        const mdEl = document.querySelector('[data-testid="popover-markdown"]');
        expect(mdEl).toBeTruthy();
        expect(mdEl!.classList.contains('markdown-body')).toBe(true);
    });

    it('renders markdown popover for .markdown extension', () => {
        render(
            <ToolResultPopover
                result="1. # Title"
                toolName="view"
                args={{ path: '/project/notes.markdown' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        expect(document.querySelector('[data-testid="popover-markdown"]')).toBeTruthy();
    });

    it('renders markdown popover for .mdx extension', () => {
        render(
            <ToolResultPopover
                result="1. # Title"
                toolName="view"
                args={{ path: '/project/page.mdx' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        expect(document.querySelector('[data-testid="popover-markdown"]')).toBeTruthy();
    });

    // --- view tool: code files ---

    it('renders code preview with line numbers for view tool with .ts file', () => {
        render(
            <ToolResultPopover
                result="1. const x = 1;\n2. const y = 2;"
                toolName="view"
                args={{ path: '/project/index.ts' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('File Preview');
        const codeEl = document.querySelector('[data-testid="popover-code"]');
        expect(codeEl).toBeTruthy();
        expect(codeEl!.textContent).toContain('const x = 1;');
        expect(codeEl!.textContent).toContain('1');
        expect(codeEl!.textContent).toContain('2');
    });

    it('renders code preview for view tool with filePath arg', () => {
        render(
            <ToolResultPopover
                result="1. line one"
                toolName="view"
                args={{ filePath: '/project/foo.py' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        expect(document.querySelector('[data-testid="popover-code"]')).toBeTruthy();
    });

    // --- task tool: raw text (regression) ---

    it('renders raw text for task tool (regression)', () => {
        render(
            <ToolResultPopover
                result="Task completed successfully."
                toolName="task"
                args={{ agent_type: 'explore' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Result Preview');
        expect(popover!.textContent).toContain('Task completed successfully.');
        // Should NOT have markdown or code sub-testids
        expect(document.querySelector('[data-testid="popover-markdown"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-code"]')).toBeNull();
    });

    // --- no toolName: default behavior ---

    it('renders raw text when no toolName is provided (backward compat)', () => {
        render(
            <ToolResultPopover
                result="Some result"
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Result Preview');
        expect(popover!.textContent).toContain('Some result');
    });

    // --- image data URL rendering ---

    it('renders an img tag when result is a PNG image data URL', () => {
        const imgDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';
        render(
            <ToolResultPopover
                result={imgDataUrl}
                toolName="view"
                args={{ path: '/project/screenshot.png' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const img = document.querySelector('[data-testid="popover-image"]') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.src).toBe(imgDataUrl);
        expect(img.alt).toContain('screenshot.png');
        // Should NOT render markdown, code, or raw text branches
        expect(document.querySelector('[data-testid="popover-markdown"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-code"]')).toBeNull();
    });

    it('renders an img tag for JPEG image data URL', () => {
        const imgDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';
        render(
            <ToolResultPopover
                result={imgDataUrl}
                toolName="view"
                args={{ path: '/project/photo.jpg' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        expect(document.querySelector('[data-testid="popover-image"]')).toBeTruthy();
    });

    it('renders an img tag for image data URL even without view toolName', () => {
        const imgDataUrl = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA';
        render(
            <ToolResultPopover
                result={imgDataUrl}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const img = document.querySelector('[data-testid="popover-image"]') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.alt).toBe('Image preview');
    });

    it('uses "Image preview" alt when no filePath is available', () => {
        const imgDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';
        render(
            <ToolResultPopover
                result={imgDataUrl}
                toolName="view"
                args={{}}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const img = document.querySelector('[data-testid="popover-image"]') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.alt).toBe('Image preview');
    });

    it('does not render image for non-image data URLs', () => {
        render(
            <ToolResultPopover
                result="data:text/plain;base64,aGVsbG8="
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        expect(document.querySelector('[data-testid="popover-image"]')).toBeNull();
    });
});
