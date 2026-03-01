/**
 * Tests for slash-command-parser utility.
 *
 * Covers parseSlashCommands and getSlashCommandContext.
 */

import { describe, it, expect } from 'vitest';
import { parseSlashCommands, getSlashCommandContext } from '../../../src/server/spa/client/react/repos/slash-command-parser';

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
