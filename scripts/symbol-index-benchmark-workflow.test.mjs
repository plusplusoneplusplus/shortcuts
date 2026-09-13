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

test("platform validation builds every released native target", () => {
    for (const [runner, triple] of [
        ["ubuntu-latest", "linux-x64-gnu"],
        ["ubuntu-24.04-arm", "linux-arm64-gnu"],
        ["macos-latest", "darwin-arm64"],
        ["macos-15-intel", "darwin-x64"],
        ["windows-latest", "win32-x64-msvc"],
        ["windows-11-arm", "win32-arm64-msvc"],
    ]) {
        assert.match(workflow, new RegExp(`runner: ${runner}\\n\\s+triple: ${triple}`));
    }
    assert.match(workflow, /cargo test --manifest-path packages\/coc-native\/rust\/Cargo\.toml -p coc-native-core/);
    assert.match(workflow, /npm run build:native -w packages\/coc-native/);
});

test("platform validation runs real clangd on macOS and Windows", () => {
    assert.match(workflow, /name: clangd-\$\{\{ matrix\.label \}\}/);
    assert.match(workflow, /label: macos-arm64[\s\S]*runner: macos-latest/);
    assert.match(workflow, /label: windows-x64[\s\S]*runner: windows-latest/);
    assert.match(workflow, /brew install llvm/);
    assert.match(workflow, /choco install llvm --yes --no-progress/);
    assert.match(workflow, /clangd --version/);
    assert.match(workflow, /test\/server\/language-servers\/clangd-integration\.test\.ts/);
});

test("symbol benchmark uses the acceptance-criterion workloads", () => {
    assert.match(workflow, /--files 100000 --runs 5 --target-lines 32000 --json/);
    assert.match(workflow, /--threads 1,2,4 --warmup 1 --runs 3 \$COLD_ARG --json/);
    assert.match(workflow, /cold_arg: --drop-linux-page-cache/);
    assert.match(workflow, /label: windows-x64[\s\S]*cold_arg: ''/);
});

test("symbol benchmark pins the corpus and retains machine-readable evidence", () => {
    assert.match(workflow, /resolve-corpus:/);
    assert.match(workflow, /llvm_sha: \$\{\{ steps\.resolve\.outputs\.sha \}\}/);
    assert.match(workflow, /needs: resolve-corpus/);
    assert.match(workflow, /LLVM_SHA: \$\{\{ needs\.resolve-corpus\.outputs\.llvm_sha \}\}/);
    assert.match(workflow, /fetch --depth 1 origin "\$LLVM_SHA"/);
    assert.match(workflow, /-c core\.autocrlf=false[\s\S]*checkout --detach FETCH_HEAD/);
    assert.match(workflow, /node packages\/coc-native\/scripts\/bench-symbol-storage\.mjs/);
    assert.match(workflow, /node packages\/coc-native\/scripts\/bench-symbol-index\.mjs/);
    assert.doesNotMatch(workflow, /npm run bench:symbol/);
    assert.match(workflow, /rev-parse HEAD/);
    assert.match(workflow, /uses: actions\/upload-artifact@v4/);
    assert.match(workflow, /retention-days: 30/);
    assert.match(workflow, /GITHUB_STEP_SUMMARY/);
});
