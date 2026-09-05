import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
