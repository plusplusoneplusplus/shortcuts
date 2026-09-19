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
        assert.match(job, /^    needs: \[coc-native[,\]]/m, `${name} must wait for the coc-native build`);
        assert.match(job, /name: coc-native-/, `${name} must download the coc-native artifact`);
        assert.doesNotMatch(job, /COC_NATIVE[=:] ?'?0'?/, `${name} cannot disable the addon — the COC_NATIVE=0 opt-out is gone`);
    }
});

// `build:native` produces two artifacts: the dlopen'd addon and the spawned
// `coc-symbols-lsp` stdio server. Once the HTTP symbol-index lane was removed,
// that server became the only thing answering C-family navigation — so an
// upload that carries just *.node leaves the e2e suite peeking at an index
// nobody built, and the resolver calls it "not built for this platform".
// release.yml already ships both; this is the same invariant for CI.
test("the coc-native artifact carries the symbols language server too", () => {
    const job = jobBlock(ci, "coc-native");
    assert.match(job, /path: \|\n\s+packages\/coc-native\/\*\.node\n\s+packages\/coc-native\/coc-symbols-lsp\.\*/,
        "the upload must list the symbols server beside the addon");
});

// `if-no-files-found: error` only fires when every pattern misses, so an upload
// listing two binaries stays green having shipped one. That is not theoretical:
// the coc-native suite runs the real `buildSymbolsLsp` against this directory,
// and a version of it removed the server afterwards — the artifact uploaded
// fine and the e2e suite failed four jobs later on a peek that never opened.
// The check belongs between the suite and the upload, or it proves nothing.
test("the coc-native job verifies both binaries after the suite and before the upload", () => {
    const job = jobBlock(ci, "coc-native");
    const tests = job.indexOf("npm run test:run -w packages/coc-native");
    const verify = job.indexOf("ls packages/coc-native/coc-symbols-lsp.*");
    const upload = job.indexOf("uses: actions/upload-artifact@v4");
    assert.notEqual(verify, -1, "coc-native must verify the symbols server exists");
    assert.match(job, /ls packages\/coc-native\/\*\.node/, "coc-native must verify the addon exists");
    assert.ok(tests < verify, "the verification must run after the suite that can delete a binary");
    assert.ok(verify < upload, "the verification must run before the upload");
});

// Artifact download does not preserve the executable bit. The addon is loaded
// with dlopen and does not need one; this binary is spawned, and without the
// chmod it fails at exec with EACCES — which the host reports as a server that
// would not start, a long way from the packaging step that caused it.
test("every job that spawns the symbols language server restores its executable bit", () => {
    for (const name of ["e2e"]) {
        const job = jobBlock(ci, name);
        const download = job.indexOf("name: coc-native-");
        const chmod = job.indexOf("chmod +x packages/coc-native/coc-symbols-lsp");
        assert.notEqual(chmod, -1, `${name} must chmod +x the symbols language server`);
        assert.ok(download < chmod, `${name} must download the artifact before the chmod`);
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
//
// Only the jobs that still name both steps are in this list. coc-test unpacks
// the tarball build-shared produced; build-shared and e2e both delegate the
// ordering to a prebuild.mjs (forge's and packages/coc's), whose
// REQUIRED_BUILD_WORKSPACES order prebuild.test.ts checks against the real
// package.json dependency edges. scripts/shared-build-workflow.test.mjs pins
// that those jobs really do go through prebuild.
const BUILDS_THE_SDK = ["forge-test", "deep-wiki-test"];

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

// A container job runs git as root against a checkout the runner user owns, so
// git rejects the repository for dubious ownership. `git diff` does not report
// that as an error — it falls back to `--no-index`, prints its usage and exits
// non-zero, which the bindings check reads as a stale generated file. Any job
// that both runs in a container and runs git against the workspace has to mark
// it safe first.
test('a containerised job trusts the workspace before running git on it', () => {
    const job = jobBlock(ci, 'coc-native');
    assert.match(job, /container: \$\{\{ matrix\.container \}\}/);
    const trust = job.indexOf('safe.directory');
    const usesGit = job.indexOf('git diff --exit-code');
    assert.notEqual(trust, -1, 'coc-native must mark the workspace safe.directory');
    assert.ok(trust < usesGit, 'the workspace must be trusted before git reads it');
});

// ── The serve loop's addon freshness check ────────────────────────────────────

// Nothing in the local build path compiles the Rust addon: `coc:link` never
// mentions it, and coc-native's `build` is plain tsc. Without ensure:native the
// daemon restarts onto whatever `.node` happens to be on disk — stale, or on a
// fresh clone absent, which the loader treats as fatal.
test('both serve loops refresh the addon before building the packages', () => {
    for (const loop of ['coc-serve-loop.sh', 'coc-serve-loop.ps1']) {
        const script = readFileSync(new URL(`./${loop}`, import.meta.url), 'utf8');
        const ensure = script.indexOf('npm run ensure:native');
        const link = script.indexOf('npm run coc:link');
        assert.notEqual(ensure, -1, `${loop} must run npm run ensure:native`);
        assert.notEqual(link, -1, `${loop} must run npm run coc:link`);
        assert.ok(ensure < link, `${loop} must refresh the addon before coc:link`);
    }
});

test('the Windows service installer builds the addon before registering a build-skipping task', () => {
    const script = readFileSync(new URL('./Manage-CoCService.ps1', import.meta.url), 'utf8');
    const initialBuild = script.indexOf('=== Running initial build ===');
    const ensure = script.indexOf('npm run ensure:native', initialBuild);
    const link = script.indexOf('npm run coc:link', initialBuild);
    const register = script.indexOf('Register-ScheduledTask', initialBuild);

    assert.notEqual(initialBuild, -1, 'Manage-CoCService.ps1 must have an initial build');
    assert.notEqual(ensure, -1, 'the initial build must build or verify the mandatory addon');
    assert.notEqual(link, -1, 'the initial build must link the CoC packages');
    assert.notEqual(register, -1, 'the installer must register the scheduled task');
    assert.ok(ensure < link, 'the addon must be ready before coc:link');
    assert.ok(link < register, 'the complete build must finish before task registration');
});

test('the root package exposes the ensure:native passthrough the loops call', () => {
    const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(root.scripts['ensure:native'], 'npm run ensure:native -w packages/coc-native');
});

test('coc:link builds coc-native before packages that import it', () => {
    const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const link = root.scripts['coc:link'];
    const native = link.indexOf('cd packages/coc-native && npm run build');
    const sdk = link.indexOf('cd ../coc-agent-sdk && npm run build');

    assert.notEqual(native, -1, 'coc:link must build the coc-native TypeScript package');
    assert.notEqual(sdk, -1, 'coc:link must build coc-agent-sdk');
    assert.ok(native < sdk, 'coc-native dist must exist before coc-agent-sdk compiles against it');
});

// The invariant `build-native.mjs` documents in its header: the TypeScript
// build compiles the committed `native-bindings.ts` and must never need cargo.
// Hooking the addon into `build` would put a Rust toolchain on the critical
// path of every `npm run build:packages`.
test('the coc-native TypeScript build stays free of the Rust toolchain', () => {
    const pkg = JSON.parse(readFileSync(new URL('../packages/coc-native/package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.scripts.build, 'tsc');
    assert.equal(pkg.scripts['ensure:native'], 'node scripts/ensure-native.mjs');
});
