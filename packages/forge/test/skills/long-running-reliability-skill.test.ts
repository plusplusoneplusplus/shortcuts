import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import {
    autoInstallDefaultSkills,
    getBundledSkillsPath,
    getBundledSkillsRegistry,
} from '../../src/skills/bundled-skills-provider';

const tempDirs: string[] = [];
const SKILL_NAME = 'long-running-reliability';

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('long-running-reliability bundled skill', () => {
    it('is registered with stable metadata and packaged resources', () => {
        const entry = getBundledSkillsRegistry().find(skill => skill.name === SKILL_NAME);
        expect(entry).toMatchObject({
            name: SKILL_NAME,
            relativePath: SKILL_NAME,
        });

        const skillFile = path.join(getBundledSkillsPath(), SKILL_NAME, 'SKILL.md');
        expect(fs.existsSync(skillFile)).toBe(true);
        const content = fs.readFileSync(skillFile, 'utf-8').replace(/\r\n/g, '\n');
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        expect(match).toBeTruthy();
        expect(yaml.parse(match![1])).toMatchObject({
            name: SKILL_NAME,
            description: entry!.description,
            metadata: {
                author: 'CoC',
                version: '0.0.1',
            },
        });
    });

    it('documents the three roles, safety boundaries, helper lifecycle, and generic invocation', () => {
        const skillFile = path.join(getBundledSkillsPath(), SKILL_NAME, 'SKILL.md');
        const content = fs.readFileSync(skillFile, 'utf-8');

        for (const required of [
            'Ask supervisor',
            'exactly one Autopilot or Ralph writer',
            'external durable watchdog',
            '6-hour',
            '1-hour',
            'three consecutive',
            'immediate recheck',
            'duplicate writer',
            'split-brain',
            'exact standalone',
            'bounded wait',
            'targeted cancellation',
            'Ralph resume',
            'Autopilot continuation',
            'approved server restart',
            'coc reliability-watchdog start',
            'coc reliability-watchdog status',
            'coc reliability-watchdog stop',
            'PR-ready',
        ]) {
            expect(content, required).toContain(required);
        }

        expect(content).not.toMatch(/\/home\/|[A-Z]:\\\\Users\\\\|ws-v2-|queue_\d|xStore|Storage-XStore/i);
        expect(content).toContain('every pending target wakeup');
        expect(content).not.toContain('future pending target wakeup');
        expect(content).not.toContain('cannot race');
    });

    it('auto-installs the complete packaged skill into a fresh global directory', async () => {
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reliability-skill-'));
        tempDirs.push(installDir);

        const result = await autoInstallDefaultSkills(installDir, [SKILL_NAME]);

        expect(result).toMatchObject({ installed: [SKILL_NAME], errors: [] });
        expect(fs.readFileSync(path.join(installDir, SKILL_NAME, 'SKILL.md'), 'utf-8')).toBe(
            fs.readFileSync(path.join(getBundledSkillsPath(), SKILL_NAME, 'SKILL.md'), 'utf-8'),
        );
    });
});
