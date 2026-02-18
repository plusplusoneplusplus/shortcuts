/**
 * Tests for wizard helper functions: extractYamlScalar and buildConfigYaml.
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { extractYamlScalar, buildConfigYaml } from '../../../src/server/wiki/spa/client/admin';

describe('extractYamlScalar', () => {
    it('extracts a simple unquoted scalar', () => {
        expect(extractYamlScalar('model: gpt-4o\ndepth: deep\n', 'model')).toBe('gpt-4o');
    });

    it('extracts a double-quoted scalar', () => {
        expect(extractYamlScalar('model: "gpt-4o"\n', 'model')).toBe('gpt-4o');
    });

    it('extracts a single-quoted scalar', () => {
        expect(extractYamlScalar("model: 'gpt-4o'\n", 'model')).toBe('gpt-4o');
    });

    it('returns null when key is missing', () => {
        expect(extractYamlScalar('depth: deep\n', 'model')).toBeNull();
    });

    it('returns null for empty YAML', () => {
        expect(extractYamlScalar('', 'model')).toBeNull();
    });

    it('extracts from multi-line YAML', () => {
        const yaml = 'model: gpt-4o\ndepth: standard\nfocus: auth\n';
        expect(extractYamlScalar(yaml, 'depth')).toBe('standard');
        expect(extractYamlScalar(yaml, 'focus')).toBe('auth');
    });

    it('trims whitespace around the value', () => {
        expect(extractYamlScalar('model:   gpt-4o  \n', 'model')).toBe('gpt-4o');
    });

    it('ignores inline comments', () => {
        expect(extractYamlScalar('model: gpt-4o # the model\n', 'model')).toBe('gpt-4o');
    });

    it('does not match partial key names', () => {
        expect(extractYamlScalar('mymodel: foo\n', 'model')).toBeNull();
    });

    it('handles key at beginning of YAML (no leading newline)', () => {
        expect(extractYamlScalar('model: claude-sonnet', 'model')).toBe('claude-sonnet');
    });
});

describe('buildConfigYaml', () => {
    it('builds YAML from scratch when existing is empty', () => {
        const result = buildConfigYaml('', { model: 'gpt-4o', depth: 'deep', focus: 'auth' });
        expect(result).toBe('model: gpt-4o\ndepth: deep\nfocus: auth\n');
    });

    it('builds YAML from scratch with only some fields', () => {
        const result = buildConfigYaml('', { model: '', depth: 'standard', focus: '' });
        expect(result).toBe('depth: standard\n');
    });

    it('builds YAML from whitespace-only input', () => {
        const result = buildConfigYaml('   \n  ', { model: 'gpt-4o', depth: 'deep', focus: '' });
        expect(result).toBe('model: gpt-4o\ndepth: deep\n');
    });

    it('upserts existing keys in YAML', () => {
        const existing = 'model: old-model\ndepth: shallow\nfocus: api\n';
        const result = buildConfigYaml(existing, { model: 'gpt-4o', depth: 'deep', focus: 'auth' });
        expect(result).toContain('model: gpt-4o');
        expect(result).toContain('depth: deep');
        expect(result).toContain('focus: auth');
        expect(result).not.toContain('old-model');
        expect(result).not.toContain('shallow');
    });

    it('appends missing keys to existing YAML', () => {
        const existing = 'model: gpt-4o\n';
        const result = buildConfigYaml(existing, { model: 'gpt-4o', depth: 'standard', focus: 'auth' });
        expect(result).toContain('model: gpt-4o');
        expect(result).toContain('depth: standard');
        expect(result).toContain('focus: auth');
    });

    it('skips empty fields when upserting', () => {
        const existing = 'model: gpt-4o\ndepth: deep\n';
        const result = buildConfigYaml(existing, { model: '', depth: 'standard', focus: '' });
        expect(result).toContain('model: gpt-4o');
        expect(result).toContain('depth: standard');
        expect(result).not.toContain('focus');
    });

    it('preserves unrelated YAML keys', () => {
        const existing = 'title: My Wiki\nmodel: old\nconcurrency: 4\n';
        const result = buildConfigYaml(existing, { model: 'gpt-4o', depth: '', focus: '' });
        expect(result).toContain('title: My Wiki');
        expect(result).toContain('concurrency: 4');
        expect(result).toContain('model: gpt-4o');
    });

    it('handles existing YAML without trailing newline', () => {
        const existing = 'model: old';
        const result = buildConfigYaml(existing, { model: 'gpt-4o', depth: 'deep', focus: '' });
        expect(result).toContain('model: gpt-4o');
        expect(result).toContain('depth: deep');
    });
});
