/**
 * Covers parseSlashCommands, getSlashCommandContext, and isMetaCommand.
 */

import { describe, it, expect } from 'vitest';
import { parseSlashCommands, getSlashCommandContext, isMetaCommand, META_COMMANDS, getActiveMetaCommands, getFileMentionContext } from '../../../src/server/spa/client/react/features/chat/slash-command-parser';

const AVAILABLE_SKILLS = ['impl', 'go-deep', 'draft', 'pipeline-generator', 'review'];

// ============================================================================
// parseSlashCommands
// ============================================================================

describe('parseSlashCommands', () => {
    it('parses a single skill at the beginning', () => {
        const result = parseSlashCommands('/impl do something', AVAILABLE_SKILLS);
        expect(result.skills).toEqual(['impl']);
        expect(result.prompt).toBe('do something');
    });

    it('parses multiple skills', () => {
        const result = parseSlashCommands('/go-deep /impl analyze auth', AVAILABLE_SKILLS);
        expect(result.skills).toEqual(['go-deep', 'impl']);
        expect(result.prompt).toBe('analyze auth');
    });

    it('ignores unknown /tokens', () => {
        const result = parseSlashCommands('/notaskill do something', AVAILABLE_SKILLS);
        expect(result.skills).toEqual([]);
        expect(result.prompt).toBe('/notaskill do something');
    });

    it('handles empty input', () => {
        const result = parseSlashCommands('', AVAILABLE_SKILLS);
        expect(result.skills).toEqual([]);
        expect(result.prompt).toBe('');
    });

    it('handles whitespace-only input', () => {
        const result = parseSlashCommands('   ', AVAILABLE_SKILLS);
        expect(result.skills).toEqual([]);
        expect(result.prompt).toBe('');
    });

    it('handles only a skill with no additional text', () => {
        const result = parseSlashCommands('/impl', AVAILABLE_SKILLS);
        expect(result.skills).toEqual(['impl']);
        expect(result.prompt).toBe('');
    });

    it('deduplicates skills (first occurrence wins)', () => {
        const result = parseSlashCommands('/impl /impl do it', AVAILABLE_SKILLS);
        expect(result.skills).toEqual(['impl']);
        expect(result.prompt).toBe('do it');
    });

    it('is case-insensitive for skill matching', () => {
        const result = parseSlashCommands('/IMPL do it', AVAILABLE_SKILLS);
        expect(result.skills).toEqual(['impl']);
        expect(result.prompt).toBe('do it');
    });

    it('handles skills mid-sentence after whitespace', () => {
        const result = parseSlashCommands('please /impl this code', AVAILABLE_SKILLS);
        expect(result.skills).toEqual(['impl']);
        expect(result.prompt).toBe('please this code');
    });

    it('preserves unknown /tokens mixed with known skills', () => {
        const result = parseSlashCommands('/impl /unknown /draft build it', AVAILABLE_SKILLS);
        expect(result.skills).toEqual(['impl', 'draft']);
        expect(result.prompt).toBe('/unknown build it');
    });

    it('normalizes whitespace in output prompt', () => {
        const result = parseSlashCommands('/impl   analyze   the   code', AVAILABLE_SKILLS);
        expect(result.skills).toEqual(['impl']);
        expect(result.prompt).toBe('analyze the code');
    });

    it('handles input with only slashes and no valid tokens', () => {
        const result = parseSlashCommands('/ / /', AVAILABLE_SKILLS);
        expect(result.skills).toEqual([]);
        expect(result.prompt).toBe('/ / /');
    });

    it('does not match slash inside a word', () => {
        const result = parseSlashCommands('http://example.com/impl test', AVAILABLE_SKILLS);
        expect(result.skills).toEqual([]);
    });

    it('handles skill with hyphens (pipeline-generator)', () => {
        const result = parseSlashCommands('/pipeline-generator create a pipeline', AVAILABLE_SKILLS);
        expect(result.skills).toEqual(['pipeline-generator']);
        expect(result.prompt).toBe('create a pipeline');
    });
});

// ============================================================================
// getSlashCommandContext
// ============================================================================

