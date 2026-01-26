/**
 * Terminal Types (Pure Node.js)
 * 
 * Types for terminal detection and external terminal launching.
 * These types are VS Code-free and can be used in CLI tools.
 */

import { InteractiveToolType } from '../ai/types';

/**
 * Supported terminal types across platforms
 */
export type TerminalType =
    // macOS
    | 'terminal.app'
    | 'iterm'
    // Windows
    | 'windows-terminal'
    | 'cmd'
    | 'powershell'
    // Linux
    | 'gnome-terminal'
    | 'konsole'
    | 'xfce4-terminal'
    | 'xterm'
    // Generic
    | 'unknown';

/**
 * Status of an interactive session
 */
export type InteractiveSessionStatus = 'starting' | 'active' | 'ended' | 'error';

/**
 * An interactive CLI session running in an external terminal.
 * This is a pure data type without VS Code dependencies.
 */
export interface InteractiveSession {
    /** Unique session identifier */
    id: string;
    /** When the session was started */
    startTime: Date;
    /** When the session ended (if ended) */
    endTime?: Date;
    /** Current session status */
    status: InteractiveSessionStatus;
    /** Working directory for the session */
    workingDirectory: string;
    /** CLI tool being used */
    tool: InteractiveToolType;
    /** Initial prompt sent to the CLI (if any) */
    initialPrompt?: string;
    /** Type of terminal used */
    terminalType: TerminalType;
    /** Process ID of the terminal (if available) */
    pid?: number;
    /** Error message if status is 'error' */
    error?: string;
    /** Custom name for the session (user-defined) */
    customName?: string;
}

/**
 * Options for launching an external terminal
 */
export interface ExternalTerminalLaunchOptions {
    /** Working directory for the terminal */
    workingDirectory: string;
    /** CLI tool to launch */
    tool: InteractiveToolType;
    /** Initial prompt to send (optional) */
    initialPrompt?: string;
    /** Preferred terminal type (optional, auto-detected if not specified) */
    preferredTerminal?: TerminalType;
    /** Model to use (optional, uses default if not specified) */
    model?: string;
    /** Session ID to resume (for session resume functionality) */
    resumeSessionId?: string;
}

/**
 * Result of launching an external terminal
 */
export interface ExternalTerminalLaunchResult {
    /** Whether the launch was successful */
    success: boolean;
    /** Type of terminal that was launched */
    terminalType: TerminalType;
    /** Process ID of the launched terminal (if available) */
    pid?: number;
    /** Error message if launch failed */
    error?: string;
}

/**
 * Result of a window focus operation
 */
export interface WindowFocusResult {
    /** Whether the focus operation was successful */
    success: boolean;
    /** Error message if the operation failed */
    error?: string;
}
