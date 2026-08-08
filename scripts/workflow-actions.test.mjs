import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflowDir = fileURLToPath(new URL("../.github/workflows/", import.meta.url));

// GitHub runners no longer provide Node 20, so any action still declaring
// `runs.using: node20` is force-run on Node 24 and logs a deprecation warning.
// These are the lowest majors that ship as native node24 actions.
// actions/upload-artifact and actions/download-artifact are intentionally
// absent: no released major targets node24 yet, so they still warn.
const minimumMajors = {
    "actions/cache": 5,
    "actions/checkout": 5,
    "actions/setup-node": 5,
};

function readWorkflowUses() {
    const uses = [];
    for (const file of readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name))) {
        const content = readFileSync(path.join(workflowDir, file), "utf8");
        for (const match of content.matchAll(/uses:\s*(actions\/[\w-]+)@v(\d+)/g)) {
            uses.push({ file, action: match[1], major: Number(match[2]) });
        }
    }
    return uses;
}

test("workflow actions are found in the workflow directory", () => {
    const uses = readWorkflowUses();
    assert.ok(uses.length > 0, "expected at least one actions/* reference to scan");
});

test("workflow actions avoid majors that still target the deprecated Node 20 runtime", () => {
    for (const { file, action, major } of readWorkflowUses()) {
        const minimum = minimumMajors[action];
        if (minimum === undefined) continue;
        assert.ok(
            major >= minimum,
            `${file} uses ${action}@v${major}; v${minimum} or newer is required to avoid the Node 20 deprecation warning`,
        );
    }
});

test("each action is pinned to the same major across every workflow", () => {
    const majorsByAction = new Map();
    for (const { file, action, major } of readWorkflowUses()) {
        const seen = majorsByAction.get(action);
        if (seen === undefined) {
            majorsByAction.set(action, { major, file });
            continue;
        }
        assert.equal(
            major,
            seen.major,
            `${action} is pinned to v${seen.major} in ${seen.file} but v${major} in ${file}`,
        );
    }
});
