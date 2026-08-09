/**
 * The Dev Tools registry — the ordered list of cards the panel renders.
 *
 * The first entry is expanded by default when the dialog opens. Everything here
 * is client-side only: no fetch, no server routes.
 */

import type { DevTool } from './types';
import { ProgrammerCalculatorCard } from './ProgrammerCalculatorCard';
import { BaseConverterCard } from './BaseConverterCard';
import { EncodersCard } from './EncodersCard';
import { TimestampCard } from './TimestampCard';
import { ByteSizeCard } from './ByteSizeCard';

export const DEV_TOOLS: readonly DevTool[] = [
    {
        id: 'calculator',
        name: 'Programmer calculator',
        description: 'Evaluate C-style integer expressions with DEC / HEX / OCT / BIN readouts',
        keywords: ['calc', 'calculator', 'hex', 'binary', 'octal', 'bitwise', 'shift', 'bits'],
        component: ProgrammerCalculatorCard,
    },
    {
        id: 'base-converter',
        name: 'Base converter',
        description: 'Convert an integer between any two bases from 2 to 36',
        keywords: ['base', 'radix', 'hex', 'binary', 'octal', 'base36', 'convert'],
        component: BaseConverterCard,
    },
    {
        id: 'encoders',
        name: 'Encoders / decoders',
        description: 'Base64, URL component and HTML entity encode and decode',
        keywords: ['base64', 'b64', 'url', 'uri', 'percent', 'html', 'entity', 'escape', 'encode', 'decode'],
        component: EncodersCard,
    },
    {
        id: 'timestamp',
        name: 'Timestamp converter',
        description: 'Epoch seconds or milliseconds ↔ ISO 8601 ↔ local time',
        keywords: ['time', 'timestamp', 'epoch', 'unix', 'iso', 'date', 'clock'],
        component: TimestampCard,
    },
    {
        id: 'byte-size',
        name: 'Byte size converter',
        description: 'Bytes in decimal (KB/MB/GB) and binary (KiB/MiB/GiB) units side by side',
        keywords: ['byte', 'size', 'kb', 'mb', 'gb', 'kib', 'mib', 'gib', 'storage'],
        component: ByteSizeCard,
    },
];

/** The tool expanded when the dialog first mounts. */
export const DEFAULT_EXPANDED_TOOL_ID = DEV_TOOLS[0]?.id ?? '';
