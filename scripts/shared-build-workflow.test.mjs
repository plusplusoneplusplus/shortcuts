import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// coc-test's fifteen shards used to repeat the same seven-step build prelude,
// and e2e's four shards repeated it too -- on top of `Build coc package`, which
// runs scripts/prebuild.mjs and rebuilds every one of those packages anyway.
// The prelude now happens once, in `build-shared`, and ships as a single
// tarball. These tests pin the three things that make that safe:
//
//   1. build-shared is not gated behind coc-native, so coc-test starts no later
//      than it did before.
//   2. the tarball carries every workspace dist/ the coc suite resolves at
//      runtime -- which is exactly the packages vitest.config.ts does *not*
//      alias to src/.
//   3. neither consumer has quietly grown its build steps back.

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const ci = readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");

/** A top-level job's body, from its `  <name>:` line to the next job's. */
function jobBlock(name) {
    const lines = ci.split(/\r?\n/);
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

const buildShared = jobBlock("build-shared");
const cocTest = jobBlock("coc-test");
const e2e = jobBlock("e2e");

// ---------------------------------------------------------------------------
// The build job itself
// ---------------------------------------------------------------------------

// The whole point of a separate build job is that it costs coc-test nothing in
// start time. Gating it on coc-native (a Rust build, by far the longest job in
// the graph) would serialise it behind that and make coc-test start later than
// it did when it built its own prelude. Nothing here compiles against the
// addon's `.node` binary -- `Build coc-native package` is plain tsc over src/.
test("build-shared runs beside coc-native rather than behind it", () => {
    assert.doesNotMatch(
        buildShared,
        /^ {4}needs:/m,
        "build-shared must not declare `needs`; a gate on coc-native would delay every coc-test shard",
    );
});

// One ubuntu build serves the macOS and Windows shards. That holds only while
// the output stays platform-independent, so a second `runs-on` here would mean
// somebody found a reason it does not -- and that reason belongs in a comment,
// not in a silent matrix.
test("build-shared is a single ubuntu job, not one per OS", () => {
    assert.match(buildShared, /^ {4}runs-on: ubuntu-latest$/m);
    assert.doesNotMatch(buildShared, /^ {4}strategy:/m);
});

// upload-artifact is dominated by per-file overhead, and the SPA bundle alone
// is ~1600 files. Uploading the directories raw costs more than the build time
// being removed; one .tar.gz does not.
test("build-shared uploads one tarball, not loose directories", () => {
    assert.match(buildShared, /tar -czf shared-build\.tar\.gz/);
    const uploadPath = /name: shared-build\n\s+path: (?<path>\S+)\n/.exec(buildShared);
    assert.ok(uploadPath, "build-shared must upload an artifact named shared-build");
    assert.equal(uploadPath.groups.path, "shared-build.tar.gz");
    assert.match(buildShared, /retention-days: 1/);
});

/** The dist paths listed in build-shared's `tar -czf` invocation. */
function packedPaths() {
    const tar = /tar -czf shared-build\.tar\.gz \\\n(?<body>(?: +\S+ ?\\?\n)+)/.exec(buildShared);
    assert.ok(tar, "could not parse build-shared's tar invocation");
    return tar.groups.body
        .split("\n")
        .map((line) => line.replace(/\\$/, "").trim())
        .filter(Boolean);
}

/** The `@plusplusoneplusplus/*` names in a prebuild.mjs REQUIRED_BUILD_WORKSPACES. */
function requiredBuildWorkspaces(pkg) {
    const source = readFileSync(
        path.join(repoRoot, "packages", pkg, "scripts", "prebuild.mjs"),
        "utf8",
    );
    const list = /REQUIRED_BUILD_WORKSPACES = \[(?<body>[^\]]+)\]/.exec(source);
    assert.ok(list, `could not read REQUIRED_BUILD_WORKSPACES from packages/${pkg}/scripts/prebuild.mjs`);
    return [...list.groups.body.matchAll(/@plusplusoneplusplus\/([\w-]+)/g)].map((m) => m[1]);
}

