import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { autoInstallDefaultSkills } from '@plusplusoneplusplus/forge';
import { mirrorBundledSkillToClaude } from '../../../src/server/skills/claude-skill-mirror';
import { mirrorBundledSkillToCodex } from '../../../src/server/skills/codex-skill-mirror';

describe('long-running-reliability provider mirrors', () => {
    let tempDir: string;
    let skillsDir: string;
    let originalClaudeHome: string | undefined;
    let originalCodexHome: string | undefined;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reliability-mirror-'));
        skillsDir = path.join(tempDir, 'coc-skills');
        originalClaudeHome = process.env.CLAUDE_HOME;
        originalCodexHome = process.env.CODEX_HOME;
        process.env.CLAUDE_HOME = path.join(tempDir, 'claude');
        process.env.CODEX_HOME = path.join(tempDir, 'codex');
        const installed = await autoInstallDefaultSkills(skillsDir, ['long-running-reliability']);
        expect(installed.installed).toEqual(['long-running-reliability']);
    });

    afterEach(() => {
        if (originalClaudeHome === undefined) delete process.env.CLAUDE_HOME;
        else process.env.CLAUDE_HOME = originalClaudeHome;
        if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = originalCodexHome;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('mirrors the installed bundled skill to Claude and Codex', async () => {
        await expect(mirrorBundledSkillToClaude(skillsDir, 'long-running-reliability')).resolves.toMatchObject({
            status: 'copied',
        });
        await expect(mirrorBundledSkillToCodex(skillsDir, 'long-running-reliability')).resolves.toMatchObject({
            status: 'copied',
        });

        const claudeCommand = path.join(process.env.CLAUDE_HOME!, 'commands', 'long-running-reliability.md');
        const codexSkill = path.join(process.env.CODEX_HOME!, 'skills', 'long-running-reliability', 'SKILL.md');
        expect(fs.readFileSync(claudeCommand, 'utf-8')).toContain('coc reliability-watchdog');
        expect(fs.readFileSync(codexSkill, 'utf-8')).toContain('coc reliability-watchdog');
    });
});
