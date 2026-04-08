/**
 * Tests for TerminalPanel component source structure.
 * Uses the source-inspection pattern (reads .tsx source and asserts
 * structural contracts via string matching).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'TerminalPanel.tsx'
);

describe('TerminalPanel', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports TerminalPanelProps interface', () => {
            expect(source).toContain('export interface TerminalPanelProps');
        });

        it('exports TerminalPanel as a named export', () => {
            expect(source).toContain('export function TerminalPanel');
        });
    });

    describe('props', () => {
        it('accepts required props: sessionId, workspaceId, isActive', () => {
            expect(source).toContain('sessionId: string');
            expect(source).toContain('workspaceId: string');
            expect(source).toContain('isActive: boolean');
        });

        it('accepts optional onExit callback', () => {
            expect(source).toContain('onExit');
        });

        it('accepts optional onTitleChange callback', () => {
            expect(source).toContain('onTitleChange');
        });
    });

    describe('xterm.js integration', () => {
        it('imports xterm Terminal', () => {
            expect(source).toContain("from '@xterm/xterm'");
        });

        it('imports FitAddon', () => {
            expect(source).toContain('@xterm/addon-fit');
        });

        it('imports WebLinksAddon', () => {
            expect(source).toContain('@xterm/addon-web-links');
        });

        it('imports xterm CSS', () => {
            expect(source).toMatch(/import ['"]@xterm\/xterm\/css\/xterm\.css['"]/);
        });
    });

    describe('hooks and state', () => {
        it('uses useTerminalWebSocket hook', () => {
            expect(source).toContain('useTerminalWebSocket');
        });
    });

    describe('theme handling', () => {
        it('defines dark and light xterm themes', () => {
            expect(source).toContain('DARK_THEME');
            expect(source).toContain('LIGHT_THEME');
        });

        it('uses detectDarkMode for theme detection', () => {
            expect(source).toContain('detectDarkMode');
        });

        it('uses MutationObserver for theme changes', () => {
            expect(source).toContain('MutationObserver');
        });
    });

    describe('resize handling', () => {
        it('uses ResizeObserver for container resize', () => {
            expect(source).toContain('ResizeObserver');
        });

        it('calls fitAddon.fit()', () => {
            expect(source).toContain('fitAddon.fit()');
        });

        it('sends resize on fit', () => {
            expect(source).toContain('sendResize');
        });
    });

    describe('message handling', () => {
        it('handles terminal-created message', () => {
            expect(source).toContain('terminal-created');
        });

        it('handles terminal-output message', () => {
            expect(source).toContain('terminal-output');
        });

        it('handles terminal-exit message', () => {
            expect(source).toContain('terminal-exit');
        });

        it('reads exitCode from terminal-exit (not code)', () => {
            expect(source).toContain('msg.exitCode');
            expect(source).not.toContain('msg.code');
        });

        it('handles terminal-error message', () => {
            expect(source).toContain('terminal-error');
        });

        it('calls onExit callback', () => {
            expect(source).toContain('onExit');
        });
    });

    describe('lifecycle', () => {
        it('disposes terminal on unmount', () => {
            expect(source).toContain('term.dispose()');
        });

        it('has data-testid attribute', () => {
            expect(source).toContain('data-testid');
        });

        it('re-fits when isActive becomes true', () => {
            expect(source).toContain('isActive');
            // isActive used in a useEffect conditional
            expect(source).toMatch(/if\s*\(isActive/);
        });
    });
});
