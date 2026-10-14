import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ciWorkflow = fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url));

// actions/cache picks its archive format from what the job can run: zstd when
// the `zstd` binary is on PATH, gzip otherwise. That choice is baked into the
// cache *version*, so a gzip job can never restore the zstd entries the host
// runners write, even under an identical key. Container images routinely ship
// without zstd (neither mcr.microsoft.com/playwright nor node:24-bookworm has
// it), which silently demoted the e2e job to a permanent cache miss: every run
// paid a cold `npm ci` plus an apt-get, left almost no headroom under
// timeout-minutes, and any slow archive.ubuntu.com mirror failed all shards.
// So: a containerised job that caches must install zstd before it caches.

function parseJobs() {
    const lines = readFileSync(ciWorkflow, "utf8").split(/\r?\n/);
    const jobs = new Map();
    let current = null;
    for (const line of lines) {
        const jobHeader = /^ {2}([\w-]+):\s*$/.exec(line);
        if (jobHeader) {
            current = { name: jobHeader[1], lines: [] };
            jobs.set(current.name, current);
            continue;
        }
        if (current && line.trim() !== "" && !/^ {2,}/.test(line)) current = null;
        if (current) current.lines.push(line);
    }
    return [...jobs.values()];
}

// Steps are the `- ` entries under `steps:`; everything indented past the dash
// belongs to the step that opened it.
function parseSteps(job) {
    const steps = [];
    let inSteps = false;
    let current = null;
    for (const line of job.lines) {
        if (/^ {4}steps:\s*$/.test(line)) {
            inSteps = true;
            continue;
        }
        if (!inSteps) continue;
        if (/^ {6}- /.test(line)) {
            current = [];
            steps.push(current);
        }
        if (current) current.push(line);
    }
    return steps.map((step) => step.join("\n"));
}

const containerJobs = parseJobs().filter((job) =>
    job.lines.some((line) => /^ {4}container:/.test(line)),
);

test("ci.yml exposes container jobs to scan", () => {
    assert.ok(containerJobs.length > 0, "expected at least one container job in ci.yml");
});

test("container jobs install zstd before restoring any actions/cache entry", () => {
    for (const job of containerJobs) {
        const steps = parseSteps(job);
        const cacheStep = steps.findIndex((step) => /uses:\s*actions\/cache@/.test(step));
        if (cacheStep === -1) continue;

        const zstdStep = steps.findIndex((step) => /\bzstd\b/.test(step));
        assert.notEqual(
            zstdStep,
            -1,
            `job "${job.name}" runs actions/cache in a container but never installs zstd; it would silently cache as gzip and never hit the entries the host runners write`,
        );
        assert.ok(
            zstdStep < cacheStep,
            `job "${job.name}" installs zstd at step ${zstdStep} but caches at step ${cacheStep}; the install must come first or actions/cache has already chosen gzip`,
        );
    }
});

test("container jobs install zstd before setup-node primes its npm cache", () => {
    for (const job of containerJobs) {
        const steps = parseSteps(job);
        const cacheStep = steps.findIndex((step) => /uses:\s*actions\/cache@/.test(step));
        if (cacheStep === -1) continue;

        const setupNodeStep = steps.findIndex(
            (step) => /uses:\s*actions\/setup-node@/.test(step) && /cache:\s*'npm'/.test(step),
        );
        if (setupNodeStep === -1) continue;

        const zstdStep = steps.findIndex((step) => /\bzstd\b/.test(step));
        assert.notEqual(zstdStep, -1, `job "${job.name}" never installs zstd`);
        assert.ok(
            zstdStep < setupNodeStep,
            `job "${job.name}" lets setup-node restore its npm cache at step ${setupNodeStep} before zstd is installed at step ${zstdStep}`,
        );
    }
});

// The zstd install is what fetches the apt lists, and the Playwright image ships
// none. Every later apt-get install in the job free-rides on those lists, so
// dropping the update turns them into "Unable to locate package".
test("container jobs run apt-get update before their first apt-get install", () => {
    for (const job of containerJobs) {
        const steps = parseSteps(job);
        const update = steps.findIndex((step) => /apt-get[^\n]*\bupdate\b/.test(step));
        const install = steps.findIndex((step) => /apt-get[^\n]*\binstall\b/.test(step));
        if (install === -1) continue;

        assert.notEqual(update, -1, `job "${job.name}" runs apt-get install with no apt-get update`);
        assert.ok(
            update <= install,
            `job "${job.name}" installs packages at step ${install} before apt-get update at step ${update}`,
        );
    }
});

