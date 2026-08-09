/**
 * Wiring tests for the three cards added after the first utility batch:
 * token generator, regex tester and JSON formatter. The maths and parsing live
 * in the matching logic tests — this file only checks the controls are hooked
 * up and the errors render inline.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { JsonFormatterCard } from '../../../../../src/server/spa/client/react/features/dev-tools/JsonFormatterCard';
import { RegexTesterCard } from '../../../../../src/server/spa/client/react/features/dev-tools/RegexTesterCard';
import { TokenGeneratorCard } from '../../../../../src/server/spa/client/react/features/dev-tools/TokenGeneratorCard';

function text(testId: string): string {
    return screen.getByTestId(testId).textContent ?? '';
}

describe('TokenGeneratorCard', () => {
    it('shows one UUID on mount and a fresh one per Generate click', () => {
        render(<TokenGeneratorCard />);
        const first = text('token-value-0');
        expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        fireEvent.click(screen.getByTestId('token-generate'));
        expect(text('token-value-0')).not.toBe(first);
    });

    it('switches to hex and honours the byte-length control', () => {
        render(<TokenGeneratorCard />);
        expect(screen.queryByTestId('token-bytes')).toBeNull();
        fireEvent.click(screen.getByTestId('token-kind-hex'));
        fireEvent.change(screen.getByTestId('token-bytes'), { target: { value: '4' } });
        expect(text('token-value-0')).toMatch(/^[0-9a-f]{8}$/);
    });

    it('generates N values at once with a copy-all affordance', () => {
        render(<TokenGeneratorCard />);
        expect(screen.queryByTestId('token-copy-all')).toBeNull();
        fireEvent.change(screen.getByTestId('token-count'), { target: { value: '3' } });
        expect(screen.getAllByTestId(/^token-value-\d+$/).length).toBe(3);
        expect(() => fireEvent.click(screen.getByTestId('token-copy-all'))).not.toThrow();
    });

    it('shows an inline error for an out-of-range count', () => {
        render(<TokenGeneratorCard />);
        fireEvent.change(screen.getByTestId('token-count'), { target: { value: '999' } });
        expect(text('token-error')).toContain('Count must be');
        expect(screen.queryByTestId('token-list')).toBeNull();
    });
});

describe('RegexTesterCard', () => {
    it('highlights the matches and lists their capture groups', () => {
        render(<RegexTesterCard />);
        expect(text('regex-count')).toContain('2 matches');
        expect(text('regex-match-0')).toBe('ada@example.com');
        expect(text('regex-match-0-group-1')).toContain('ada');
        expect(screen.getByTestId('regex-highlight').querySelectorAll('mark').length).toBe(2);
    });

    it('re-runs when the pattern or the subject changes', () => {
        render(<RegexTesterCard />);
        fireEvent.change(screen.getByTestId('regex-pattern'), { target: { value: 'an' } });
        fireEvent.change(screen.getByTestId('regex-subject'), { target: { value: 'banana' } });
        expect(text('regex-count')).toContain('2 matches');
        expect(text('regex-highlight')).toBe('banana');
    });

    it('toggles a flag and changes the match count', () => {
        render(<RegexTesterCard />);
        fireEvent.change(screen.getByTestId('regex-pattern'), { target: { value: 'ADA' } });
        expect(text('regex-count')).toContain('0 matches');
        fireEvent.click(screen.getByTestId('regex-flag-i'));
        expect(text('regex-count')).toContain('1 match');
    });

    it('shows an inline error for an invalid pattern', () => {
        render(<RegexTesterCard />);
        fireEvent.change(screen.getByTestId('regex-pattern'), { target: { value: '(' } });
        expect(screen.getByTestId('regex-error')).toBeTruthy();
        expect(screen.queryByTestId('regex-count')).toBeNull();
    });
});

describe('JsonFormatterCard', () => {
    it('pretty-prints at the chosen indent', () => {
        render(<JsonFormatterCard />);
        fireEvent.change(screen.getByTestId('json-input'), { target: { value: '{"a":1}' } });
        expect(text('json-output')).toBe('{\n  "a": 1\n}');
        fireEvent.change(screen.getByTestId('json-indent'), { target: { value: '4' } });
        expect(text('json-output')).toBe('{\n    "a": 1\n}');
    });

    it('minifies and hides the indent control in that mode', () => {
        render(<JsonFormatterCard />);
        fireEvent.change(screen.getByTestId('json-input'), { target: { value: '{\n  "a": [1, 2]\n}' } });
        fireEvent.click(screen.getByTestId('json-mode-minify'));
        expect(screen.queryByTestId('json-indent')).toBeNull();
        expect(text('json-output')).toBe('{"a":[1,2]}');
    });

    it('reports a parse error with a location and hides the output', () => {
        render(<JsonFormatterCard />);
        fireEvent.change(screen.getByTestId('json-input'), { target: { value: '{"a" 1}' } });
        expect(text('json-error')).toMatch(/line \d+/);
        expect(screen.queryByTestId('json-output')).toBeNull();
    });

    it('copies without throwing in a clipboard-less environment', () => {
        render(<JsonFormatterCard />);
        expect(() => fireEvent.click(screen.getByTestId('json-copy'))).not.toThrow();
    });
});
