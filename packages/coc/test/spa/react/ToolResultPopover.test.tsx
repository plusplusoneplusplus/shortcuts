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

    // --- bash tool: terminal-style rendering ---

    it('renders terminal-style popover for bash tool', () => {
        render(
            <ToolResultPopover
                result="total 42\ndrwxr-xr-x  5 user staff  160 Jan  1 00:00 ."
                toolName="bash"
                args={{ command: 'ls -la' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Shell Output');
        expect(popover!.textContent).not.toContain('Result Preview');
        const terminalEl = document.querySelector('[data-testid="popover-terminal"]');
        expect(terminalEl).toBeTruthy();
        expect(terminalEl!.textContent).toContain('$ ls -la');
        expect(terminalEl!.textContent).toContain('total 42');
    });

    it('renders bash popover without command header when no command arg', () => {
        render(
            <ToolResultPopover
                result="output text"
                toolName="bash"
                args={{}}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const terminalEl = document.querySelector('[data-testid="popover-terminal"]');
        expect(terminalEl).toBeTruthy();
        expect(terminalEl!.textContent).not.toContain('$');
        expect(terminalEl!.textContent).toContain('output text');
    });

    it('strips ANSI escape codes in bash popover', () => {
        const ansiText = '\x1b[32mgreen\x1b[0m normal \x1b[1mbold\x1b[0m';
        render(
            <ToolResultPopover
                result={ansiText}
                toolName="bash"
                args={{ command: 'echo test' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const terminalEl = document.querySelector('[data-testid="popover-terminal"]');
        expect(terminalEl).toBeTruthy();
        expect(terminalEl!.textContent).toContain('green normal bold');
        expect(terminalEl!.innerHTML).not.toContain('\x1b');
    });

    it('does not render markdown or code sub-testids for bash tool', () => {
        render(
            <ToolResultPopover
                result="some output"
                toolName="bash"
                args={{ command: 'echo hello' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        expect(document.querySelector('[data-testid="popover-markdown"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-code"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-terminal"]')).toBeTruthy();
    });
});

// --- shell tool: terminal-style rendering ---

describe('ToolResultPopover — shell tool', () => {
    it('renders terminal-style popover for shell tool', () => {
        render(
            <ToolResultPopover
                result="hello world"
                toolName="shell"
                args={{ command: 'echo hello world' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Shell Output');
        const terminalEl = document.querySelector('[data-testid="popover-terminal"]');
        expect(terminalEl).toBeTruthy();
        expect(terminalEl!.textContent).toContain('$ echo hello world');
        expect(terminalEl!.textContent).toContain('hello world');
    });

    it('strips ANSI escape codes in shell popover', () => {
        const ansiText = '\x1b[32mgreen\x1b[0m normal';
        render(
            <ToolResultPopover
                result={ansiText}
                toolName="shell"
                args={{ command: 'echo test' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const terminalEl = document.querySelector('[data-testid="popover-terminal"]');
        expect(terminalEl).toBeTruthy();
        expect(terminalEl!.textContent).toContain('green normal');
        expect(terminalEl!.innerHTML).not.toContain('\x1b');
    });

    it('does not render other sub-testids for shell tool', () => {
        render(
            <ToolResultPopover
                result="output"
                toolName="shell"
                args={{ command: 'ls' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        expect(document.querySelector('[data-testid="popover-markdown"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-code"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-terminal"]')).toBeTruthy();
    });
});

// --- powershell tool: terminal-style rendering ---

describe('ToolResultPopover — powershell tool', () => {
    it('renders terminal-style popover for powershell tool', () => {
        render(
            <ToolResultPopover
                result={'done\n<exited with exit code 0>'}
                toolName="powershell"
                args={{ command: 'New-Item -ItemType Directory -Force -Path "D:\\projects"' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Shell Output');
        const terminalEl = document.querySelector('[data-testid="popover-terminal"]');
        expect(terminalEl).toBeTruthy();
        expect(terminalEl!.textContent).toContain('$ New-Item -ItemType Directory');
        expect(terminalEl!.textContent).toContain('done');
    });

    it('renders powershell popover without command header when no command arg', () => {
        render(
            <ToolResultPopover
                result="some output"
                toolName="powershell"
                args={{}}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const terminalEl = document.querySelector('[data-testid="popover-terminal"]');
        expect(terminalEl).toBeTruthy();
        expect(terminalEl!.textContent).not.toContain('$');
        expect(terminalEl!.textContent).toContain('some output');
    });

    it('strips ANSI escape codes in powershell popover', () => {
        const ansiText = '\x1b[32mSuccess\x1b[0m: build completed';
        render(
            <ToolResultPopover
                result={ansiText}
                toolName="powershell"
                args={{ command: 'Write-Host "test"' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const terminalEl = document.querySelector('[data-testid="popover-terminal"]');
        expect(terminalEl).toBeTruthy();
        expect(terminalEl!.textContent).toContain('Success: build completed');
        expect(terminalEl!.innerHTML).not.toContain('\x1b');
    });

    it('does not render other sub-testids for powershell tool', () => {
        render(
            <ToolResultPopover
                result="output"
                toolName="powershell"
                args={{ command: 'Get-Process' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        expect(document.querySelector('[data-testid="popover-markdown"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-code"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-terminal"]')).toBeTruthy();
    });
});

// --- glob tool: file list preview ---

describe('ToolResultPopover — glob tool', () => {
    it('renders glob preview with file list', () => {
        render(
            <ToolResultPopover
                result={"/project/src/index.ts\n/project/src/utils.ts\n/project/src/app.ts"}
                toolName="glob"
                args={{ pattern: '**/*.ts', path: '/project' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Glob Matches');
        expect(popover!.textContent).toContain('3 files');

        const globEl = document.querySelector('[data-testid="popover-glob"]');
        expect(globEl).toBeTruthy();
        expect(globEl!.textContent).toContain('src/index.ts');
        expect(globEl!.textContent).toContain('src/utils.ts');
        expect(globEl!.textContent).toContain('src/app.ts');
    });

    it('renders relative paths when basePath is provided', () => {
        render(
            <ToolResultPopover
                result={"/workspace/foo/bar.ts\n/workspace/foo/baz.ts"}
                toolName="glob"
                args={{ pattern: '*.ts', path: '/workspace/foo' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const globEl = document.querySelector('[data-testid="popover-glob"]');
        expect(globEl).toBeTruthy();
        expect(globEl!.textContent).toContain('bar.ts');
        expect(globEl!.textContent).toContain('baz.ts');
        expect(globEl!.textContent).not.toContain('/workspace/foo');
    });

    it('shows "No matches found" for empty glob result', () => {
        render(
            <ToolResultPopover
                result=""
                toolName="glob"
                args={{ pattern: '**/*.xyz' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const globEl = document.querySelector('[data-testid="popover-glob"]');
        expect(globEl).toBeTruthy();
        expect(globEl!.textContent).toContain('No matches found');
    });

    it('handles Windows-style paths in glob results', () => {
        render(
            <ToolResultPopover
                result={"D:\\project\\src\\index.ts\nD:\\project\\src\\utils.ts"}
                toolName="glob"
                args={{ pattern: '**/*.ts', path: 'D:\\project' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const globEl = document.querySelector('[data-testid="popover-glob"]');
        expect(globEl).toBeTruthy();
        expect(globEl!.textContent).toContain('src/index.ts');
    });

    it('does not render other sub-testids for glob tool', () => {
        render(
            <ToolResultPopover
                result="/project/file.ts"
                toolName="glob"
                args={{ pattern: '*.ts' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        expect(document.querySelector('[data-testid="popover-markdown"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-code"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-terminal"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-grep"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-glob"]')).toBeTruthy();
    });
});

// --- grep tool: grouped match list preview ---

describe('ToolResultPopover — grep tool', () => {
    it('renders grep preview grouped by file', () => {
        render(
            <ToolResultPopover
                result={"src/foo.ts:12:export function doThing() {\nsrc/foo.ts:20:  return doThing;\nsrc/bar.ts:45:    doThing();"}
                toolName="grep"
                args={{ pattern: 'doThing' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Grep Matches');
        expect(popover!.textContent).toContain('3 matches in 2 files');

        const grepEl = document.querySelector('[data-testid="popover-grep"]');
        expect(grepEl).toBeTruthy();
        expect(grepEl!.textContent).toContain('src/foo.ts');
        expect(grepEl!.textContent).toContain('src/bar.ts');
        expect(grepEl!.textContent).toContain('12');
        expect(grepEl!.textContent).toContain('export function doThing() {');
    });

    it('highlights matched pattern in grep results', () => {
        const { container } = render(
            <ToolResultPopover
                result="src/foo.ts:12:hello world"
                toolName="grep"
                args={{ pattern: 'hello' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const grepEl = document.querySelector('[data-testid="popover-grep"]');
        expect(grepEl).toBeTruthy();
        // The matched text should be wrapped in a highlight span
        const highlights = grepEl!.querySelectorAll('.bg-\\[\\#fff3cd\\]');
        expect(highlights.length).toBeGreaterThan(0);
        expect(highlights[0].textContent).toBe('hello');
    });

    it('shows "No matches found" for empty grep result', () => {
        render(
            <ToolResultPopover
                result=""
                toolName="grep"
                args={{ pattern: 'nonexistent' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const grepEl = document.querySelector('[data-testid="popover-grep"]');
        expect(grepEl).toBeTruthy();
        expect(grepEl!.textContent).toContain('No matches found');
    });

    it('handles Windows paths with drive letters in grep results', () => {
        render(
            <ToolResultPopover
                result={"C:\\project\\src\\foo.ts:12:some content"}
                toolName="grep"
                args={{ pattern: 'content' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const grepEl = document.querySelector('[data-testid="popover-grep"]');
        expect(grepEl).toBeTruthy();
        expect(grepEl!.textContent).toContain('C:\\project\\src\\foo.ts');
        expect(grepEl!.textContent).toContain('12');
        expect(grepEl!.textContent).toContain('some content');
    });

    it('handles files_with_matches mode (file paths only)', () => {
        render(
            <ToolResultPopover
                result={"src/foo.ts\nsrc/bar.ts"}
                toolName="grep"
                args={{ pattern: 'something' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const grepEl = document.querySelector('[data-testid="popover-grep"]');
        expect(grepEl).toBeTruthy();
        expect(grepEl!.textContent).toContain('src/foo.ts');
        expect(grepEl!.textContent).toContain('src/bar.ts');
    });

    it('gracefully handles invalid regex pattern', () => {
        render(
            <ToolResultPopover
                result="src/foo.ts:12:some (unclosed"
                toolName="grep"
                args={{ pattern: '(unclosed' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const grepEl = document.querySelector('[data-testid="popover-grep"]');
        expect(grepEl).toBeTruthy();
        expect(grepEl!.textContent).toContain('some (unclosed');
    });

    it('does not render other sub-testids for grep tool', () => {
        render(
            <ToolResultPopover
                result="src/foo.ts:1:line"
                toolName="grep"
                args={{ pattern: 'line' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        expect(document.querySelector('[data-testid="popover-markdown"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-code"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-terminal"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-glob"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-grep"]')).toBeTruthy();
    });
});

// --- create tool: file content preview ---

describe('ToolResultPopover — create tool', () => {
    it('renders create preview with file content', () => {
        render(
            <ToolResultPopover
                result="File created successfully"
                toolName="create"
                args={{ path: '/project/src/new-file.ts', file_text: 'export const x = 1;\nexport const y = 2;' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Created File');
        expect(popover!.textContent).not.toContain('Result Preview');

        const createEl = document.querySelector('[data-testid="popover-create"]');
        expect(createEl).toBeTruthy();
        expect(createEl!.textContent).toContain('export const x = 1;');
        expect(createEl!.textContent).toContain('export const y = 2;');
    });

    it('renders file path in create popover', () => {
        render(
            <ToolResultPopover
                result="File created"
                toolName="create"
                args={{ path: '/project/src/utils.ts', file_text: 'const a = 1;' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const createEl = document.querySelector('[data-testid="popover-create"]');
        expect(createEl).toBeTruthy();
        expect(createEl!.textContent).toContain('utils.ts');
    });

    it('shows "No preview available" when file_text is missing', () => {
        render(
            <ToolResultPopover
                result="File created"
                toolName="create"
                args={{ path: '/project/src/binary.bin' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const createEl = document.querySelector('[data-testid="popover-create"]');
        expect(createEl).toBeTruthy();
        expect(createEl!.textContent).toContain('No preview available');
    });

    it('shows "No preview available" when file_text is empty string', () => {
        render(
            <ToolResultPopover
                result="File created"
                toolName="create"
                args={{ path: '/project/src/empty.ts', file_text: '' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const createEl = document.querySelector('[data-testid="popover-create"]');
        expect(createEl).toBeTruthy();
        expect(createEl!.textContent).toContain('No preview available');
    });

    it('truncates long file_text in create popover', () => {
        const longContent = 'x'.repeat(2500);
        render(
            <ToolResultPopover
                result="File created"
                toolName="create"
                args={{ path: '/project/src/big.ts', file_text: longContent }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const createEl = document.querySelector('[data-testid="popover-create"]');
        expect(createEl).toBeTruthy();
        expect(createEl!.textContent).toContain('… (truncated — click to see full)');
    });

    it('does not render other sub-testids for create tool', () => {
        render(
            <ToolResultPopover
                result="File created"
                toolName="create"
                args={{ path: '/project/src/file.ts', file_text: 'content' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        expect(document.querySelector('[data-testid="popover-markdown"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-code"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-terminal"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-glob"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-grep"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-create"]')).toBeTruthy();
    });

    it('uses filePath arg as fallback', () => {
        render(
            <ToolResultPopover
                result="File created"
                toolName="create"
                args={{ filePath: '/project/src/alt.ts', file_text: 'const z = 3;' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const createEl = document.querySelector('[data-testid="popover-create"]');
        expect(createEl).toBeTruthy();
        expect(createEl!.textContent).toContain('alt.ts');
        expect(createEl!.textContent).toContain('const z = 3;');
    });
});

describe('ToolResultPopover — edit tool', () => {
    it('renders edit preview label for edit tool', () => {
        render(
            <ToolResultPopover
                result="File updated"
                toolName="edit"
                args={{ path: '/project/src/utils.ts', old_str: 'const a = 1;', new_str: 'const b = 2;' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Edit Preview');
        expect(popover!.textContent).not.toContain('Result Preview');
    });

    it('renders diff lines with added and removed classes', () => {
        render(
            <ToolResultPopover
                result="File updated"
                toolName="edit"
                args={{ path: '/project/src/foo.ts', old_str: 'const x = 1;', new_str: 'const x = 2;' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const editEl = document.querySelector('[data-testid="popover-edit"]');
        expect(editEl).toBeTruthy();
        const removedLines = editEl!.querySelectorAll('.diff-line-removed');
        const addedLines = editEl!.querySelectorAll('.diff-line-added');
        expect(removedLines.length).toBeGreaterThan(0);
        expect(addedLines.length).toBeGreaterThan(0);
        expect(removedLines[0].textContent).toContain('const x = 1;');
        expect(addedLines[0].textContent).toContain('const x = 2;');
    });

    it('renders file path in edit popover', () => {
        render(
            <ToolResultPopover
                result="File updated"
                toolName="edit"
                args={{ path: '/project/src/config.ts', old_str: 'a', new_str: 'b' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const editEl = document.querySelector('[data-testid="popover-edit"]');
        expect(editEl).toBeTruthy();
        expect(editEl!.textContent).toContain('config.ts');
    });

    it('shows "No preview available" when old_str and new_str are missing', () => {
        render(
            <ToolResultPopover
                result="File updated"
                toolName="edit"
                args={{ path: '/project/src/foo.ts' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const editEl = document.querySelector('[data-testid="popover-edit"]');
        expect(editEl).toBeTruthy();
        expect(editEl!.textContent).toContain('No preview available');
    });

    it('supports old_string/new_string alternate arg names', () => {
        render(
            <ToolResultPopover
                result="File updated"
                toolName="edit"
                args={{ path: '/project/src/foo.ts', old_string: 'x', new_string: 'y' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const editEl = document.querySelector('[data-testid="popover-edit"]');
        expect(editEl).toBeTruthy();
        const removedLines = editEl!.querySelectorAll('.diff-line-removed');
        const addedLines = editEl!.querySelectorAll('.diff-line-added');
        expect(removedLines.length).toBeGreaterThan(0);
        expect(addedLines.length).toBeGreaterThan(0);
    });

    it('does not render other sub-testids for edit tool', () => {
        render(
            <ToolResultPopover
                result="File updated"
                toolName="edit"
                args={{ path: '/project/src/file.ts', old_str: 'a', new_str: 'b' }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        expect(document.querySelector('[data-testid="popover-markdown"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-code"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-terminal"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-glob"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-grep"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-create"]')).toBeNull();
        expect(document.querySelector('[data-testid="popover-edit"]')).toBeTruthy();
    });

    it('renders context lines for multi-line diffs', () => {
        render(
            <ToolResultPopover
                result="File updated"
                toolName="edit"
                args={{
                    path: '/project/src/handler.ts',
                    old_str: 'if (type !== \'chat\') continue;\nreturn result;',
                    new_str: 'if (type !== \'chat\' && type !== \'readonly\') continue;\nreturn result;',
                }}
                anchorRect={makeAnchorRect()}
                {...defaultHandlers}
            />
        );

        const editEl = document.querySelector('[data-testid="popover-edit"]');
        expect(editEl).toBeTruthy();
        const contextLines = editEl!.querySelectorAll('.diff-line-context');
        expect(contextLines.length).toBeGreaterThan(0);
        expect(contextLines[0].textContent).toContain('return result;');
    });
});