describe('getSlashCommandContext', () => {
    it('returns context when cursor is right after /', () => {
        const ctx = getSlashCommandContext('/', 1);
        expect(ctx).not.toBeNull();
        expect(ctx!.active).toBe(true);
        expect(ctx!.prefix).toBe('');
        expect(ctx!.startIndex).toBe(0);
    });

    it('returns context with partial prefix', () => {
        const ctx = getSlashCommandContext('/go', 3);
        expect(ctx).not.toBeNull();
        expect(ctx!.active).toBe(true);
        expect(ctx!.prefix).toBe('go');
        expect(ctx!.startIndex).toBe(0);
    });

    it('returns context for slash after whitespace', () => {
        const ctx = getSlashCommandContext('hello /im', 9);
        expect(ctx).not.toBeNull();
        expect(ctx!.active).toBe(true);
        expect(ctx!.prefix).toBe('im');
        expect(ctx!.startIndex).toBe(6);
    });

    it('returns null when no slash is present', () => {
        const ctx = getSlashCommandContext('hello world', 5);
        expect(ctx).toBeNull();
    });

    it('returns null when slash is not at word boundary', () => {
        const ctx = getSlashCommandContext('http://example.com', 7);
        expect(ctx).toBeNull();
    });

    it('returns null when cursor is before the slash', () => {
        const ctx = getSlashCommandContext('hello /impl', 3);
        expect(ctx).toBeNull();
    });

    it('returns null when there is a space between slash and cursor', () => {
        const ctx = getSlashCommandContext('/ hello', 7);
        expect(ctx).toBeNull();
    });

    it('returns context when cursor is at end of token', () => {
        const ctx = getSlashCommandContext('/impl', 5);
        expect(ctx).not.toBeNull();
        expect(ctx!.prefix).toBe('impl');
    });

    it('returns null when cursor is in middle of completed token', () => {
        // Cursor is between 'i' and 'p' in "/impl", but 'p' continues
        const ctx = getSlashCommandContext('/impl ', 2);
        // cursor at position 2 = "/i" — token continues with "mpl"
        expect(ctx).toBeNull();
    });

    it('returns context after existing skill token', () => {
        const ctx = getSlashCommandContext('/impl /go', 9);
        expect(ctx).not.toBeNull();
        expect(ctx!.prefix).toBe('go');
        expect(ctx!.startIndex).toBe(6);
    });
});

// ============================================================================
// isMetaCommand
// ============================================================================

describe('isMetaCommand', () => {
    it('recognizes "model" as a meta-command', () => {
        expect(isMetaCommand('model')).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(isMetaCommand('MODEL')).toBe(true);
        expect(isMetaCommand('Model')).toBe(true);
    });

    it('rejects unknown commands', () => {
        expect(isMetaCommand('impl')).toBe(false);
        expect(isMetaCommand('foo')).toBe(false);
    });
});

// ============================================================================
// parseSlashCommands — meta-commands
// ============================================================================

describe('parseSlashCommands — meta-commands', () => {
    it('detects /model as a meta-command', () => {
        const result = parseSlashCommands('/model', AVAILABLE_SKILLS);
        expect(result.metaCommands).toEqual(['model']);
        expect(result.skills).toEqual([]);
        expect(result.prompt).toBe('');
    });

    it('strips /model from the prompt', () => {
        const result = parseSlashCommands('/model some text', AVAILABLE_SKILLS);
        expect(result.metaCommands).toEqual(['model']);
        expect(result.prompt).toBe('some text');
    });

    it('handles /model mixed with skills', () => {
        const result = parseSlashCommands('/impl /model fix the bug', AVAILABLE_SKILLS);
        expect(result.skills).toEqual(['impl']);
        expect(result.metaCommands).toEqual(['model']);
        expect(result.prompt).toBe('fix the bug');
    });

    it('deduplicates /model', () => {
        const result = parseSlashCommands('/model /model test', AVAILABLE_SKILLS);
        expect(result.metaCommands).toEqual(['model']);
        expect(result.prompt).toBe('test');
    });

    it('is case-insensitive for meta-commands', () => {
        const result = parseSlashCommands('/MODEL test', AVAILABLE_SKILLS);
        expect(result.metaCommands).toEqual(['model']);
        expect(result.prompt).toBe('test');
    });

    it('returns empty metaCommands array when none present', () => {
        const result = parseSlashCommands('/impl fix it', AVAILABLE_SKILLS);
        expect(result.metaCommands).toEqual([]);
    });

    it('returns empty metaCommands for empty input', () => {
        const result = parseSlashCommands('', AVAILABLE_SKILLS);
        expect(result.metaCommands).toEqual([]);
    });

    it('meta-commands have priority over skills with same name', () => {
        // If there were a skill named "model", meta-command wins
        const skills = [...AVAILABLE_SKILLS, 'model'];
        const result = parseSlashCommands('/model test', skills);
        expect(result.metaCommands).toEqual(['model']);
        expect(result.skills).toEqual([]);
        expect(result.prompt).toBe('test');
    });
});

