import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const auditScript = fileURLToPath(new URL("./ci-npm-audit.sh", import.meta.url));

// The gate only fires through `npm audit`, so every case here runs the real
// script against a stub `npm` placed first on PATH.
const STUB_NPM = `#!/usr/bin/env bash
case "$STUB_MODE" in
    clean)
        echo "found 0 vulnerabilities"
        exit 0
        ;;
    endpoint)
        echo "npm error audit endpoint returned an error"
        exit 1
        ;;
    vuln)
        if [[ "$*" == *--json* ]]; then
            cat "$STUB_JSON"
        else
            echo "# npm audit report"
            echo "1 high severity vulnerability"
        fi
        exit 1
        ;;
esac
exit 1
`;

function auditJson(...ghsaIds) {
    const via = ghsaIds.map((id, i) => ({
        source: 1000 + i,
        severity: "high",
        url: `https://github.com/advisories/${id}`,
    }));
    return JSON.stringify({ vulnerabilities: { "some-pkg": { severity: "high", via } } });
}

function runAudit({ mode, ghsaIds = [], env = {} }) {
    const dir = mkdtempSync(join(tmpdir(), "ci-npm-audit-"));
    try {
        const stub = join(dir, "npm");
        writeFileSync(stub, STUB_NPM);
        chmodSync(stub, 0o755);

        const jsonPath = join(dir, "audit.json");
        writeFileSync(jsonPath, auditJson(...ghsaIds));

        const childEnv = {
            ...process.env,
            PATH: `${dir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
            STUB_MODE: mode,
            STUB_JSON: jsonPath,
            CI_AUDIT_ATTEMPTS: "1",
            CI_AUDIT_DELAY: "0",
            ...env,
        };
        // An inherited allowlist would silently change what these cases assert.
        if (!("AUDIT_ALLOWLIST" in env)) delete childEnv.AUDIT_ALLOWLIST;

        const result = spawnSync("bash", [auditScript], { env: childEnv, encoding: "utf8" });
        return { status: result.status, output: `${result.stdout || ""}${result.stderr || ""}` };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const skip = process.platform === "win32" ? "ci-npm-audit.sh is a bash script (Linux/macOS CI only)" : false;

test("passes when npm audit reports nothing at or above the gate", { skip }, () => {
    assert.equal(runAudit({ mode: "clean" }).status, 0);
});

// Regression guard: the allowlist ships empty, so a blocking advisory must fail
// the build. A stale or over-broad entry would silently disable the gate.
test("fails on a blocking advisory when the allowlist is empty", { skip }, () => {
    const { status } = runAudit({ mode: "vuln", ghsaIds: ["GHSA-aaaa-bbbb-cccc"] });
    assert.notEqual(status, 0);
});

test("passes only when every blocking advisory is allowlisted", { skip }, () => {
    const allowed = runAudit({
        mode: "vuln",
        ghsaIds: ["GHSA-aaaa-bbbb-cccc"],
        env: { AUDIT_ALLOWLIST: "GHSA-aaaa-bbbb-cccc" },
    });
    assert.equal(allowed.status, 0);
    assert.match(allowed.output, /reviewed allowlist/);

    const partial = runAudit({
        mode: "vuln",
        ghsaIds: ["GHSA-aaaa-bbbb-cccc", "GHSA-dddd-eeee-ffff"],
        env: { AUDIT_ALLOWLIST: "GHSA-aaaa-bbbb-cccc" },
    });
    assert.notEqual(partial.status, 0);
});

test("treats an advisory-endpoint outage as a transient failure, not a vulnerability", { skip }, () => {
    const { status, output } = runAudit({ mode: "endpoint" });
    assert.equal(status, 0);
    assert.match(output, /advisory endpoint unavailable/);
});
