/**
 * ScriptTerminalBlock — renders run-script turn output as a dark terminal
 * window matching the conversation redesign:
 *
 *   ┌──────────────────────────────────────────┐
 *   │ • • •  npm test -- ConversationArea      │   <- term-bar (#2d2d2d)
 *   ├──────────────────────────────────────────┤
 *   │ PASS  test/...                           │   <- pre body (#1e1e1e fg #d4d4d4)
 *   │ Test Suites: 3 passed, 3 total           │
 *   │ Tests:       42 passed, 42 total         │
 *   └──────────────────────────────────────────┘
 *
 * Tokens map directly to the design CSS variables:
 *   --term-bg     = #1e1e1e
 *   --term-fg     = #d4d4d4
 *   --term-muted  = #858585
 *   --term-pass   = #4ec9b0
 */

import React from 'react';
import { cn } from '../../../ui';
import type { ParsedScriptOutput } from './scriptOutputParser';

interface ScriptTerminalBlockProps {
    parsed: ParsedScriptOutput;
    /**
     * Falls back to the raw turn body when the parser did not find any
     * stdout/stderr (e.g. legacy/unrecognised content). Optional — when
     * omitted the block renders an empty placeholder line.
     */
    fallback?: string;
}

/**
 * Lightweight syntax highlighting for common terminal output cues:
 *  - Standalone PASS / OK tokens become green (`--term-pass`).
 *  - FAIL / ERROR / FAILED tokens become red.
 *  - Lines that look like Jest summary headers (`Test Suites:`, `Tests:`,
 *    `Time:`, `Snapshots:`) get a muted label color on the leading word.
 *
 * Returns React nodes (one per line + line breaks) so consumers can render
 * inside a single `<pre>` element while preserving whitespace.
 */
export function highlightTerminalLine(line: string, lineKey: string): React.ReactNode {
    const segments: React.ReactNode[] = [];

    // Jest-style summary prefix: `Word:` followed by spaces.
    const summaryMatch = /^(Test Suites|Tests|Snapshots|Time|Ran all test suites):/i.exec(line);
    if (summaryMatch) {
        const head = `${summaryMatch[1]}:`;
        const rest = line.slice(head.length);
        segments.push(
            <span key={`${lineKey}-h`} className="text-[#858585]">{head}</span>,
            rest,
        );
        return segments;
    }

    // Token-level highlighting: split on whitespace boundaries while
    // preserving the original spacing.
    const tokenRe = /(\s+|\S+)/g;
    let match: RegExpExecArray | null;
    let i = 0;
    while ((match = tokenRe.exec(line)) !== null) {
        const token = match[0];
        if (/^\s+$/.test(token)) {
            segments.push(token);
            continue;
        }
        const upper = token.toUpperCase();
        if (upper === 'PASS' || upper === 'OK' || upper === '✓') {
            segments.push(
                <span key={`${lineKey}-${i}`} className="font-semibold text-[#4ec9b0]">{token}</span>,
            );
        } else if (upper === 'FAIL' || upper === 'FAILED' || upper === 'ERROR' || upper === '✗') {
            segments.push(
                <span key={`${lineKey}-${i}`} className="font-semibold text-[#f48771]">{token}</span>,
            );
        } else {
            segments.push(token);
        }
        i++;
    }
    return segments;
}

function renderBody(text: string, prefix: 'out' | 'err'): React.ReactNode {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    return lines.map((line, idx) => (
        <React.Fragment key={`${prefix}-${idx}`}>
            {highlightTerminalLine(line, `${prefix}-${idx}`)}
            {idx < lines.length - 1 ? '\n' : null}
        </React.Fragment>
    ));
}

export function ScriptTerminalBlock({ parsed, fallback }: ScriptTerminalBlockProps) {
    const labelText = parsed.script
        ?? (fallback ? '' : 'shell');
    const stdoutText = parsed.stdout ?? '';
    const stderrText = parsed.stderr ?? '';
    const hasStdout = stdoutText.length > 0;
    const hasStderr = stderrText.length > 0;
    const usingFallback = !hasStdout && !hasStderr && !!fallback;

    return (
        <div
            data-testid="script-terminal-block"
            className={cn(
                'script-terminal',
                'rounded-md overflow-hidden',
                'bg-[#1e1e1e] text-[#d4d4d4]',
                'border border-black',
            )}
        >
            <div
                className={cn(
                    'term-bar flex items-center gap-1.5 px-2.5 py-1.5',
                    'bg-[#2d2d2d] border-b border-black',
                    'font-mono text-[11px] text-[#cccccc]',
                )}
            >
                <span
                    className="dots inline-flex gap-1.5 mr-1.5"
                    aria-hidden="true"
                >
                    <span className="inline-block w-[9px] h-[9px] rounded-full bg-[#3c3c3c]" />
                    <span className="inline-block w-[9px] h-[9px] rounded-full bg-[#3c3c3c]" />
                    <span className="inline-block w-[9px] h-[9px] rounded-full bg-[#3c3c3c]" />
                </span>
                <span
                    className="label font-mono text-[11px] text-[#858585] truncate"
                    title={labelText || undefined}
                    data-testid="script-terminal-label"
                >
                    {labelText}
                </span>
                {parsed.workingDirectory && (
                    <span
                        className="ml-auto font-mono text-[10.5px] text-[#858585] truncate max-w-[40%]"
                        title={parsed.workingDirectory}
                        data-testid="script-terminal-cwd"
                    >
                        {parsed.workingDirectory}
                    </span>
                )}
            </div>
            <pre
                className={cn(
                    'm-0 px-3 py-2.5',
                    'font-mono text-[11.5px] leading-[1.55]',
                    'text-[#d4d4d4] bg-transparent',
                    'overflow-x-auto whitespace-pre',
                )}
                data-testid="script-terminal-pre"
            >
                {usingFallback ? renderBody(fallback!, 'out') : null}
                {hasStdout && renderBody(stdoutText, 'out')}
                {hasStdout && hasStderr && '\n'}
                {hasStderr && (
                    <>
                        <span className="block text-[#858585]" data-testid="script-terminal-stderr-header">
                            stderr:
                        </span>
                        <span className="text-[#f48771]" data-testid="script-terminal-stderr">
                            {renderBody(stderrText, 'err')}
                        </span>
                    </>
                )}
                {!usingFallback && !hasStdout && !hasStderr && (
                    <span className="text-[#858585] italic" data-testid="script-terminal-empty">
                        (no output)
                    </span>
                )}
            </pre>
        </div>
    );
}
