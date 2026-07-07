/**
 * Tests for repo-schedule-loader.ts
 *
 * Covers: parsing YAML files, applying overrides, invalid files,
 * missing directory, source field, ID generation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadRepoSchedulesAsync, idFromScheduleFilename, getRepoScheduleDir } from '../src/server/schedule/repo-schedule-loader';

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'repo-schedule-loader-test-'));
}

function writeScheduleFile(scheduleDir: string, filename: string, content: string): void {
    fs.mkdirSync(scheduleDir, { recursive: true });
    fs.writeFileSync(path.join(scheduleDir, filename), content, 'utf-8');
}

describe('idFromScheduleFilename', () => {
    it('prefixes stem with repo:', async () => {
        expect(idFromScheduleFilename('daily-cleanup.yaml')).toBe('repo:daily-cleanup');
        expect(idFromScheduleFilename('weekly-report.yml')).toBe('repo:weekly-report');
    });

    it('handles filenames without extension', async () => {
        expect(idFromScheduleFilename('myschedule')).toBe('repo:myschedule');
    });
});

describe('getRepoScheduleDir', () => {
    it('returns correct path', async () => {
        const result = getRepoScheduleDir('/my/repo');
        expect(result).toBe(path.join('/my/repo', '.github', 'schedules'));
    });
});

describe('loadRepoSchedules', () => {
    let tmpDir: string;
    let scheduleDir: string;

    beforeEach(() => {
        tmpDir = makeTmpDir();
        scheduleDir = path.join(tmpDir, '.github', 'schedules');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty array if directory does not exist', async () => {
        const result = await loadRepoSchedulesAsync(tmpDir);
        expect(result).toEqual([]);
    });

    it('returns empty array if directory is empty', async () => {
        fs.mkdirSync(scheduleDir, { recursive: true });
        const result = await loadRepoSchedulesAsync(tmpDir);
        expect(result).toEqual([]);
    });

    it('parses a basic schedule file', async () => {
        writeScheduleFile(scheduleDir, 'daily-cleanup.yaml', `
name: Daily Cleanup
cron: "0 0 * * *"
target: .github/workflows/cleanup.yaml
`);
        const result = await loadRepoSchedulesAsync(tmpDir);
        expect(result).toHaveLength(1);
        const s = result[0];
        expect(s.id).toBe('repo:daily-cleanup');
        expect(s.name).toBe('Daily Cleanup');
        expect(s.cron).toBe('0 0 * * *');
        expect(s.target).toBe('.github/workflows/cleanup.yaml');
        expect(s.source).toBe('repo');
        expect(s.status).toBe('paused');
        expect(s.targetType).toBe('prompt');
        expect(s.onFailure).toBe('notify');
        expect(s.mode).toBe('autopilot');
    });

    it('sets source: "repo" on all entries', async () => {
        writeScheduleFile(scheduleDir, 'sched.yaml', `
name: My Schedule
cron: "*/5 * * * *"
`);
        const result = await loadRepoSchedulesAsync(tmpDir);
        expect(result[0].source).toBe('repo');
    });

    it('applies runtime status override', async () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', `
name: Daily
cron: "0 9 * * *"
`);
        const result = await loadRepoSchedulesAsync(tmpDir, { 'repo:daily': { status: 'active' } });
        expect(result[0].status).toBe('active');
    });

    it('YAML status is overridden by runtime override', async () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', `
name: Daily
cron: "0 9 * * *"
status: paused
`);
        // override takes precedence
        const result = await loadRepoSchedulesAsync(tmpDir, { 'repo:daily': { status: 'active' } });
        expect(result[0].status).toBe('active');
    });

    it('defaults to paused even when YAML has status: paused', async () => {
        writeScheduleFile(scheduleDir, 'daily.yaml', `
name: Daily
cron: "0 9 * * *"
status: paused
`);
        const result = await loadRepoSchedulesAsync(tmpDir);
        expect(result[0].status).toBe('paused');
    });

    it('parses all supported fields', async () => {
        writeScheduleFile(scheduleDir, 'full.yaml', `
name: Full Schedule
cron: "0 12 * * 1"
target: scripts/run.sh
targetType: script
onFailure: stop
mode: plan
outputFolder: /tmp/output
model: gpt-4
params:
  ENV: production
  BRANCH: main
`);
        const result = await loadRepoSchedulesAsync(tmpDir);
        expect(result).toHaveLength(1);
        const s = result[0];
        expect(s.targetType).toBe('script');
        expect(s.onFailure).toBe('stop');
        expect(s.mode).toBe('ask');
        expect(s.outputFolder).toBe('/tmp/output');
        expect(s.model).toBe('gpt-4');
        expect(s.params).toEqual({ ENV: 'production', BRANCH: 'main' });
    });

    it('skips files missing required name field', async () => {
        writeScheduleFile(scheduleDir, 'invalid.yaml', `
cron: "0 0 * * *"
`);
        const result = await loadRepoSchedulesAsync(tmpDir);
        expect(result).toHaveLength(0);
    });

    it('skips files missing required cron field', async () => {
        writeScheduleFile(scheduleDir, 'invalid.yaml', `
name: Missing Cron
`);
        const result = await loadRepoSchedulesAsync(tmpDir);
        expect(result).toHaveLength(0);
    });

    it('skips non-YAML files', async () => {
        writeScheduleFile(scheduleDir, 'readme.md', '# README');
        writeScheduleFile(scheduleDir, 'config.json', '{"name": "bad"}');
        writeScheduleFile(scheduleDir, 'good.yaml', 'name: Good\ncron: "0 0 * * *"');
        const result = await loadRepoSchedulesAsync(tmpDir);
        expect(result).toHaveLength(1);
    });

    it('returns files in sorted order by filename', async () => {
        writeScheduleFile(scheduleDir, 'z-last.yaml', 'name: Last\ncron: "0 0 * * *"');
        writeScheduleFile(scheduleDir, 'a-first.yaml', 'name: First\ncron: "0 1 * * *"');
        const result = await loadRepoSchedulesAsync(tmpDir);
        expect(result[0].id).toBe('repo:a-first');
        expect(result[1].id).toBe('repo:z-last');
    });

    it('handles .yml extension', async () => {
        writeScheduleFile(scheduleDir, 'myfile.yml', 'name: YML Schedule\ncron: "0 0 * * *"');
        const result = await loadRepoSchedulesAsync(tmpDir);
        expect(result[0].id).toBe('repo:myfile');
    });

    it('skips invalid YAML gracefully', async () => {
        writeScheduleFile(scheduleDir, 'bad.yaml', ': invalid: yaml: [unclosed');
        writeScheduleFile(scheduleDir, 'good.yaml', 'name: Good\ncron: "* * * * *"');
        const result = await loadRepoSchedulesAsync(tmpDir);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Good');
    });
});
