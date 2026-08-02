/**
 * Tests for the bundled /cron skill registration.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getBundledSkillsPath } from '@plusplusoneplusplus/forge';

describe('bundled cron skill', () => {
    it('has a SKILL.md file in the bundled-skills directory', () => {
        const skillPath = path.join(getBundledSkillsPath(), 'cron', 'SKILL.md');
        expect(fs.existsSync(skillPath)).toBe(true);
    });

    it('SKILL.md contains expected frontmatter name', () => {
        const skillPath = path.join(getBundledSkillsPath(), 'cron', 'SKILL.md');
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('name: cron');
    });

    it('SKILL.md documents the merged cron tool with create/cancel/list actions', () => {
        const skillPath = path.join(getBundledSkillsPath(), 'cron', 'SKILL.md');
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('`cron` action `create`');
        expect(content).toContain('`cron` action `cancel`');
        expect(content).toContain('`cron` action `list`');
        expect(content).not.toContain('createCron');
        expect(content).not.toContain('cancelCron');
        expect(content).not.toContain('listCrons');
    });

    it('SKILL.md documents scheduleWakeup as always available', () => {
        const skillPath = path.join(getBundledSkillsPath(), 'cron', 'SKILL.md');
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('scheduleWakeup');
    });

    it('SKILL.md documents user confirmation requirement', () => {
        const skillPath = path.join(getBundledSkillsPath(), 'cron', 'SKILL.md');
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('confirm');
    });

    it('SKILL.md documents slash-compatible fixed interval mode', () => {
        const skillPath = path.join(getBundledSkillsPath(), 'cron', 'SKILL.md');
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('Slash-Compatible Fixed Interval Mode');
        expect(content).toContain("`1m what's the time now?`");
        expect(content).toContain('Call the `cron` tool with action `create`, the parsed interval, and the remaining prompt');
        expect(content).toContain('Do not call `scheduleWakeup`');
        expect(content).toContain("the user's command is the confirmation");
    });

    it('SKILL.md documents circuit breakers', () => {
        const skillPath = path.join(getBundledSkillsPath(), 'cron', 'SKILL.md');
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('Circuit Breakers');
        expect(content).toContain('3 consecutive failures');
    });

    it('SKILL.md documents interval parsing formats', () => {
        const skillPath = path.join(getBundledSkillsPath(), 'cron', 'SKILL.md');
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('30s');
        expect(content).toContain('5m');
        expect(content).toContain('1h');
    });

    it('SKILL.md documents intent-based escalation (not hard boundary)', () => {
        const skillPath = path.join(getBundledSkillsPath(), 'cron', 'SKILL.md');
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('Intent-Based Escalation');
        expect(content).toContain('suggestion');
    });

    it('SKILL.md documents stop-condition recognition', () => {
        const skillPath = path.join(getBundledSkillsPath(), 'cron', 'SKILL.md');
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toContain('Stop-Condition');
    });
});