describe('META_COMMANDS constant', () => {
    it('contains model', () => {
        expect(META_COMMANDS).toContain('model');
    });

    it('contains cron', () => {
        expect(META_COMMANDS).toContain('cron');
    });

    it('contains compact', () => {
        expect(META_COMMANDS).toContain('compact');
    });
});

// ============================================================================
// /compact meta-command
// ============================================================================

describe('parseSlashCommands — /compact meta-command', () => {
    it('detects /compact as a meta-command with empty prompt', () => {
        const result = parseSlashCommands('/compact', AVAILABLE_SKILLS);
        expect(result.metaCommands).toContain('compact');
        expect(result.skills).toEqual([]);
        expect(result.prompt).toBe('');
    });

    it('treats text after /compact as the (instructions) prompt', () => {
        const result = parseSlashCommands('/compact focus on the auth refactor', AVAILABLE_SKILLS);
        expect(result.metaCommands).toContain('compact');
        expect(result.prompt).toBe('focus on the auth refactor');
    });

    it('is case-insensitive for /compact', () => {
        const result = parseSlashCommands('/COMPACT keep the test plan', AVAILABLE_SKILLS);
        expect(result.metaCommands).toContain('compact');
        expect(result.prompt).toBe('keep the test plan');
    });

    it('does not add compact to skills (client-side action, not a skill)', () => {
        const result = parseSlashCommands('/compact drop old context', AVAILABLE_SKILLS);
        expect(result.skills).toEqual([]);
    });

    it('recognizes /compact via isMetaCommand', () => {
        expect(isMetaCommand('compact')).toBe(true);
        expect(isMetaCommand('COMPACT')).toBe(true);
    });
});

describe('getActiveMetaCommands — compact always active', () => {
    it('includes "compact" regardless of the cron feature flag', async () => {
        const { getActiveMetaCommands } = await import('../../../src/server/spa/client/react/features/chat/slash-command-parser');
        expect(getActiveMetaCommands(true)).toContain('compact');
        expect(getActiveMetaCommands(false)).toContain('compact');
    });
});

// ============================================================================
// /cron meta-command
// ============================================================================

describe('parseSlashCommands — /cron meta-command', () => {
    it('detects /cron as a meta-command', () => {
        const result = parseSlashCommands('/cron', AVAILABLE_SKILLS);
        expect(result.metaCommands).toContain('cron');
        expect(result.skills).toEqual([]);
        expect(result.prompt).toBe('');
    });

    it('strips /cron from the prompt', () => {
        const result = parseSlashCommands('/cron monitor CI every 5m', AVAILABLE_SKILLS);
        expect(result.metaCommands).toContain('cron');
        expect(result.prompt).toBe('monitor CI every 5m');
    });

    it('handles /cron mixed with skills', () => {
        const result = parseSlashCommands('/impl /cron check build status', AVAILABLE_SKILLS);
        expect(result.skills).toEqual(['impl']);
        expect(result.metaCommands).toContain('cron');
        expect(result.prompt).toBe('check build status');
    });

    it('recognizes /cron as a meta-command via isMetaCommand', () => {
        expect(isMetaCommand('cron')).toBe(true);
        expect(isMetaCommand('CRON')).toBe(true);
    });

    it('meta-command /cron has priority over a skill named cron', () => {
        const skills = [...AVAILABLE_SKILLS, 'cron'];
        const result = parseSlashCommands('/cron test', skills);
        expect(result.metaCommands).toContain('cron');
        expect(result.skills).toEqual([]);
    });
});

// ============================================================================
// /delegate meta-command
// ============================================================================

describe('parseSlashCommands — /delegate meta-command', () => {
    it('detects /delegate as a meta-command', () => {
        const result = parseSlashCommands('/delegate', AVAILABLE_SKILLS);
        expect(result.metaCommands).toContain('delegate');
        expect(result.prompt).toBe('');
    });

    it('keeps the provider and task text in the prompt', () => {
        const result = parseSlashCommands('/delegate claude Review the plan', AVAILABLE_SKILLS);
        expect(result.metaCommands).toContain('delegate');
        expect(result.prompt).toBe('claude Review the plan');
    });

    it('is unaffected by the cron feature flag', () => {
        const result = parseSlashCommands('/delegate Review the plan', [], getActiveMetaCommands(false));
        expect(result.metaCommands).toContain('delegate');
        expect(result.prompt).toBe('Review the plan');
    });

    it('recognizes /delegate via isMetaCommand', () => {
        expect(isMetaCommand('delegate')).toBe(true);
        expect(isMetaCommand('DELEGATE')).toBe(true);
    });

    it('leaves the word delegate inside ordinary task text alone', () => {
        const result = parseSlashCommands('/delegate delegate the review to claude', AVAILABLE_SKILLS);
        expect(result.prompt).toBe('delegate the review to claude');
    });
});

