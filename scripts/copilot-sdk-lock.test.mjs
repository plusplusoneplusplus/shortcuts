import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const lock = JSON.parse(readFileSync(new URL("package-lock.json", root), "utf8"));
const sdkVersion = "1.0.9";
const cliVersion = "1.0.78";

test("CoC installs the pinned Copilot SDK and CLI on every platform", () => {
    assert.equal(manifest.dependencies["@github/copilot-sdk"], sdkVersion);
    assert.equal(manifest.overrides["@github/copilot"], cliVersion);

    for (const workspace of ["coc-agent-sdk", "coc", "forge", "deep-wiki"]) {
        const pkg = JSON.parse(readFileSync(new URL(`packages/${workspace}/package.json`, root), "utf8"));
        const dependency = pkg.dependencies?.["@github/copilot-sdk"] ?? pkg.peerDependencies?.["@github/copilot-sdk"];
        assert.equal(dependency, sdkVersion, workspace);
        const locked = lock.packages[`packages/${workspace}`];
        assert.equal(
            locked.dependencies?.["@github/copilot-sdk"] ?? locked.peerDependencies?.["@github/copilot-sdk"],
            sdkVersion,
            `${workspace} lock entry`,
        );
    }

    const sdk = lock.packages["node_modules/@github/copilot-sdk"];
    const cli = lock.packages["node_modules/@github/copilot"];
    assert.equal(sdk.version, sdkVersion);
    assert.equal(cli.version, cliVersion);
    assert.equal(sdk.dependencies["@github/copilot"], "^1.0.78");
    for (const [name, version] of Object.entries(cli.optionalDependencies)) {
        assert.equal(version, cliVersion, name);
        assert.equal(lock.packages[`node_modules/${name}`]?.version, cliVersion, name);
    }
});
