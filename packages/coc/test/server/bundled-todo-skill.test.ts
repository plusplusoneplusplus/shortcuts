import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    autoInstallDefaultSkills,
    getBundledSkillsPath,
    getBundledSkillsRegistry,
    parseBundledSkillVersion,
} from '@plusplusoneplusplus/forge';
import { DEFAULT_BUNDLED_SKILLS, DEFAULT_CONFIG } from '../../src/config';
import { getDefaultSkillsToInstall } from '../../src/server/skills/default-skill-selection';

describe('bundled todo skill', () => {
    const skillPath = path.join(getBundledSkillsPath(), 'todo', 'SKILL.md');
    const content = fs.readFileSync(skillPath, 'utf-8');
    const body = content.replace(/\r\n/g, '\n').replace(/\s+/g, ' ');

    it('registers a bundled skill with matching metadata and a version', () => {
        const entry = getBundledSkillsRegistry().find(skill => skill.name === 'todo');
        expect(entry?.relativePath).toBe('todo');
        expect(content).toMatch(/^---\r?\nname: todo\r?\n/);
        expect(content).toContain(`description: ${entry?.description}`);
        expect(parseBundledSkillVersion('todo')).toBe('0.0.1');
    });

    it('stays compact', () => {
        expect(content.split(/\r?\n/).length).toBeLessThanOrEqual(60);
    });

    it('states the authorization, tracking, launch and failure contracts', () => {
        for (const phrase of [
            'A bare `/todo` means ask what the task is',
            'Listing or tracking alone never authorizes execution',
            'Use `sentinel_todos` and `send_to_conversation`',
            'Do not work around it by writing files or calling the API',
            'List items first',
            'Never execute, copy, or convert a manual item',
            'Do not reopen a Done item unless the user clearly asks for more work',
            '`completionCondition` to the final outcome',
            'stable `idempotencyKey`',
            '`targetRepo`',
            'keep existing notes, references, and the latest user verdicts',
            'revision conflict',
            'queued or running work for this task, do not launch again',
            '`todoItemId` and no `processId`',
            '`ralph` only when the user asks for it',
            'Provider: `auto` unless the user picks one',
            'Do not infer publishing, deploying, or schedules',
            'Tracking fails: do not launch',
            'Launch fails: keep the item open and record the gap',
            'Launch result unknown: check the item and its conversations before any retry',
            'Return the generated link unchanged',
            'Never mark the item Done because a launch started',
        ]) {
            expect(body).toContain(phrase);
        }
    });

    it('installs by default without requiring cron or canvas features', () => {
        expect(DEFAULT_BUNDLED_SKILLS).toContain('todo');
        expect(getDefaultSkillsToInstall(DEFAULT_CONFIG.skills.defaultSkills, {
            cronEnabled: false,
            canvasEnabled: false,
        })).toContain('todo');
    });

    it('copies the bundled skill on startup and preserves an up-to-date installation', async () => {
        const installPath = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-skill-'));
        try {
            const defaults = getDefaultSkillsToInstall(DEFAULT_CONFIG.skills.defaultSkills, {
                cronEnabled: false,
                canvasEnabled: false,
            });
            const result = await autoInstallDefaultSkills(installPath, defaults);
            expect(result.errors).toEqual([]);
            expect(result.installed).toContain('todo');
            const installedPath = path.join(installPath, 'todo', 'SKILL.md');
            expect(fs.readFileSync(installedPath, 'utf-8')).toBe(content);
            const repeated = await autoInstallDefaultSkills(installPath, ['todo']);
            expect(repeated).toEqual({ installed: [], skipped: ['todo'], errors: [] });
        } finally {
            fs.rmSync(installPath, { recursive: true, force: true });
        }
    });
});
