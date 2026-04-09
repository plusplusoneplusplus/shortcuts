/**
 * Tests for TerminalView component source structure.
 * Uses the source-inspection pattern (reads .tsx source and asserts
 * structural contracts via string matching).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'TerminalView.tsx'
);

describe('TerminalView', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports TerminalViewProps interface', () => {
            expect(source).toContain('export interface TerminalViewProps');
        });

        it('exports TerminalView as a named export', () => {
            expect(source).toContain('export function TerminalView');
        });
    });

    describe('props', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });
    });

    describe('state management', () => {
        it('manages terminal tabs state', () => {
            expect(source).toContain('useState<TerminalTab[]>');
        });

        it('manages activeId state', () => {
            expect(source).toContain('activeId');
            expect(source).toContain('setActiveId');
        });

        it('does not auto-create a terminal on mount', () => {
            // No useEffect auto-creates terminals; the component starts with an empty list
            expect(source).not.toMatch(/useEffect\([^)]*terminals\.length === 0/s);
        });
    });

    describe('terminal management', () => {
        it('createTerminal generates UUID', () => {
            expect(source).toContain('crypto.randomUUID()');
        });

        it('createTerminal increments counter for default title', () => {
            expect(source).toContain('counterRef');
            expect(source).toContain('Terminal ${');
        });

        it('closeTerminal removes tab from list', () => {
            expect(source).toContain('filter');
        });

        it('closeTerminal switches active tab when closing active', () => {
            // When closing the active tab, it reassigns activeId to the last remaining tab
            expect(source).toContain('id === activeId');
            expect(source).toContain('next.length === 0');
        });

        it('closeTerminal clears activeId when last terminal is closed', () => {
            expect(source).toContain("setActiveId('')");
        });
    });

    describe('rendering', () => {
        it('renders TerminalPanel for each tab', () => {
            expect(source).toContain('<TerminalPanel');
        });

        it('uses display:none pattern for tab switching', () => {
            expect(source).toContain('display:');
            expect(source).toContain("activeId ? undefined : 'none'");
        });

        it('passes isActive prop to TerminalPanel', () => {
            expect(source).toContain('isActive={');
        });

        it('has new terminal button', () => {
            expect(source).toContain('terminal-new-btn');
        });

        it('has close button per tab', () => {
            expect(source).toContain('terminal-tab-close');
        });

        it('has data-testid terminal-view', () => {
            expect(source).toContain('data-testid="terminal-view"');
        });

        it('renders empty state when no terminals exist', () => {
            expect(source).toContain('data-testid="terminal-empty-state"');
            expect(source).toContain('No terminals open');
            expect(source).toContain('Click + to create a terminal');
        });
    });

    describe('exit handling', () => {
        it('handles onExit to mark tab as exited', () => {
            expect(source).toContain('exited');
        });

        it('handles onTitleChange', () => {
            expect(source).toContain('onTitleChange');
        });
    });
});
