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

// Production server composition requires the native Notes capability. Every
// workflow job that boots it must wait for and download the platform addon;
// COC_NATIVE=0 is valid only for consumers that explicitly support a fallback.
const BOOTS_THE_SERVER = ["coc-test", "e2e", "coc-serve-smoke", "docker-build-smoke"];

test("every job that boots the coc server supplies the addon", () => {
    for (const name of BOOTS_THE_SERVER) {
        const job = jobBlock(ci, name);
        assert.match(job, /^    needs: \[coc-native\]$/m, `${name} must wait for the coc-native build`);
        assert.match(job, /name: coc-native-/, `${name} must download the coc-native artifact`);
        assert.doesNotMatch(job, /COC_NATIVE[=:] ?'?0'?/, `${name} cannot disable required native Notes search`);
    }
});

test("the cross-platform coc suite uses its matching addon", () => {
    const job = jobBlock(ci, "coc-test");
    assert.match(job, /name: coc-native-\$\{\{ matrix\.os \}\}/);
});
