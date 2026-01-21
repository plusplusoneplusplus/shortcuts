/**
 * Tree item for interactive CLI sessions
 *
 * Represents an interactive AI CLI session in the tree view.
 */

import * as vscode from 'vscode';
import { InteractiveSession, InteractiveSessionStatus, TerminalType } from './types';

/**
 * Tree item representing an interactive CLI session
 */
export class InteractiveSessionItem extends vscode.TreeItem {
    public readonly contextValue: string;
    public readonly session: InteractiveSession;

    constructor(session: InteractiveSession) {
        // Create label from tool and working directory
        const dirName = session.workingDirectory.split(/[\\/]/).pop() || session.workingDirectory;
        const label = session.initialPrompt
            ? `${session.initialPrompt.substring(0, 40)}${session.initialPrompt.length > 40 ? '...' : ''}`
            : `${session.tool} session`;

        super(label, vscode.TreeItemCollapsibleState.None);

        this.session = session;
        this.contextValue = `interactiveSession_${session.status}`;

        // Set description based on status
        this.description = this.getStatusDescription(session);

        // Set icon based on status
        this.iconPath = this.getStatusIcon(session);

        // Set tooltip with full details
        this.tooltip = this.createTooltip(session);

        // Add click command to focus the window (Windows only, active sessions with PID)
        if (this.canFocusWindow(session)) {
            this.command = {
                command: 'interactiveSessions.focus',
                title: 'Focus Session Window',
                arguments: [this]
            };
        }
    }

    /**
     * Check if this session's window can be focused
     * Only supported on Windows with cmd/PowerShell terminals
     */
    private canFocusWindow(session: InteractiveSession): boolean {
        // Only on Windows
        if (process.platform !== 'win32') {
            return false;
        }

        // Must have a PID
        if (!session.pid) {
            return false;
        }

        // Must be active or starting
        if (session.status !== 'active' && session.status !== 'starting') {
            return false;
        }

        // Only cmd and PowerShell support PID-based focusing
        // Windows Terminal uses a single process for all tabs
        return session.terminalType === 'cmd' || session.terminalType === 'powershell';
    }

    /**
     * Get status description (elapsed time for active, duration for ended)
     */
    private getStatusDescription(session: InteractiveSession): string {
        const toolLabel = session.tool === 'copilot' ? 'Copilot' : 'Claude';

        if (session.status === 'active' || session.status === 'starting') {
            const elapsed = this.formatDuration(Date.now() - session.startTime.getTime());
            return `${toolLabel} · ${session.status} (${elapsed})`;
        }

        if (session.endTime) {
            const duration = this.formatDuration(session.endTime.getTime() - session.startTime.getTime());
            return `${toolLabel} · ${session.status} (${duration})`;
        }

        return `${toolLabel} · ${session.status}`;
    }

    /**
     * Get icon based on status
     */
    private getStatusIcon(session: InteractiveSession): vscode.ThemeIcon {
        switch (session.status) {
            case 'starting':
                return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.blue'));
            case 'active':
                return new vscode.ThemeIcon('terminal', new vscode.ThemeColor('charts.green'));
            case 'ended':
                return new vscode.ThemeIcon('terminal', new vscode.ThemeColor('disabledForeground'));
            case 'error':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
            default:
                return new vscode.ThemeIcon('terminal');
        }
    }

    /**
     * Create detailed tooltip
     */
    private createTooltip(session: InteractiveSession): vscode.MarkdownString {
        const lines: string[] = [];

        // Header
        lines.push('🖥️ **Interactive CLI Session**');
        lines.push('');

        // Tool
        const toolLabel = session.tool === 'copilot' ? 'GitHub Copilot CLI' : 'Claude CLI';
        lines.push(`**Tool:** ${toolLabel}`);

        // Terminal type
        lines.push(`**Terminal:** ${this.formatTerminalType(session.terminalType)}`);

        // Status
        const statusEmoji = this.getStatusEmoji(session.status);
        lines.push(`**Status:** ${statusEmoji} ${session.status}`);
        lines.push('');

        // Working directory
        lines.push(`**Working Directory:**`);
        lines.push(`\`${session.workingDirectory}\``);
        lines.push('');

        // Initial prompt if any
        if (session.initialPrompt) {
            lines.push('**Initial Prompt:**');
            lines.push(`> ${session.initialPrompt}`);
            lines.push('');
        }

        // Timing
        lines.push(`**Started:** ${session.startTime.toLocaleString()}`);
        if (session.endTime) {
            lines.push(`**Ended:** ${session.endTime.toLocaleString()}`);
            const duration = this.formatDuration(session.endTime.getTime() - session.startTime.getTime());
            lines.push(`**Duration:** ${duration}`);
        } else {
            const elapsed = this.formatDuration(Date.now() - session.startTime.getTime());
            lines.push(`**Elapsed:** ${elapsed}`);
        }

        // PID if available
        if (session.pid) {
            lines.push(`**PID:** ${session.pid}`);
        }

        // Error if any
        if (session.error) {
            lines.push('');
            lines.push(`**Error:** ${session.error}`);
        }

        const tooltip = new vscode.MarkdownString(lines.join('\n'));
        tooltip.supportHtml = true;
        return tooltip;
    }

    /**
     * Format terminal type for display
     */
    private formatTerminalType(terminalType: string): string {
        const names: Record<string, string> = {
            'terminal.app': 'Terminal.app',
            'iterm': 'iTerm2',
            'windows-terminal': 'Windows Terminal',
            'cmd': 'Command Prompt',
            'powershell': 'PowerShell',
            'gnome-terminal': 'GNOME Terminal',
            'konsole': 'Konsole',
            'xfce4-terminal': 'Xfce Terminal',
            'xterm': 'xterm',
            'unknown': 'Unknown'
        };
        return names[terminalType] || terminalType;
    }

    /**
     * Get emoji for status
     */
    private getStatusEmoji(status: InteractiveSessionStatus): string {
        switch (status) {
            case 'starting': return '🔄';
            case 'active': return '🟢';
            case 'ended': return '⚪';
            case 'error': return '❌';
            default: return '○';
        }
    }

    /**
     * Format duration in human readable format
     */
    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        }
        return `${seconds}s`;
    }
}

/**
 * Section header item for "Interactive Sessions" group
 */
export class InteractiveSessionSectionItem extends vscode.TreeItem {
    public readonly contextValue = 'interactiveSessionSection';

    constructor(activeCount: number) {
        const label = activeCount > 0
            ? `Interactive Sessions (${activeCount} active)`
            : 'Interactive Sessions';

        super(label, vscode.TreeItemCollapsibleState.Expanded);

        this.iconPath = new vscode.ThemeIcon('terminal-view-icon');
        this.description = '';

        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown('**Interactive CLI Sessions**\n\n');
        tooltip.appendMarkdown('Sessions running in external terminal windows.\n\n');
        tooltip.appendMarkdown('These sessions allow interactive conversations with AI CLI tools.');
        this.tooltip = tooltip;
    }
}
