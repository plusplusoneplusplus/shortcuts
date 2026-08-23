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

// `RepoTreeService` loads the addon in its constructor and throws when it
// cannot, so a job that starts the server has to either hand it a binary or say
// out loud that it is running without one. A job with neither does not degrade
// to the fallback — it fails to boot, which is how e2e, coc-serve-smoke and
// docker-build-smoke all went red at once.
const BOOTS_THE_SERVER = ["coc-test", "e2e", "coc-serve-smoke", "docker-build-smoke"];

test("every job that boots the coc server supplies the addon or opts out", () => {
    for (const name of BOOTS_THE_SERVER) {
        const job = jobBlock(ci, name);
        const suppliesAddon = /name: coc-native-/.test(job);
        const optsOut = /COC_NATIVE[=:] ?'?0'?/.test(job);
        assert.ok(
            suppliesAddon || optsOut,
            `${name} neither downloads the coc-native artifact nor sets COC_NATIVE=0, so the server will refuse to start`,
        );
    }
});

test("the addon itself is still exercised, not opted out of everywhere", () => {
    // The opt-out is convenient enough that CI could drift into using it
    // everywhere and stop testing the native path at all. coc-test is the job
    // that must keep running against a real binary.
    const job = jobBlock(ci, "coc-test");
    assert.match(job, /name: coc-native-\$\{\{ matrix\.os \}\}/);
    assert.doesNotMatch(job, /COC_NATIVE/);
});
