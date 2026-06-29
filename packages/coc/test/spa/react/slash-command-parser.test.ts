/**
 * Tests for slash-command-parser utility.
 *
 * Covers parseSlashCommands, getSlashCommandContext, and isMetaCommand.
 */

import { describe, it, expect } from 'vitest';
import { parseSlashCommands, getSlashCommandContext, isMetaCommand, META_COMMANDS } from '../../../src/server/spa/client/react/features/chat/slash-command-parser';

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

    it('contains loop', () => {
        expect(META_COMMANDS).toContain('loop');
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
    it('includes "compact" regardless of the loops feature flag', async () => {
        const { getActiveMetaCommands } = await import('../../../src/server/spa/client/react/features/chat/slash-command-parser');
        expect(getActiveMetaCommands(true)).toContain('compact');
        expect(getActiveMetaCommands(false)).toContain('compact');
    });
});

// ============================================================================
// /loop meta-command
// ============================================================================

describe('parseSlashCommands — /loop meta-command', () => {
    it('detects /loop as a meta-command', () => {
        const result = parseSlashCommands('/loop', AVAILABLE_SKILLS);
        expect(result.metaCommands).toContain('loop');
        expect(result.skills).toEqual([]);
        expect(result.prompt).toBe('');
    });

    it('strips /loop from the prompt', () => {
        const result = parseSlashCommands('/loop monitor CI every 5m', AVAILABLE_SKILLS);
        expect(result.metaCommands).toContain('loop');
        expect(result.prompt).toBe('monitor CI every 5m');
    });

    it('handles /loop mixed with skills', () => {
        const result = parseSlashCommands('/impl /loop check build status', AVAILABLE_SKILLS);
        expect(result.skills).toEqual(['impl']);
        expect(result.metaCommands).toContain('loop');
        expect(result.prompt).toBe('check build status');
    });

    it('recognizes /loop as a meta-command via isMetaCommand', () => {
        expect(isMetaCommand('loop')).toBe(true);
        expect(isMetaCommand('LOOP')).toBe(true);
    });

    it('meta-command /loop has priority over a skill named loop', () => {
        const skills = [...AVAILABLE_SKILLS, 'loop'];
        const result = parseSlashCommands('/loop test', skills);
        expect(result.metaCommands).toContain('loop');
        expect(result.skills).toEqual([]);
    });
});

describe('getActiveMetaCommands', () => {
    it('includes "loop" when loops feature is enabled', async () => {
        const { getActiveMetaCommands } = await import('../../../src/server/spa/client/react/features/chat/slash-command-parser');
        expect(getActiveMetaCommands(true)).toContain('loop');
        expect(getActiveMetaCommands(true)).toContain('model');
    });

    it('excludes "loop" when loops feature is disabled', async () => {
        const { getActiveMetaCommands } = await import('../../../src/server/spa/client/react/features/chat/slash-command-parser');
        expect(getActiveMetaCommands(false)).not.toContain('loop');
        expect(getActiveMetaCommands(false)).toContain('model');
    });
});

describe('parseSlashCommands with restricted meta-commands', () => {
    it('does not match /loop when meta-commands excludes "loop"', async () => {
        const { parseSlashCommands, getActiveMetaCommands } = await import('../../../src/server/spa/client/react/features/chat/slash-command-parser');
        const result = parseSlashCommands('/loop every 5m', [], getActiveMetaCommands(false));
        expect(result.metaCommands).not.toContain('loop');
    });

    it('still matches /model when meta-commands excludes "loop"', async () => {
        const { parseSlashCommands, getActiveMetaCommands } = await import('../../../src/server/spa/client/react/features/chat/slash-command-parser');
        const result = parseSlashCommands('/model gpt-5', [], getActiveMetaCommands(false));
        expect(result.metaCommands).toContain('model');
    });

    it('matches /loop when meta-commands includes "loop"', async () => {
        const { parseSlashCommands, getActiveMetaCommands } = await import('../../../src/server/spa/client/react/features/chat/slash-command-parser');
        const result = parseSlashCommands('/loop every 5m', [], getActiveMetaCommands(true));
        expect(result.metaCommands).toContain('loop');
    });
});