// build-shared has two build steps, but packs six directories: `npm run build`
// in packages/forge runs forge's prebuild first, which builds coc-native,
// coc-agent-sdk, coc-workflow and coc-memory. That is load-bearing and easy to
// lose -- if forge ever drops its prebuild, the tarball would ship four empty
// slots and every coc-test shard would fail on a runner. Tie the packed list to
// what the job can actually produce.
test("every packed path is something a step in the job produces", () => {
    const explicit = [...buildShared.matchAll(/working-directory: packages\/([\w-]+)$/gm)].map(
        (m) => m[1],
    );
    const produced = new Set(explicit);
    if (explicit.includes("forge")) {
        for (const pkg of requiredBuildWorkspaces("forge")) produced.add(pkg);
    }

    for (const packed of packedPaths()) {
        const pkg = /^packages\/(?<pkg>[\w-]+)\//.exec(packed);
        assert.ok(pkg, `packed path ${packed} is not under packages/`);
        assert.ok(
            produced.has(pkg.groups.pkg),
            `build-shared packs ${packed}, but no step in the job builds packages/${pkg.groups.pkg} ` +
                `-- not directly, and not through forge's prebuild either`,
        );
    }
});

// ---------------------------------------------------------------------------
// The payload covers what the coc suite actually resolves
// ---------------------------------------------------------------------------

/** The `find:` values of packages/coc's vitest resolve aliases. */
function vitestAliases() {
    const config = readFileSync(path.join(repoRoot, "packages", "coc", "vitest.config.ts"), "utf8");
    return [...config.matchAll(/find: '(?<find>@plusplusoneplusplus\/[^']+)'/g)].map(
        (m) => m.groups.find,
    );
}

/**
 * Every `@plusplusoneplusplus/*` specifier packages/coc *statically* imports
 * from src/ or test/.
 *
 * Static only, on purpose. `vi.mock()` registers a stub before the specifier is
 * ever resolved, and the deep-wiki lane behind `src/server/wiki` builds its
 * module path from a template literal inside a try/catch precisely so a missing
 * install degrades instead of throwing. Neither needs a dist/ on the runner, and
 * neither has ever had one there.
 */
function cocWorkspaceImports() {
    const found = new Set();
    const roots = ["src", "test"].map((dir) => path.join(repoRoot, "packages", "coc", dir));
    const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
            const full = path.join(dir, entry);
            if (statSync(full).isDirectory()) {
                if (entry !== "node_modules" && entry !== "dist") walk(full);
                continue;
            }
            if (!/\.(ts|tsx|mts)$/.test(entry)) continue;
            const source = readFileSync(full, "utf8");
            const statik = /(?:\bfrom\s*|^\s*import\s*|\brequire\s*\(\s*)['"](@plusplusoneplusplus\/[\w./-]+)['"]/gm;
            for (const m of source.matchAll(statik)) {
                found.add(m[1]);
            }
        }
    };
    for (const root of roots) walk(root);
    return [...found].sort();
}

