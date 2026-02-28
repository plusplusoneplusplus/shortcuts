import type { DAGNodeState } from './types';

export interface NodeColors {
    fill: string;
    border: string;
    text: string;
}

const lightFills: Record<DAGNodeState, string> = {
    waiting: '#f3f3f3',
    running: '#e8f3ff',
    completed: '#e6f4ea',
    failed: '#fde8e8',
    skipped: '#f3f3f3',
    cancelled: '#fef3e2',
};

const lightBorders: Record<DAGNodeState, string> = {
    waiting: '#848484',
    running: '#0078d4',
    completed: '#16825d',
    failed: '#f14c4c',
    skipped: '#545454',
    cancelled: '#e8912d',
};

const darkTexts: Partial<Record<DAGNodeState, string>> = {
    running: '#3794ff',
    completed: '#89d185',
    failed: '#f48771',
    cancelled: '#cca700',
};

export function getNodeColors(state: DAGNodeState, isDark: boolean): NodeColors {
    const fill = lightFills[state];
    const border = lightBorders[state];
    const text = isDark ? (darkTexts[state] ?? border) : border;
    return { fill, border, text };
}

export type EdgeState = 'waiting' | 'active' | 'completed' | 'error';

const edgeColors: Record<EdgeState, { light: string; dark: string }> = {
    waiting: { light: '#848484', dark: '#848484' },
    active: { light: '#0078d4', dark: '#3794ff' },
    completed: { light: '#16825d', dark: '#89d185' },
    error: { light: '#f14c4c', dark: '#f48771' },
};

export function getEdgeColor(state: EdgeState, isDark: boolean): string {
    return isDark ? edgeColors[state].dark : edgeColors[state].light;
}

const nodeIcons: Record<DAGNodeState, string> = {
    waiting: '⏳',
    running: '🔄',
    completed: '✅',
    failed: '❌',
    skipped: '⛔',
    cancelled: '🚫',
};

export function getNodeIcon(state: DAGNodeState): string {
    return nodeIcons[state];
}
