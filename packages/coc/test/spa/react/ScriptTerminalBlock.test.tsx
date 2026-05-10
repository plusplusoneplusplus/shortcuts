/**
 * Tests for ScriptTerminalBlock — verifies the dark-terminal rendering of
 * run-script turn output (matches the conversation redesign).
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
    ScriptTerminalBlock,
    highlightTerminalLine,
} from '../../../src/server/spa/client/react/features/chat/conversation/ScriptTerminalBlock';
import type { ParsedScriptOutput } from '../../../src/server/spa/client/react/features/chat/conversation/scriptOutputParser';

function makeParsed(overrides: Partial<ParsedScriptOutput> = {}): ParsedScriptOutput {
    return {
        recognised: true,
        status: 'success',
        exitCode: 0,
        ...overrides,
    };
}

describe('ScriptTerminalBlock — chrome', () => {
    it('renders the terminal container with the dark palette tokens', () => {
        const { container } = render(
            <ScriptTerminalBlock
                parsed={makeParsed({ script: 'echo hi', stdout: 'hi' })}
            />
        );
        const wrapper = container.querySelector('.script-terminal') as HTMLElement;
        expect(wrapper).toBeTruthy();
        expect(wrapper.className).toContain('bg-[#1e1e1e]');
        expect(wrapper.className).toContain('text-[#d4d4d4]');
    });

    it('renders the term-bar with three macOS-style window dots', () => {
        const { container } = render(
            <ScriptTerminalBlock parsed={makeParsed({ script: 'echo hi', stdout: 'hi' })} />
        );
        const bar = container.querySelector('.term-bar') as HTMLElement;
        expect(bar).toBeTruthy();
        const dots = bar.querySelectorAll('.dots > span');
        expect(dots.length).toBe(3);
        for (const dot of Array.from(dots)) {
            expect((dot as HTMLElement).className).toContain('bg-[#3c3c3c]');
        }
    });

    it('shows the script command as the term-bar label', () => {
        const { getByTestId } = render(
            <ScriptTerminalBlock parsed={makeParsed({ script: 'npm test -- ConversationArea', stdout: 'PASS' })} />
        );
        const label = getByTestId('script-terminal-label');
        expect(label.textContent).toBe('npm test -- ConversationArea');
        expect(label.className).toContain('text-[#858585]');
    });

    it('shows the working directory at the right edge when provided', () => {
        const { getByTestId } = render(
            <ScriptTerminalBlock parsed={makeParsed({ script: 'ls', workingDirectory: '/repo', stdout: 'a\nb' })} />
        );
        expect(getByTestId('script-terminal-cwd').textContent).toBe('/repo');
    });

    it('omits the working-directory chip when not provided', () => {
        const { queryByTestId } = render(
            <ScriptTerminalBlock parsed={makeParsed({ script: 'ls', stdout: 'a' })} />
        );
        expect(queryByTestId('script-terminal-cwd')).toBeNull();
    });
});

describe('ScriptTerminalBlock — body', () => {
    it('renders captured stdout inside a <pre> element', () => {
        const { getByTestId } = render(
            <ScriptTerminalBlock parsed={makeParsed({ script: 'echo hi', stdout: 'hello\nworld' })} />
        );
        const pre = getByTestId('script-terminal-pre');
        expect(pre.tagName.toLowerCase()).toBe('pre');
        expect(pre.textContent).toContain('hello');
        expect(pre.textContent).toContain('world');
    });

    it('highlights PASS tokens in green and FAIL tokens in red', () => {
        const { container } = render(
            <ScriptTerminalBlock
                parsed={makeParsed({ script: 'tests', stdout: 'PASS  ok.test.ts\nFAIL  bad.test.ts' })}
            />
        );
        const pass = container.querySelector('.text-\\[\\#4ec9b0\\]');
        const fail = container.querySelector('.text-\\[\\#f48771\\]');
        expect(pass).toBeTruthy();
        expect(pass!.textContent).toBe('PASS');
        expect(fail).toBeTruthy();
        expect(fail!.textContent).toBe('FAIL');
    });

    it('dims the leading label of Jest-style summary lines', () => {
        const { container } = render(
            <ScriptTerminalBlock
                parsed={makeParsed({
                    script: 'npm test',
                    stdout: 'Test Suites: 3 passed, 3 total\nTests:       42 passed, 42 total\nTime:        4.812 s',
                })}
            />
        );
        const dims = container.querySelectorAll('.text-\\[\\#858585\\]');
        const dimText = Array.from(dims).map(n => n.textContent);
        expect(dimText).toContain('Test Suites:');
        expect(dimText).toContain('Tests:');
        expect(dimText).toContain('Time:');
    });

    it('renders stderr below stdout with a "stderr:" muted header', () => {
        const { getByTestId } = render(
            <ScriptTerminalBlock parsed={makeParsed({ script: 'cmd', stdout: 'ok', stderr: 'WARN: something' })} />
        );
        expect(getByTestId('script-terminal-stderr-header').textContent).toBe('stderr:');
        expect(getByTestId('script-terminal-stderr').textContent).toContain('WARN: something');
    });

    it('shows the empty placeholder when no stdout/stderr was captured', () => {
        const { getByTestId } = render(
            <ScriptTerminalBlock parsed={makeParsed({ script: 'silent', stdout: '', stderr: '' })} />
        );
        expect(getByTestId('script-terminal-empty').textContent).toBe('(no output)');
    });

    it('uses the fallback string when parser produced no stdout/stderr but a fallback is given', () => {
        const { getByTestId, queryByTestId } = render(
            <ScriptTerminalBlock parsed={makeParsed({ status: 'unknown', recognised: false })} fallback="raw fallback" />
        );
        expect(getByTestId('script-terminal-pre').textContent).toContain('raw fallback');
        expect(queryByTestId('script-terminal-empty')).toBeNull();
    });
});

describe('highlightTerminalLine', () => {
    it('returns Jest-style summary as a header span + plain rest', () => {
        const nodes = highlightTerminalLine('Tests:       42 passed, 42 total', 'k');
        // First node: span; second: rest string.
        expect(Array.isArray(nodes)).toBe(true);
        const arr = nodes as React.ReactNode[];
        expect(arr.length).toBe(2);
    });
});
