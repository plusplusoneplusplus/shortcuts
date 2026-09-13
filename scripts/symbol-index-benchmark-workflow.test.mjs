import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
    new URL("../.github/workflows/symbol-index-benchmark.yml", import.meta.url),
    "utf8",
);

test("symbol benchmark is manually dispatched on Linux and Windows", () => {
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /runner: ubuntu-latest/);
    assert.match(workflow, /runner: windows-latest/);
    assert.match(workflow, /timeout-minutes: 90/);
});

test("symbol benchmark uses the acceptance-criterion workloads", () => {
    assert.match(workflow, /--files 100000 --runs 5 --target-lines 32000 --json/);
    assert.match(workflow, /--threads 1,2,4 --warmup 1 --runs 3 \$COLD_ARG --json/);
    assert.match(workflow, /cold_arg: --drop-linux-page-cache/);
    assert.match(workflow, /label: windows-x64[\s\S]*cold_arg: ''/);
});

test("symbol benchmark pins the corpus and retains machine-readable evidence", () => {
    assert.match(workflow, /git clone --depth 1 --branch "\$LLVM_REF"/);
    assert.match(workflow, /rev-parse HEAD/);
    assert.match(workflow, /uses: actions\/upload-artifact@v4/);
    assert.match(workflow, /retention-days: 30/);
    assert.match(workflow, /GITHUB_STEP_SUMMARY/);
});