function runZstdSetup(updateFailures = 0, installFailures = 0) {
    const job = containerJobs.find((job) => job.name === "e2e");
    const step = parseSteps(job).find((step) => /name: Install zstd for cache archive compatibility/.test(step));
    const lines = step.split("\n");
    const runIndex = lines.findIndex((line) => /^ {8}run: /.test(line));
    const run = lines[runIndex].slice("        run: ".length);
    const script = run === "|" ? lines.slice(runIndex + 1).map((line) => line.replace(/^ {10}/, "")).join("\n") : run;
    const dir = mkdtempSync(join(tmpdir(), "e2e-zstd-"));
    try {
        const stateFile = join(dir, "state.json");
        const logFile = join(dir, "calls.jsonl");
        writeFileSync(stateFile, JSON.stringify({ updateFailures, installFailures, ready: false }));
        writeFileSync(logFile, "");
        const stub = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const command = args.includes('update') ? 'update' : 'install';
fs.appendFileSync(process.env.LOG_FILE, JSON.stringify([command, ...args]) + '\\n');
const state = JSON.parse(fs.readFileSync(process.env.STATE_FILE, 'utf8'));
let code = 0;
if (command === 'update') {
    state.ready = state.updateFailures-- <= 0;
    // Without strict update mode apt tolerates mirror DNS failures with exit 0.
    if (!state.ready && args.includes('APT::Update::Error-Mode=any')) code = 100;
} else if (!state.ready || state.installFailures-- > 0) code = 100;
fs.writeFileSync(process.env.STATE_FILE, JSON.stringify(state));
process.exit(code);
`;
        writeFileSync(join(dir, "apt-get"), stub);
        writeFileSync(join(dir, "sleep"), `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.LOG_FILE, JSON.stringify(['sleep', ...process.argv.slice(2)]) + '\\n');
`);
        chmodSync(join(dir, "apt-get"), 0o755);
        chmodSync(join(dir, "sleep"), 0o755);
        const result = spawnSync("sh", ["-e", "-c", script], {
            env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, STATE_FILE: stateFile, LOG_FILE: logFile },
            encoding: "utf8", timeout: 5000,
        });
        assert.ifError(result.error);
        const calls = readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
        return { status: result.status, calls };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const skipShell = process.platform === "win32" ? "apt bootstrap runs in Linux containers" : false;

test("zstd setup succeeds without sleeping when mirrors are available", { skip: skipShell }, () => {
    const { status, calls } = runZstdSetup();
    assert.equal(status, 0);
    assert.deepEqual(calls.map(([command]) => command), ["update", "install"]);
});

test("zstd setup retries DNS failures without installing from missing indexes", { skip: skipShell }, () => {
    const { status, calls } = runZstdSetup(1);
    assert.equal(status, 0);
    assert.deepEqual(calls.map(([command]) => command), ["update", "sleep", "update", "install"]);
    assert.ok(calls[0].includes("APT::Update::Error-Mode=any"));
});

test("zstd setup retries package download failures", { skip: skipShell }, () => {
    const { status, calls } = runZstdSetup(0, 1);
    assert.equal(status, 0);
    assert.deepEqual(calls.map(([command]) => command), ["update", "install", "sleep", "update", "install"]);
});

for (const [phase, updateFailures, installFailures] of [["update", 10, 0], ["install", 0, 10]]) {
    test(`zstd setup fails after three persistent ${phase} failures`, { skip: skipShell }, () => {
        const { status, calls } = runZstdSetup(updateFailures, installFailures);
        assert.equal(status, 1);
        assert.equal(calls.filter(([command]) => command === phase).length, 3);
        assert.deepEqual(calls.filter(([command]) => command === "sleep"), [["sleep", "10"], ["sleep", "20"]]);
        if (phase === "update") assert.equal(calls.filter(([command]) => command === "install").length, 0);
    });
}
