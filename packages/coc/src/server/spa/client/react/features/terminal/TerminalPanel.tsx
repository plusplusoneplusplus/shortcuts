/**
 * Single-terminal component. Renders one xterm.js Terminal instance,
 * wires it to a useTerminalWebSocket connection, and syncs xterm's
 * color theme with the dashboard's light/dark mode.
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

import { useTerminalWebSocket } from './hooks/useTerminalWebSocket';
import { detectDarkMode } from '../../utils/theme';
import type { ITheme } from '@xterm/xterm';

export interface TerminalPanelProps {
    sessionId: string;
    workspaceId: string;
    isActive: boolean;
    onExit?: (code: number) => void;
    onTitleChange?: (title: string) => void;
}

const DARK_THEME: ITheme = {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    cursorAccent: '#1e1e1e',
    selectionBackground: '#264f78',
    selectionForeground: '#ffffff',
    black: '#1e1e1e',
    red: '#f44747',
    green: '#6a9955',
    yellow: '#d7ba7d',
    blue: '#569cd6',
    magenta: '#c586c0',
    cyan: '#4ec9b0',
    white: '#d4d4d4',
    brightBlack: '#808080',
    brightRed: '#f44747',
    brightGreen: '#6a9955',
    brightYellow: '#d7ba7d',
    brightBlue: '#569cd6',
    brightMagenta: '#c586c0',
    brightCyan: '#4ec9b0',
    brightWhite: '#ffffff',
};

const LIGHT_THEME: ITheme = {
    background: '#ffffff',
    foreground: '#1e1e1e',
    cursor: '#1e1e1e',
    cursorAccent: '#ffffff',
    selectionBackground: '#add6ff',
    selectionForeground: '#000000',
    black: '#1e1e1e',
    red: '#cd3131',
    green: '#008000',
    yellow: '#795e26',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#d4d4d4',
    brightBlack: '#808080',
    brightRed: '#cd3131',
    brightGreen: '#008000',
    brightYellow: '#795e26',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#ffffff',
};

export function TerminalPanel({ sessionId, workspaceId, isActive, onExit, onTitleChange }: TerminalPanelProps) {
    const termRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    const { status, connect, disconnect, sendInput, sendResize } = useTerminalWebSocket({
        onMessage: (msg) => {
            const term = xtermRef.current;
            if (!term) return;

            switch (msg.type) {
                case 'terminal-created':
                    // Session created — hook stores sessionId internally
                    break;
                case 'terminal-output':
                    term.write(msg.data);
                    break;
                case 'terminal-exit':
                    term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
                    onExit?.(msg.exitCode);
                    break;
                case 'terminal-error':
                    term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
                    break;
            }
        },
    });

    // Initialize xterm.js once on mount
    useEffect(() => {
        if (!termRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            theme: detectDarkMode() ? DARK_THEME : LIGHT_THEME,
            allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.open(termRef.current);
        fitAddon.fit();

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        return () => { term.dispose(); };
    }, []);

    // Theme sync — MutationObserver on <html> class changes
    useEffect(() => {
        const term = xtermRef.current;
        if (!term) return;

        const applyTheme = () => {
            term.options.theme = detectDarkMode() ? DARK_THEME : LIGHT_THEME;
        };

        applyTheme();

        const observer = new MutationObserver(applyTheme);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class'],
        });

        return () => observer.disconnect();
    }, []);

    // Connect to WebSocket on mount
    useEffect(() => {
        if (!termRef.current || !fitAddonRef.current) return;
        const fitAddon = fitAddonRef.current;
        fitAddon.fit();
        const { cols, rows } = xtermRef.current!;
        connect(workspaceId, cols, rows);
        return () => disconnect();
    }, [workspaceId]);

    // User input → WebSocket
    useEffect(() => {
        const term = xtermRef.current;
        if (!term) return;

        const disposable = term.onData((data) => {
            sendInput(data);
        });

        return () => disposable.dispose();
    }, [sendInput]);

    // Resize handling — ResizeObserver on container
    useEffect(() => {
        const container = termRef.current;
        const fitAddon = fitAddonRef.current;
        if (!container || !fitAddon) return;

        const observer = new ResizeObserver(() => {
            if (container.offsetParent !== null) {
                fitAddon.fit();
                const term = xtermRef.current;
                if (term) {
                    sendResize(term.cols, term.rows);
                }
            }
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, [sendResize]);

    // Re-fit when isActive becomes true (display:none → visible)
    useEffect(() => {
        if (isActive && fitAddonRef.current && termRef.current) {
            const timer = setTimeout(() => {
                fitAddonRef.current?.fit();
                const term = xtermRef.current;
                if (term) sendResize(term.cols, term.rows);
            }, 50);
            return () => clearTimeout(timer);
        }
    }, [isActive, sendResize]);

    return (
        <div
            ref={termRef}
            className="h-full w-full"
            data-testid={`terminal-panel-${sessionId}`}
        />
    );
}
