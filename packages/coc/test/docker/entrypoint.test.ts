/**
 * Runs docker/entrypoint.sh under `sh` with fake `coc`, `git` and `curl` on
 * PATH. Covers: args reach `coc serve` verbatim, seed-not-overwrite for
 * COC_INIT_CONFIG, the idempotent first-boot marker, skills seeding, git
 * identity, COC_INIT_REPOS parsing/cloning, and workspace registration via
 * the loopback REST API. Skipped on Windows (no POSIX sh).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../../../..');
const entrypoint = path.join(repoRoot, 'docker', 'entrypoint.sh');

const FAKE_COC = `#!/bin/sh
printf '%s\\n' "$*" > "$FAKE_COC_LOG"
exit 0
`;

const FAKE_GIT = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_GIT_LOG"
case "$*" in
  *"/bad-"*) exit 128 ;;
esac
# git clone [--branch b] -- <url> <target>: create the target like a real clone would.
if [ "$1" = "clone" ]; then
  for last; do :; done
  mkdir -p "$last/.git"
fi
exit 0
`;

const FAKE_CURL = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_CURL_LOG"
case "$*" in
  *"/api/health"*) exit 0 ;;
  *"-X POST"*) exit 0 ;;
  *"/api/workspaces"*)
    if [ -n "$FAKE_EXISTING_JSON" ]; then printf '%s' "$FAKE_EXISTING_JSON"; else printf '{"workspaces":[]}'; fi
    exit 0 ;;
esac
exit 0
`;

interface Sandbox {
    root: string;
    bin: string;
    home: string;
    work: string;
    data: string;
    cocLog: string;
    gitLog: string;
    curlLog: string;
}

let sb: Sandbox;

function writeExecutable(file: string, content: string): void {
    fs.writeFileSync(file, content);
    fs.chmodSync(file, 0o755);
}

function makeSandbox(): Sandbox {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-entrypoint-'));
    const bin = path.join(root, 'bin');
    const home = path.join(root, 'home');
    const work = path.join(root, 'work');
    const data = path.join(root, 'data');
    fs.mkdirSync(bin);
    fs.mkdirSync(home);
    writeExecutable(path.join(bin, 'coc'), FAKE_COC);
    writeExecutable(path.join(bin, 'git'), FAKE_GIT);
    writeExecutable(path.join(bin, 'curl'), FAKE_CURL);
    return {
        root, bin, home, work, data,
        cocLog: path.join(root, 'coc.log'),
        gitLog: path.join(root, 'git.log'),
        curlLog: path.join(root, 'curl.log'),
    };
}

function run(args: string[], env: Record<string, string> = {}) {
    const result = spawnSync('sh', [entrypoint, ...args], {
        encoding: 'utf-8',
        timeout: 30_000,
        env: {
            PATH: `${sb.bin}${path.delimiter}${process.env.PATH ?? ''}`,
            HOME: sb.home,
            COC_WORK_DIR: sb.work,
            FAKE_COC_LOG: sb.cocLog,
            FAKE_GIT_LOG: sb.gitLog,
            FAKE_CURL_LOG: sb.curlLog,
            ...env,
        },
    });
    return result;
}

function readLog(file: string): string {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
}

const defaultArgs = () => ['--host', '127.0.0.1', '--port', '4321', '--data-dir', sb.data];

describe.skipIf(process.platform === 'win32')('docker/entrypoint.sh', () => {
    beforeEach(() => {
        sb = makeSandbox();
    });

    afterEach(() => {
        fs.rmSync(sb.root, { recursive: true, force: true });
    });

    it('execs `coc serve --no-open` with the CMD args verbatim and exits with its status', () => {
        const result = run(defaultArgs());
        expect(result.status).toBe(0);
        expect(readLog(sb.cocLog).trim()).toBe(`serve --no-open --host 127.0.0.1 --port 4321 --data-dir ${sb.data}`);
        expect(fs.existsSync(sb.data)).toBe(true);
    });

    it('creates the marker on first boot and does not touch anything without COC_INIT_* env', () => {
        run(defaultArgs());
        expect(fs.existsSync(path.join(sb.data, '.docker-init-done'))).toBe(true);
        expect(fs.existsSync(path.join(sb.data, 'config.yaml'))).toBe(false);
        expect(fs.existsSync(path.join(sb.home, '.gitconfig'))).toBe(false);
        expect(readLog(sb.gitLog)).toBe('');
        expect(readLog(sb.curlLog)).toBe('');
    });

    it('seeds config.yaml from COC_INIT_CONFIG once and never overwrites it', () => {
        const seed = path.join(sb.root, 'seed.yaml');
        fs.writeFileSync(seed, 'theme: dark\n');
        const target = path.join(sb.data, 'config.yaml');

        run(defaultArgs(), { COC_INIT_CONFIG: seed });
        expect(fs.readFileSync(target, 'utf-8')).toBe('theme: dark\n');

        // Tenant edits survive a restart.
        fs.writeFileSync(target, 'theme: light\n');
        run(defaultArgs(), { COC_INIT_CONFIG: seed });
        expect(fs.readFileSync(target, 'utf-8')).toBe('theme: light\n');

        // Marker makes seeding one-time even if the file is later removed.
        fs.unlinkSync(target);
        run(defaultArgs(), { COC_INIT_CONFIG: seed });
        expect(fs.existsSync(target)).toBe(false);
        expect(fs.existsSync(path.join(sb.data, '.docker-init-done'))).toBe(true);
    });

    it('does not overwrite a pre-existing config.yaml on first boot', () => {
        const seed = path.join(sb.root, 'seed.yaml');
        fs.writeFileSync(seed, 'theme: dark\n');
        fs.mkdirSync(sb.data, { recursive: true });
        fs.writeFileSync(path.join(sb.data, 'config.yaml'), 'theme: light\n');

        const result = run(defaultArgs(), { COC_INIT_CONFIG: seed });
        expect(fs.readFileSync(path.join(sb.data, 'config.yaml'), 'utf-8')).toBe('theme: light\n');
        expect(result.stderr).toContain('not overwriting');
    });

    it('still starts the server when COC_INIT_CONFIG points at a missing file', () => {
        const result = run(defaultArgs(), { COC_INIT_CONFIG: path.join(sb.root, 'nope.yaml') });
        expect(result.status).toBe(0);
        expect(readLog(sb.cocLog)).toContain('serve --no-open');
        expect(result.stderr).toContain('does not exist');
    });

    it('copies skills from COC_INIT_SKILLS_DIR without clobbering existing ones', () => {
        const skillsSrc = path.join(sb.root, 'skills-src');
        fs.mkdirSync(path.join(skillsSrc, 'alpha'), { recursive: true });
        fs.mkdirSync(path.join(skillsSrc, 'beta'), { recursive: true });
        fs.writeFileSync(path.join(skillsSrc, 'alpha', 'SKILL.md'), 'seeded alpha');
        fs.writeFileSync(path.join(skillsSrc, 'beta', 'SKILL.md'), 'seeded beta');
        fs.mkdirSync(path.join(sb.data, 'skills', 'beta'), { recursive: true });
        fs.writeFileSync(path.join(sb.data, 'skills', 'beta', 'SKILL.md'), 'tenant beta');

        run(defaultArgs(), { COC_INIT_SKILLS_DIR: skillsSrc });
        expect(fs.readFileSync(path.join(sb.data, 'skills', 'alpha', 'SKILL.md'), 'utf-8')).toBe('seeded alpha');
        expect(fs.readFileSync(path.join(sb.data, 'skills', 'beta', 'SKILL.md'), 'utf-8')).toBe('tenant beta');
    });

    it('writes ~/.gitconfig from GIT_AUTHOR_* only when none exists', () => {
        run(defaultArgs(), { GIT_AUTHOR_NAME: 'Tenant Bot', GIT_AUTHOR_EMAIL: 'bot@example.com' });
        const gitconfig = path.join(sb.home, '.gitconfig');
        expect(fs.readFileSync(gitconfig, 'utf-8')).toBe('[user]\n\tname = Tenant Bot\n\temail = bot@example.com\n');

        fs.writeFileSync(gitconfig, '[user]\n\tname = Someone Else\n');
        run(defaultArgs(), { GIT_AUTHOR_NAME: 'Tenant Bot', GIT_AUTHOR_EMAIL: 'bot@example.com' });
        expect(fs.readFileSync(gitconfig, 'utf-8')).toBe('[user]\n\tname = Someone Else\n');
    });

    it('parses COC_INIT_REPOS (comma/newline, url#branch, scp-style), clones missing repos, then registers them via loopback', () => {
        fs.mkdirSync(path.join(sb.work, 'already-there'), { recursive: true });
        const repos = [
            'https://github.com/org/alpha.git',
            ' https://github.com/org/beta.git#release/1.x ',
            'git@github.com:org/gamma',
            'https://github.com/org/already-there.git',
        ].join(',') + '\nhttps://github.com/org/delta/';

        const result = run(defaultArgs(), {
            COC_INIT_REPOS: repos,
            FAKE_EXISTING_JSON: JSON.stringify({ workspaces: [{ id: 'x', name: 'gamma', rootPath: path.join(sb.work, 'gamma') }] }),
        });
        expect(result.status).toBe(0);

        const gitCalls = readLog(sb.gitLog).trim().split('\n');
        expect(gitCalls).toEqual([
            `clone -- https://github.com/org/alpha.git ${path.join(sb.work, 'alpha')}`,
            `clone --branch release/1.x -- https://github.com/org/beta.git ${path.join(sb.work, 'beta')}`,
            `clone -- git@github.com:org/gamma ${path.join(sb.work, 'gamma')}`,
            `clone -- https://github.com/org/delta/ ${path.join(sb.work, 'delta')}`,
        ]);
        expect(result.stderr).toContain('already present');
        for (const name of ['alpha', 'beta', 'gamma', 'delta']) {
            expect(fs.existsSync(path.join(sb.work, name, '.git'))).toBe(true);
        }

        const curlLog = readLog(sb.curlLog);
        expect(curlLog).toContain('http://127.0.0.1:4321/api/health');
        const posts = curlLog.split('\n').filter((l) => l.includes('-X POST'));
        const registered = posts.map((l) => l.match(/"rootPath":"([^"]+)"/)?.[1]);
        expect(registered).toEqual([
            path.join(sb.work, 'alpha'),
            path.join(sb.work, 'beta'),
            path.join(sb.work, 'already-there'),
            path.join(sb.work, 'delta'),
        ]);
        expect(posts[0]).toContain(`"name":"alpha"`);
        expect(result.stderr).toContain(`workspace ${path.join(sb.work, 'gamma')} already registered`);
        // Server still exec'd with the args intact.
        expect(readLog(sb.cocLog).trim()).toBe(`serve --no-open --host 127.0.0.1 --port 4321 --data-dir ${sb.data}`);
    });

    it('a failed clone is logged, skipped for registration, and never blocks the server', () => {
        const result = run(defaultArgs(), {
            COC_INIT_REPOS: 'https://github.com/org/bad-repo.git,https://github.com/org/good.git',
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toContain('clone of https://github.com/org/bad-repo.git failed');
        expect(fs.existsSync(path.join(sb.work, 'bad-repo'))).toBe(false);
        const posts = readLog(sb.curlLog).split('\n').filter((l) => l.includes('-X POST'));
        expect(posts).toHaveLength(1);
        expect(posts[0]).toContain(`"rootPath":"${path.join(sb.work, 'good')}"`);
        expect(readLog(sb.cocLog)).toContain('serve --no-open');
    });

    it('honours --port=N / -d forms and falls back to COC_PORT for the probe', () => {
        run(['--host', '127.0.0.1', '--port=4555', '-d', sb.data], { COC_INIT_REPOS: 'https://github.com/org/one.git' });
        expect(readLog(sb.curlLog)).toContain('http://127.0.0.1:4555/api/health');
        expect(fs.existsSync(path.join(sb.data, '.docker-init-done'))).toBe(true);

        fs.rmSync(sb.curlLog, { force: true });
        run([], { COC_PORT: '4777', COC_INIT_REPOS: 'https://github.com/org/one.git' });
        expect(readLog(sb.curlLog)).toContain('http://127.0.0.1:4777/api/health');
        // No --data-dir: defaults to $HOME/.coc.
        expect(fs.existsSync(path.join(sb.home, '.coc', '.docker-init-done'))).toBe(true);
    });
});
