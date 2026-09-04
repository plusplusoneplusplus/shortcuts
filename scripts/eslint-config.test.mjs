import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ESLint } from "eslint";

import eslintConfig from "../eslint.config.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// The non-blocking-request-io guard used to live in .eslintrc.json `overrides`.
// The flat-config migration (eslint 10) could silently drop it: a `files`
// pattern that no longer matches produces no error, just no protection. These
// tests keep the guard wired up.
const GUARD_ENTRY = eslintConfig.find(
    (entry) => entry.rules && entry.rules["no-restricted-syntax"],
);

const GUARDED_FILES = GUARD_ENTRY?.files ?? [];

test("the non-blocking-request-io guard lists files", () => {
    assert.ok(GUARD_ENTRY, "no config entry configures no-restricted-syntax");
    assert.ok(GUARDED_FILES.length > 0, "the guard matches no files");
});

test("every guarded path still exists", () => {
    for (const relPath of GUARDED_FILES) {
        assert.ok(
            existsSync(join(repoRoot, relPath)),
            `guarded file no longer exists: ${relPath} (update eslint.config.mjs)`,
        );
    }
});

test("synchronous I/O is an error in guarded files", async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const source = [
        "import fs from 'node:fs';",
        "import { execSync } from 'node:child_process';",
        "export const read = () => fs.readFileSync('a');",
        "export const bare = () => readFileSync('a');",
        "export const run = () => execSync('ls');",
        "",
    ].join("\n");

    for (const relPath of GUARDED_FILES) {
        const [result] = await eslint.lintText(source, {
            filePath: join(repoRoot, relPath),
        });
        const guardErrors = result.messages.filter(
            (message) =>
                message.ruleId === "no-restricted-syntax" && message.severity === 2,
        );
        assert.equal(
            guardErrors.length,
            3,
            `expected 3 sync-I/O errors in ${relPath}, got ${guardErrors.length}`,
        );
    }
});

test("synchronous I/O is allowed outside guarded files", async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const [result] = await eslint.lintText("export const read = () => require('node:fs').readFileSync('a');\n", {
        filePath: join(repoRoot, "packages/forge/src/__eslint-guard-probe.ts"),
    });
    const guardErrors = result.messages.filter(
        (message) => message.ruleId === "no-restricted-syntax",
    );
    assert.equal(guardErrors.length, 0);
});

test("TypeScript sources are linted by the flat config", async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const [result] = await eslint.lintText("if (1 == 1) console.log('x');\n", {
        filePath: join(repoRoot, "packages/forge/src/__eslint-probe.ts"),
    });
    const ruleIds = result.messages.map((message) => message.ruleId);
    assert.ok(ruleIds.includes("eqeqeq"), `eqeqeq did not fire: ${ruleIds.join(", ")}`);
    assert.ok(ruleIds.includes("curly"), `curly did not fire: ${ruleIds.join(", ")}`);
});
