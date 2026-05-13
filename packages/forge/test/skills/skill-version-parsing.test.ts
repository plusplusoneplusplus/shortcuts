/**
 * Tests for parseSkillVersionFromContent and parseBundledSkillVersion.
 */

import { describe, it, expect } from 'vitest';
import { parseSkillVersionFromContent, parseBundledSkillVersion, getBundledSkillsPath } from '../../src/skills/bundled-skills-provider';
import { parseVersionFromFrontmatter } from '../../src/skills/skill-version-parser';
import * as fs from 'fs';
import * as path from 'path';

describe('parseSkillVersionFromContent', () => {
    it('parses nested metadata.version', () => {
        const content = `---\nname: test\ndescription: A test\nmetadata:\n  version: "0.0.1"\n---\n\n# Test`;
        expect(parseSkillVersionFromContent(content)).toBe('0.0.1');
    });

    it('parses top-level version', () => {
        const content = `---\nname: test\nversion: 1.2.3\n---\n\n# Test`;
        expect(parseSkillVersionFromContent(content)).toBe('1.2.3');
    });

    it('prefers top-level version over nested', () => {
        const content = `---\nname: test\nversion: 2.0.0\nmetadata:\n  version: "1.0.0"\n---\n\n# Test`;
        expect(parseSkillVersionFromContent(content)).toBe('2.0.0');
    });

    it('returns undefined for content without frontmatter', () => {
        expect(parseSkillVersionFromContent('# Just markdown')).toBeUndefined();
    });

    it('returns undefined for frontmatter without version', () => {
        const content = `---\nname: test\ndescription: No version\n---\n\n# Test`;
        expect(parseSkillVersionFromContent(content)).toBeUndefined();
    });

    it('handles unquoted version values', () => {
        const content = `---\nname: test\nmetadata:\n  version: 0.0.5\n---\n\n# Test`;
        expect(parseSkillVersionFromContent(content)).toBe('0.0.5');
    });

    it('handles single-quoted version values', () => {
        const content = `---\nname: test\nmetadata:\n  version: '1.0.0'\n---\n\n# Test`;
        expect(parseSkillVersionFromContent(content)).toBe('1.0.0');
    });
});

describe('parseVersionFromFrontmatter', () => {
    it('parses double-quoted top-level versions', () => {
        const content = `---\nname: test\nversion: "3.2.1"\n---\n\n# Test`;
        expect(parseVersionFromFrontmatter(content)).toBe('3.2.1');
    });

    it('parses nested metadata versions with CRLF line endings', () => {
        const content = '---\r\nname: test\r\nmetadata:\r\n  version: 4.5.6\r\n---\r\n\r\n# Test';
        expect(parseVersionFromFrontmatter(content)).toBe('4.5.6');
    });

    it('returns undefined when metadata has no version', () => {
        const content = `---\nname: test\nmetadata:\n  owner: docs\n---\n\n# Test`;
        expect(parseVersionFromFrontmatter(content)).toBeUndefined();
    });
});

describe('parseBundledSkillVersion', () => {
    it('returns a version for each real bundled skill', () => {
        const bundledPath = getBundledSkillsPath();
        const dirs = fs.readdirSync(bundledPath).filter(d =>
            fs.statSync(path.join(bundledPath, d)).isDirectory()
        );

        for (const dir of dirs) {
            const skillMd = path.join(bundledPath, dir, 'SKILL.md');
            if (!fs.existsSync(skillMd)) continue;
            const version = parseBundledSkillVersion(dir);
            expect(version, `${dir} should have a parseable version`).toBeDefined();
        }
    });

    it('returns undefined for a non-existent skill', () => {
        expect(parseBundledSkillVersion('no-such-skill-xyz')).toBeUndefined();
    });
});
