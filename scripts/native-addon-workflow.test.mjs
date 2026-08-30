import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

/** A top-level job's body, from its `  <name>:` line to the next job's. */
function jobBlock(workflow, name) {
    const lines = workflow.split("\n");
    const start = lines.indexOf(`  ${name}:`);
    assert.notEqual(start, -1, `ci.yml has no job named ${name}`);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^ {2}[\w-]+:$/.test(lines[i])) {
            end = i;
            break;
        }
    }
    return lines.slice(start, end).join("\n");
}

// The addon is mandatory — production server composition requires the native
// Notes capability, and repo listing and file search have no JavaScript lane.
// Every workflow job that boots the server must wait for and download the
// platform addon, and nothing may reintroduce a COC_NATIVE=0 opt-out.
const BOOTS_THE_SERVER = ["coc-test", "e2e", "coc-serve-smoke", "docker-build-smoke"];

test("every job that boots the coc server supplies the addon", () => {
    for (const name of BOOTS_THE_SERVER) {
        const job = jobBlock(ci, name);
        assert.match(job, /^    needs: \[coc-native\]$/m, `${name} must wait for the coc-native build`);
        assert.match(job, /name: coc-native-/, `${name} must download the coc-native artifact`);
        assert.doesNotMatch(job, /COC_NATIVE[=:] ?'?0'?/, `${name} cannot disable the addon — the COC_NATIVE=0 opt-out is gone`);
    }
});

test("the cross-platform coc suite uses its matching addon", () => {
    const job = jobBlock(ci, "coc-test");
    assert.match(job, /name: coc-native-\$\{\{ matrix\.os \}\}/);
});

// coc-agent-sdk and forge compile against @plusplusoneplusplus/coc-native, and
// its dist/ is generated, not committed — so a job that runs `tsc` over either
// before building the addon package fails with TS2307 rather than a test
// failure. Ordering, not just presence, is what the build depends on.
const BUILDS_THE_SDK = ["forge-test", "coc-test", "deep-wiki-test", "e2e"];

test("every job that builds coc-agent-sdk builds the addon package first", () => {
    for (const name of BUILDS_THE_SDK) {
        const job = jobBlock(ci, name);
        const native = job.indexOf("- name: Build coc-native package");
        const sdk = job.indexOf("- name: Build coc-agent-sdk package");
        assert.notEqual(native, -1, `${name} must build the coc-native package`);
        assert.notEqual(sdk, -1, `${name} must build the coc-agent-sdk package`);
        assert.ok(native < sdk, `${name} must build coc-native before coc-agent-sdk`);
    }
});

// The forge and deep-wiki suites read git through the addon, and it has no
// JavaScript lane — without the binary every git test throws
// NativeAddonLoadError instead of running.
const READS_GIT_NATIVELY = ["forge-test", "deep-wiki-test"];

test("the suites that read git natively download the addon", () => {
    for (const name of READS_GIT_NATIVELY) {
        const job = jobBlock(ci, name);
        assert.match(job, /^    needs: \[coc-native\]$/m, `${name} must wait for the coc-native build`);
        assert.match(job, /name: coc-native-\$\{\{ matrix\.os \}\}/, `${name} must download its platform addon`);
    }
});

// The addon spawns processes, so Rust std records a GLIBC_2.39 dependency on it
// when it is built against the runner's glibc — and the server image is older
// than that, which is a "version `GLIBC_2.39' not found" at startup rather than
// a test failure. The linux binary has to be built against the image's own
// glibc, in both workflows, or the one we ship cannot load it.
test('the linux addon is built against the glibc the image ships', () => {
    const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
    for (const [name, workflow, job] of [
        ['ci.yml', ci, 'coc-native'],
        ['release.yml', release, 'build-native'],
    ]) {
        const block = jobBlock(workflow, job);
        assert.match(block, /^    container: \$\{\{ matrix\.container \}\}$/m,
            `${name}: ${job} must honour a per-entry container`);
        const linux = block.split('\n').filter(line => /container: node:\d+-bookworm/.test(line));
        assert.ok(linux.length > 0, `${name}: the linux entry must build in a bookworm container`);
    }
});

test('every linux build entry names a container', () => {
    const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
    // One `- runner: ubuntu-*` per linux triple, each followed by a container.
    const entries = jobBlock(release, 'build-native').split(/\n(?=          - )/).slice(1);
    for (const entry of entries.filter(e => /runner: ubuntu/.test(e))) {
        assert.match(entry, /container: node:\d+-bookworm/,
            `a linux release entry builds without the bookworm container:\n${entry}`);
    }
});