// This is the invariant the whole payload list rests on. A specifier the coc
// suite imports is satisfied either by a vitest alias pointing at src/ (no
// build needed) or by that package's dist/ riding in the tarball. Adding an
// import of a package that has neither -- say `coc-connector/whatsapp`, which
// the current aliases do not cover -- makes every coc-test shard fail with
// ERR_MODULE_NOT_FOUND on a runner and nowhere else. It fails here instead.
test("every workspace package the coc suite imports is aliased to src or packed", () => {
    const aliases = vitestAliases();
    const packedPackages = new Set(
        packedPaths().map((packed) => /^packages\/([\w-]+)\//.exec(packed)[1]),
    );

    for (const specifier of cocWorkspaceImports()) {
        // Vite matches a string alias as a prefix, so `coc-client` covers its
        // subpaths and the longest matching alias is what actually resolves.
        const aliased = aliases.some(
            (find) => specifier === find || specifier.startsWith(`${find}/`),
        );
        if (aliased) continue;

        const pkg = specifier.split("/")[1];
        assert.ok(
            packedPackages.has(pkg),
            `packages/coc imports "${specifier}", which no vitest alias redirects to src/, ` +
                `but build-shared does not pack packages/${pkg}/dist -- coc-test would fail to resolve it`,
        );
    }
});

// The flip side: a package that *is* fully aliased must not be packed. Building
// and shipping a dist/ nothing reads is the waste this change exists to remove,
// and it is invisible once it is in the tarball.
test("no fully aliased package is packed into the shared build", () => {
    const aliases = vitestAliases();
    const imports = cocWorkspaceImports();
    for (const packed of packedPaths()) {
        const pkg = /^packages\/([\w-]+)\//.exec(packed)[1];
        const specifiers = imports.filter((s) => s.split("/")[1] === pkg);
        if (specifiers.length === 0) continue;
        const allAliased = specifiers.every((specifier) =>
            aliases.some((find) => specifier === find || specifier.startsWith(`${find}/`)),
        );
        assert.ok(
            !allAliased,
            `build-shared packs packages/${pkg}/dist, but vitest aliases every specifier the coc ` +
                `suite imports from it to src/ -- nothing reads that dist, so drop it from the tar`,
        );
    }
});

// The SPA bundle is not a package dist: test/server/spa-test-helpers.ts and
// test/server/queue-resolved-prompt.test.ts read
// src/server/spa/client/dist/bundle.js off disk, so the esbuild output has to
// travel with the tarball or those tests hit ENOENT.
test("the shared build carries the SPA client bundle", () => {
    assert.ok(
        packedPaths().includes("packages/coc/src/server/spa/client/dist"),
        "the coc suite reads src/server/spa/client/dist/bundle.js from disk",
    );
});

// ---------------------------------------------------------------------------
// The consumers
// ---------------------------------------------------------------------------

test("coc-test downloads the shared build instead of rebuilding it", () => {
    assert.match(cocTest, /^ {4}needs: \[coc-native, build-shared\]$/m);
    assert.match(cocTest, /name: shared-build\n/);
    assert.match(cocTest, /tar -xzf shared-build\.tar\.gz/);
});

// bsdtar on windows-latest reads gzip fine, but only `shell: bash` resolves the
// relative tarball path the way the linux and macOS runners do -- the default
// pwsh shell is a different lane and does not need to be a second one.
test("coc-test unpacks the shared build through bash on every runner", () => {
    const unpack = /- name: Unpack the shared build output\n(?<body>(?: {8}.*\n)+)/.exec(cocTest);
    assert.ok(unpack, "coc-test must have an unpack step");
    assert.match(unpack.groups.body, /shell: bash/);
});

// The regression this change exists to prevent: fifteen shards each paying for
// the same tsc and esbuild runs.
test("coc-test runs no package build steps of its own", () => {
    assert.doesNotMatch(
        cocTest,
        /^ {6}- name: Build /m,
        "coc-test must not rebuild anything; the shared-build artifact is the build",
    );
});

// e2e boots the real server, so it needs packages/coc's own dist/ and every
// workspace dist/ -- but `npm run build` in packages/coc already produces all of
// them, because npm runs scripts/prebuild.mjs first and that walks
// REQUIRED_BUILD_WORKSPACES. The seven steps that used to precede it rebuilt
// exactly what it rebuilds a moment later.
test("e2e builds only the coc package and lets prebuild do the rest", () => {
    const builds = [...e2e.matchAll(/^ {6}- name: (Build .*)$/gm)].map((m) => m[1]);
    assert.deepEqual(builds, ["Build coc package"]);
});

test("prebuild still covers every workspace e2e stopped building explicitly", () => {
    const prebuild = readFileSync(
        path.join(repoRoot, "packages", "coc", "scripts", "prebuild.mjs"),
        "utf8",
    );
    const list = /REQUIRED_BUILD_WORKSPACES = \[(?<body>[^\]]+)\]/.exec(prebuild);
    assert.ok(list, "could not read REQUIRED_BUILD_WORKSPACES from prebuild.mjs");
    for (const pkg of ["coc-native", "coc-agent-sdk", "forge", "coc-client", "coc-memory", "coc-connector"]) {
        assert.match(
            list.groups.body,
            new RegExp(`@plusplusoneplusplus/${pkg}'`),
            `e2e no longer builds ${pkg} explicitly, so prebuild.mjs must still build it`,
        );
    }
});
