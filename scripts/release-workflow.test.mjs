import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

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
