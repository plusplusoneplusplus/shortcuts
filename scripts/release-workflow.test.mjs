import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

test("release runs Rust, Teams and auth SDK/CLI suites once with SDK-scoped features", () => {
    const job = jobBlock("build-native");
    const commands = [...job.matchAll(/^\s+run: (cargo test [^\n]+)/gm)].map(match => match[1]);
    assert.equal(commands.length, 1);
    const command = commands[0];
    assert.match(command, /--locked\b/);
    assert.match(command, /--manifest-path packages\/coc-native\/rust\/Cargo\.toml\b/);
    assert.deepEqual([...command.matchAll(/-p (\S+)/g)].map(match => match[1]).sort(),
        ["auth-cli", "auth-sdk", "coc-native-core", "teams-cli", "teams-sdk"]);
    assert.doesNotMatch(command, /--all-features|--no-default-features/);

    const sdk = readFileSync(new URL("../packages/coc-native/rust/teams-sdk/Cargo.toml", import.meta.url), "utf8");
    const features = sdk.match(/\[features\]\n([\s\S]*?)(?=\n\[)/)[1];
    const expected = [...features.matchAll(/^([\w-]+) =/gm)]
        .map(match => match[1]).filter(name => name !== "default")
        .map(name => `teams-sdk/${name}`).sort();
    const actual = command.match(/--features (\S+)/)[1].split(",").sort();
    assert.deepEqual(actual, expected, "enable every SDK feature without enabling the core's N-API feature");
    assert.ok(job.indexOf(command) < job.indexOf("npm run build:native -w packages/coc-native"));
});

test("release workflow ships the symbols language server with the addon", () => {
    // One build job produces both artifacts, and every consumer resolves them
    // from the same `prebuilt/<triple>/` directory. A release that uploads only
    // the addon leaves C-family navigation with clangd alone — which returns
    // empty for cross-TU definitions on the repositories this targets.
    const job = jobBlock("build-native");
    assert.match(job, /coc-symbols-lsp\.\$\{\{ matrix\.triple \}\}/, "the binary must be uploaded");
    assert.match(job, /coc-symbols-lsp\.\$\{\{ matrix\.triple \}\}\.exe/, "Windows names it .exe");
    assert.match(job, /ls "packages\/coc-native\/coc-symbols-lsp/, "the build must verify it exists");

    for (const [name, triple] of [
        ["build-mac", "darwin-arm64"],
        ["build-win", "win32-x64-msvc"],
        ["build-docker", "linux-x64-gnu"],
    ]) {
        const suffix = triple.startsWith("win32") ? "\\.exe" : "";
        assert.match(
            jobBlock(name),
            new RegExp(`prebuilt/${triple}/coc-symbols-lsp\\.${triple}${suffix}`),
            `${name} must verify the staged ${triple} language server`,
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

// The release page ships installers and their checksums. The coc-native-* artifacts are the
// raw N-API binaries the build jobs feed to electron-builder (already packed
// inside each installer), and CoCContainer is an internal variant.
test("release attaches only the CoC installers and their checksums", () => {
    assert.match(workflow, /pattern: coc-\{mac,win\}/);
    assert.match(workflow, /find artifacts -type f \\\( -name '\*\.dmg' -o -name '\*\.exe' \\\)/);
    assert.match(workflow, /! -name 'CoCContainer\*' ! -name '\*\.node'/);
    assert.doesNotMatch(workflow, /### Windows — CoCContainer/);
});

// Execute the actual release shell with fixture artifacts and a local gh stub.
// This job runs on Ubuntu, so its GNU shell/tooling checks are Linux-only.
function runRelease(t, artifacts, failHash = false) {
    const dir = mkdtempSync(path.join(tmpdir(), "coc-release-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(path.join(dir, "artifacts"));
    mkdirSync(path.join(dir, "bin"));
    for (const [name, content] of Object.entries(artifacts)) {
        writeFileSync(path.join(dir, "artifacts", name), content);
    }
    const gh = path.join(dir, "bin", "gh");
    writeFileSync(gh, '#!/bin/bash\nprintf "%s\\0" "$@" > "$RELEASE_ARGS"\n');
    chmodSync(gh, 0o755);
    if (failHash) {
        const hash = path.join(dir, "bin", "sha256sum");
        writeFileSync(hash, "#!/bin/bash\necho 'checksum read failed' >&2\nexit 1\n");
        chmodSync(hash, 0o755);
    }
    const block = jobBlock("create-release");
    const script = block.slice(block.indexOf("        run: |\n") + "        run: |\n".length)
        .split("\n").map(line => line.replace(/^ {10}/, "")).join("\n");
    const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
            TAG: "v3.5.2", OWNER: "fixture", TMPDIR: dir, RELEASE_ARGS: path.join(dir, "args") },
    });
    return { dir, result };
}

test("release uploads matching SHA-256 sidecars for every installer and excludes internal assets", {
    skip: process.platform !== "linux",
}, t => {
    const installers = { "CoC-3.5.2-arm64.dmg": "mac installer", "CoC Setup 3.5.2.exe": "windows installer" };
    const { dir, result } = runRelease(t, {
        ...installers, "CoCContainer.Setup.exe": "private", "CoCContainer.dmg": "private mac",
        "coc.node": "native", "latest.yml": "metadata", "CoC Setup 3.5.2.exe.sha256": "stale",
    });
    assert.equal(result.status, 0, result.stderr);
    const args = readFileSync(path.join(dir, "args"), "utf8").split("\0").filter(Boolean);
    const expected = Object.keys(installers).flatMap(name => [`artifacts/${name}`, `artifacts/${name}.sha256`]).sort();
    assert.deepEqual(args.filter(arg => arg.startsWith("artifacts/")).sort(), expected);
    for (const [name, content] of Object.entries(installers)) {
        const digest = createHash("sha256").update(content).digest("hex");
        assert.equal(readFileSync(path.join(dir, "artifacts", `${name}.sha256`), "utf8"), `${digest}  ${name}\n`);
    }
    assert.ok(args.includes("--draft"));
    assert.equal(existsSync(path.join(dir, "artifacts", "CoCContainer.Setup.exe.sha256")), false);
});

test("release refuses to publish without eligible installers", { skip: process.platform !== "linux" }, t => {
    const { dir, result } = runRelease(t, { "CoCContainer.Setup.exe": "private", "coc.node": "native" });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /No artifacts were downloaded/);
    assert.equal(existsSync(path.join(dir, "args")), false);
});

test("release refuses to publish when checksum generation fails", { skip: process.platform !== "linux" }, t => {
    const { dir, result } = runRelease(t, { "CoC.dmg": "installer" }, true);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum read failed/);
    assert.equal(existsSync(path.join(dir, "args")), false);
});