describe('getActiveMetaCommands', () => {
    it('includes "cron" when cron feature is enabled', async () => {
        const { getActiveMetaCommands } = await import('../../../src/server/spa/client/react/features/chat/slash-command-parser');
        expect(getActiveMetaCommands(true)).toContain('cron');
        expect(getActiveMetaCommands(true)).toContain('model');
    });

    it('excludes "cron" when cron feature is disabled', async () => {
        const { getActiveMetaCommands } = await import('../../../src/server/spa/client/react/features/chat/slash-command-parser');
        expect(getActiveMetaCommands(false)).not.toContain('cron');
        expect(getActiveMetaCommands(false)).toContain('model');
    });
});

describe('parseSlashCommands with restricted meta-commands', () => {
    it('does not match /cron when meta-commands excludes "cron"', async () => {
        const { parseSlashCommands, getActiveMetaCommands } = await import('../../../src/server/spa/client/react/features/chat/slash-command-parser');
        const result = parseSlashCommands('/cron every 5m', [], getActiveMetaCommands(false));
        expect(result.metaCommands).not.toContain('cron');
    });

    it('still matches /model when meta-commands excludes "cron"', async () => {
        const { parseSlashCommands, getActiveMetaCommands } = await import('../../../src/server/spa/client/react/features/chat/slash-command-parser');
        const result = parseSlashCommands('/model gpt-5', [], getActiveMetaCommands(false));
        expect(result.metaCommands).toContain('model');
    });

    it('matches /cron when meta-commands includes "cron"', async () => {
        const { parseSlashCommands, getActiveMetaCommands } = await import('../../../src/server/spa/client/react/features/chat/slash-command-parser');
        const result = parseSlashCommands('/cron every 5m', [], getActiveMetaCommands(true));
        expect(result.metaCommands).toContain('cron');
    });
});

// ============================================================================
// getFileMentionContext
// ============================================================================

describe('getFileMentionContext', () => {
    /** Helper: `|` marks the caret position in the fixture string. */
    function at(fixture: string) {
        const cursor = fixture.indexOf('|');
        return getFileMentionContext(fixture.replace('|', ''), cursor);
    }

    it('opens on an @-prefixed path token', () => {
        expect(at('@src/fo|')).toEqual({ active: true, prefix: 'src/fo', startIndex: 0, hasSigil: true });
    });

    it('opens on a bare @ at the start of the input', () => {
        expect(at('@|')).toEqual({ active: true, prefix: '', startIndex: 0, hasSigil: true });
    });

    it('opens on an @ preceded by whitespace', () => {
        expect(at('look at @sr|')).toEqual({ active: true, prefix: 'sr', startIndex: 8, hasSigil: true });
    });

    it('does not open on an @ that follows a non-whitespace character', () => {
        expect(at('abc@|')).toBeNull();
    });

    it('opens trigger-lessly on a token containing a slash', () => {
        expect(at('packages/coc|')).toEqual({ active: true, prefix: 'packages/coc', startIndex: 0, hasSigil: false });
    });

    it('opens trigger-lessly on a token ending in an extension', () => {
        expect(at('foo.ts|')).toEqual({ active: true, prefix: 'foo.ts', startIndex: 0, hasSigil: false });
    });

    it('does not open on a bare prose word', () => {
        expect(at('index|')).toBeNull();
    });

    it('does not open on an email address', () => {
        expect(at('email@example.com|')).toBeNull();
    });

    it('does not open when the caret is mid-token', () => {
        expect(at('src/foo.t|s')).toBeNull();
    });

    it('opens when the caret is at the token end but text follows after a space', () => {
        expect(at('src/foo| bar')).toEqual({ active: true, prefix: 'src/foo', startIndex: 0, hasSigil: false });
    });

    it('leaves slash-command and repo-mention tokens alone', () => {
        expect(at('/impl/x|')).toBeNull();
        expect(at('#my/repo|')).toBeNull();
    });

    it('returns null on an empty input', () => {
        expect(at('|')).toBeNull();
    });
});
