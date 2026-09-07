/**
 * The provider-agnostic half of the dangerous-command guard: given a tool call
 * and a matcher verdict, does the command run and what is the model told?
 *
 * The matcher is injected here, so these cover the decision logic rather than
 * the Rust rule set (that lives in `packages/coc-native`).
 */

import { describe, expect, it, vi } from 'vitest';
import {
    extractShellCommand,
    isScreenedShellTool,
    screenDangerousCommand,
    type DangerousCommandMatcher,
} from '../../src/dangerous-command-guard';

const MATCH = {
    matched: true,
    ruleId: 'rm-recursive-dangerous-target',
    description: 'recursive delete of a root or home path',
    matchedSegment: 'rm -rf /',
};

const matches: DangerousCommandMatcher = () => MATCH;
const clean: DangerousCommandMatcher = () => ({ matched: false });
/** The native addon is missing or too old. */
const unavailable: DangerousCommandMatcher = () => null;

describe('extractShellCommand', () => {
    it('reads the command off a Bash call', () => {
        expect(extractShellCommand('Bash', { command: 'ls -la' })).toBe('ls -la');
    });

    it('ignores tools that are not the shell', () => {
        expect(extractShellCommand('Write', { command: 'rm -rf /' })).toBeNull();
        expect(isScreenedShellTool('Write')).toBe(false);
        expect(isScreenedShellTool('Bash')).toBe(true);
    });

    it('ignores a missing, non-string or blank command', () => {
        expect(extractShellCommand('Bash', {})).toBeNull();
        expect(extractShellCommand('Bash', { command: 42 })).toBeNull();
        expect(extractShellCommand('Bash', { command: '   ' })).toBeNull();
        expect(extractShellCommand('Bash', undefined)).toBeNull();
    });
});

describe('screenDangerousCommand', () => {
    it('allows without screening when the guard is disabled', async () => {
        const matcher = vi.fn(matches);
        const requestApproval = vi.fn();
        const result = await screenDangerousCommand(
            'Bash',
            { command: 'rm -rf /' },
            { enabled: false, requestApproval },
            { matcher },
        );
        expect(result).toEqual({ allowed: true });
        expect(matcher).not.toHaveBeenCalled();
        expect(requestApproval).not.toHaveBeenCalled();
    });

    it('allows without screening when no guard is wired at all', async () => {
        expect(await screenDangerousCommand('Bash', { command: 'rm -rf /' }, undefined, {
            matcher: matches,
        })).toEqual({ allowed: true });
    });

    it('allows a benign command without prompting', async () => {
        const requestApproval = vi.fn();
        const result = await screenDangerousCommand(
            'Bash',
            { command: 'npm test' },
            { enabled: true, requestApproval },
            { matcher: clean },
        );
        expect(result).toEqual({ allowed: true });
        expect(requestApproval).not.toHaveBeenCalled();
    });

    it('never screens a non-shell tool', async () => {
        const matcher = vi.fn(matches);
        const result = await screenDangerousCommand(
            'Write',
            { command: 'rm -rf /' },
            { enabled: true, requestApproval: vi.fn() },
            { matcher },
        );
        expect(result).toEqual({ allowed: true });
        expect(matcher).not.toHaveBeenCalled();
    });

    it('fails open when the native matcher is unavailable', async () => {
        const requestApproval = vi.fn();
        const result = await screenDangerousCommand(
            'Bash',
            { command: 'rm -rf /' },
            { enabled: true, requestApproval },
            { matcher: unavailable },
        );
        expect(result).toEqual({ allowed: true });
        expect(requestApproval).not.toHaveBeenCalled();
    });

    it('fails open when the native matcher throws', async () => {
        const result = await screenDangerousCommand(
            'Bash',
            { command: 'rm -rf /' },
            { enabled: true, requestApproval: vi.fn() },
            {
                matcher: () => {
                    throw new Error('addon exploded');
                },
            },
        );
        expect(result).toEqual({ allowed: true });
    });

    it('prompts on a match and passes the full command plus the matched rule', async () => {
        const requestApproval = vi.fn(async () => 'approve-once' as const);
        const result = await screenDangerousCommand(
            'Bash',
            { command: 'ls && rm -rf /' },
            { enabled: true, requestApproval },
            { matcher: matches },
        );
        expect(requestApproval.mock.calls[0][0]).toEqual({
            toolName: 'Bash',
            command: 'ls && rm -rf /',
            ruleId: MATCH.ruleId,
            description: MATCH.description,
            matchedSegment: MATCH.matchedSegment,
        });
        expect(result.allowed).toBe(true);
        expect(result.decision).toBe('approve-once');
        expect(result.denialMessage).toBeUndefined();
    });

    it('forwards the abort signal so an aborted turn can release the prompt', async () => {
        const controller = new AbortController();
        const requestApproval = vi.fn(async () => 'approve-once' as const);
        await screenDangerousCommand(
            'Bash',
            { command: 'rm -rf /' },
            { enabled: true, requestApproval },
            { matcher: matches, signal: controller.signal },
        );
        expect(requestApproval.mock.calls[0][1]).toBe(controller.signal);
    });

    it('treats approve-for-session as an allow', async () => {
        const result = await screenDangerousCommand(
            'Bash',
            { command: 'rm -rf /' },
            { enabled: true, requestApproval: async () => 'approve-session' },
            { matcher: matches },
        );
        expect(result.allowed).toBe(true);
        expect(result.decision).toBe('approve-session');
    });

    it('blocks on a deny and names the rule and segment to the model', async () => {
        const result = await screenDangerousCommand(
            'Bash',
            { command: 'rm -rf /' },
            { enabled: true, requestApproval: async () => 'deny' },
            { matcher: matches },
        );
        expect(result.allowed).toBe(false);
        expect(result.decision).toBe('deny');
        expect(result.denialMessage).toContain(MATCH.ruleId);
        expect(result.denialMessage).toContain(MATCH.matchedSegment);
        expect(result.denialMessage).toContain('The user denied it.');
    });

    it('blocks when there is no approval channel — a non-interactive turn', async () => {
        const result = await screenDangerousCommand(
            'Bash',
            { command: 'rm -rf /' },
            { enabled: true },
            { matcher: matches },
        );
        expect(result.allowed).toBe(false);
        expect(result.denialMessage).toContain('not interactive');
    });

    it('blocks when the approval prompt itself fails', async () => {
        const result = await screenDangerousCommand(
            'Bash',
            { command: 'rm -rf /' },
            {
                enabled: true,
                requestApproval: async () => {
                    throw new Error('client went away');
                },
            },
            { matcher: matches },
        );
        expect(result.allowed).toBe(false);
        expect(result.denialMessage).toContain('approval prompt failed');
    });

    it('falls back to readable text when the verdict omits its detail fields', async () => {
        const result = await screenDangerousCommand(
            'Bash',
            { command: 'rm -rf /' },
            { enabled: true, requestApproval: async () => 'deny' },
            { matcher: () => ({ matched: true }) },
        );
        expect(result.match).toEqual({
            ruleId: 'unknown',
            description: 'matched a dangerous-command rule',
            matchedSegment: 'rm -rf /',
        });
    });
});
