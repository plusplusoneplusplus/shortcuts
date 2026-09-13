import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

/** A top-level job's body, from its `  <name>:` line to the next job's. */
function jobBlock(name) {
    const lines = workflow.split("\n");
    const start = lines.indexOf(`  ${name}:`);
    assert.notEqual(start, -1, `release.yml has no job named ${name}`);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^ {2}[\w-]+:$/.test(lines[i])) {
            end = i;
            break;
        }
    }
    return lines.slice(start, end).join("\n");
}

test("release workflow can be dispatched for an existing tag", () => {
    assert.match(workflow, /workflow_dispatch:\n\s+inputs:\n\s+tag:/);
    assert.match(workflow, /ref: \$\{\{ github\.event\.inputs\.tag \|\| github\.ref \}\}/);
    assert.match(workflow, /TAG: \$\{\{ github\.event\.inputs\.tag \|\| github\.ref_name \}\}/);
});

test("release workflow accepts stable and prerelease version tags", () => {
    assert.match(workflow, /'v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'/);
    assert.match(workflow, /'v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+-\*'/);
});

test("release workflow publishes prereleases and keeps stable releases draft", () => {
    assert.match(workflow, /IS_PRERELEASE=true[\s\S]*PRERELEASE_FLAG="--prerelease"[\s\S]*DRAFT_FLAGS=\(\)/);
    assert.match(workflow, /IS_PRERELEASE=false[\s\S]*PRERELEASE_FLAG=""[\s\S]*DRAFT_FLAGS=\(--draft\)/);
    assert.match(workflow, /gh release create "\$TAG"[\s\S]*"\$\{DRAFT_FLAGS\[@\]\}"[\s\S]*\$PRERELEASE_FLAG/);
});

test("release workflow heredoc content stays inside the YAML run block", () => {
    assert.doesNotMatch(workflow, /^>/m);
    assert.doesNotMatch(workflow, /^## Install/m);
    assert.doesNotMatch(workflow, /^EOF$/m);
});

test("release workflow builds the native addon on all six supported targets", () => {
    const job = jobBlock("build-native");
    const targets = [
        ["ubuntu-latest", "linux-x64-gnu"],
        ["ubuntu-24.04-arm", "linux-arm64-gnu"],
        ["macos-latest", "darwin-arm64"],
        ["macos-15-intel", "darwin-x64"],
        ["windows-latest", "win32-x64-msvc"],
        ["windows-11-arm", "win32-arm64-msvc"],
    ];

    for (const [runner, triple] of targets) {
        assert.match(
            job,
            new RegExp(`- runner: ${runner}\\n\\s+triple: ${triple}`),
            `${triple} must build on ${runner}`,
        );
    }
});

test("desktop builds download only the native addon for their architecture", () => {
    assert.match(jobBlock("build-mac"), /name: coc-native-darwin-arm64/);
    assert.doesNotMatch(jobBlock("build-mac"), /pattern: coc-native-darwin-\*/);
    assert.match(jobBlock("build-win"), /name: coc-native-win32-x64-msvc/);
    assert.doesNotMatch(jobBlock("build-win"), /pattern: coc-native-win32-\*/);
});

test("release artifacts cannot bypass the required native addon", () => {
    assert.doesNotMatch(workflow, /allow_native_fallback/);
    for (const name of ["build-mac", "build-win", "build-docker"]) {
        const job = jobBlock(name);
        assert.match(job, /^    needs: \[dependency-security, build-native\]$/m);
        assert.doesNotMatch(job, /needs\.build-native\.result|if: >-/);
        assert.match(job, /Download native addon binaries/);
        assert.match(job, /Stage native addon binaries/);
    }
});

test("release image smoke requires both native indexes", () => {
    const job = jobBlock("build-docker");
    assert.match(job, /!h\.nativeFileIndex\?\.loaded \|\| !h\.nativeNotesIndex\?\.loaded/);
    assert.match(job, /native file index: loaded/);
    assert.match(job, /native Notes index: loaded/);
});

// The release page ships installers only. The coc-native-* artifacts are the
// raw N-API binaries the build jobs feed to electron-builder (already packed
// inside each installer), and CoCContainer is an internal variant.
test("release attaches only the CoC installers", () => {
    assert.match(workflow, /pattern: coc-\{mac,win\}/);
    assert.match(workflow, /find artifacts -type f \\\( -name '\*\.dmg' -o -name '\*\.exe' \\\)/);
    assert.match(workflow, /! -name 'CoCContainer\*' ! -name '\*\.node'/);
    assert.doesNotMatch(workflow, /### Windows — CoCContainer/);
});
