/**
 * The Dev Tools registry — the ordered list of cards the panel renders.
 *
 * The first entry is expanded by default when the dialog opens. Everything here
 * is client-side only: no fetch, no server routes.
 */

import type { DevTool } from './types';
import { ProgrammerCalculatorCard } from './ProgrammerCalculatorCard';

export const DEV_TOOLS: readonly DevTool[] = [
    {
        id: 'calculator',
        name: 'Programmer calculator',
        description: 'Evaluate C-style integer expressions with DEC / HEX / OCT / BIN readouts',
        keywords: ['calc', 'calculator', 'hex', 'binary', 'octal', 'bitwise', 'shift', 'bits'],
        component: ProgrammerCalculatorCard,
    },
];

/** The tool expanded when the dialog first mounts. */
export const DEFAULT_EXPANDED_TOOL_ID = DEV_TOOLS[0]?.id ?? '';
