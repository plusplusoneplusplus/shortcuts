import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const auditScript = fileURLToPath(new URL("./ci-npm-audit.sh", import.meta.url));

for (const lockfile of ["../package-lock.json", "./skillopt/package-lock.json"]) {
    test(`${lockfile} excludes vulnerable redirect, Vite and re2js releases, including nested copies`, () => {
        const lock = JSON.parse(readFileSync(new URL(lockfile, import.meta.url), "utf8"));
        for (const [path, pkg] of Object.entries(lock.packages)) {
            if (/(^|\/)node_modules\/follow-redirects$/.test(path)) {
                assert.notEqual(pkg.version, "1.16.0", `${path}: redirect credential disclosure`);
            }
            if (/(^|\/)node_modules\/vite$/.test(path)) {
                const [major, minor, patch] = pkg.version.split(".").map(Number);
                if (major === 8) {
                    const vulnerable = minor === 0 || (minor === 1 && patch <= 5)
                        || (minor === 2 && patch <= 3) || (minor === 3 && patch <= 2);
                    assert.ok(!vulnerable, `${path}: launch-editor injection`);
                }
            }
            if (/(^|\/)node_modules\/re2js$/.test(path)) {
                const [major, minor, patch] = pkg.version.split(".").map(Number);
                const vulnerable = major === 2 && minor >= 2
                    && (minor < 8 || (minor === 8 && patch < 7));
                assert.ok(!vulnerable, `${path}: quadratic lookbehind matching (GHSA-gg6h-894w-4m9c)`);
            }
        }
    });
}

// The gate only fires through `npm audit`, so every case here runs the real
// script against a stub `npm` placed first on PATH.
const STUB_NPM = `#!/usr/bin/env bash
echo "$*" >> "$STUB_CALLS"
if [[ "$STUB_FAIL_REPEAT" == "1" && $(wc -l < "$STUB_CALLS") -gt 1 ]]; then
    echo "npm error audit endpoint returned an error" >&2
    exit 1
fi
if [[ "$STUB_ENDPOINT_FIRST" == "1" && $(wc -l < "$STUB_CALLS") -eq 1 ]]; then
    echo '{"error":{"summary":"audit endpoint returned an error"}}'
    echo "npm warn audit network timeout" >&2
    exit 1
fi
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

function runAudit({ mode, ghsaIds = [], json, env = {}, args = [] }) {
    const dir = mkdtempSync(join(tmpdir(), "ci-npm-audit-"));
    try {
        const stub = join(dir, "npm");
        writeFileSync(stub, STUB_NPM);
        chmodSync(stub, 0o755);

        const jsonPath = join(dir, "audit.json");
        writeFileSync(jsonPath, json ?? auditJson(...ghsaIds));
        const callsPath = join(dir, "calls.txt");

        const childEnv = {
            ...process.env,
            PATH: `${dir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
            STUB_MODE: mode,
            STUB_JSON: jsonPath,
            STUB_CALLS: callsPath,
            CI_AUDIT_ATTEMPTS: "1",
            CI_AUDIT_DELAY: "0",
            ...env,
        };
        // An inherited allowlist would silently change what these cases assert.
        if (!("AUDIT_ALLOWLIST" in env)) delete childEnv.AUDIT_ALLOWLIST;
        for (const key of ["NODE_ENV", "npm_config_omit", "npm_config_only", "npm_config_production"]) {
            if (!(key in env)) delete childEnv[key];
        }

        const result = spawnSync("bash", [auditScript, ...args], { env: childEnv, encoding: "utf8" });
        const calls = readFileSync(callsPath, "utf8").trim().split("\n");
        return { status: result.status, output: `${result.stdout || ""}${result.stderr || ""}`, calls };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const skip = process.platform === "win32" ? "ci-npm-audit.sh is a bash script (Linux/macOS CI only)" : false;

test("passes when npm audit reports nothing at or above the gate", { skip }, () => {
    assert.equal(runAudit({ mode: "clean" }).status, 0);
});

// Unknown advisories must still fail even when reviewed dev exceptions exist.
test("fails on an unreviewed blocking advisory", { skip }, () => {
    const { status } = runAudit({ mode: "vuln", ghsaIds: ["GHSA-aaaa-bbbb-cccc"] });
    assert.notEqual(status, 0);
});

const reviewedAdvisories = ["GHSA-vfj7-8cjw-p6xm"];

test("uses the same JSON report for the gate and reviewed exceptions without another endpoint request", { skip }, () => {
    const { status, calls } = runAudit({
        mode: "vuln", ghsaIds: reviewedAdvisories, env: { STUB_FAIL_REPEAT: "1" },
    });
    assert.equal(status, 0);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /--json/);
});

test("retries a JSON endpoint error before classifying the next report", { skip }, () => {
    for (const reviewed of [true, false]) {
        const { status, calls, output } = runAudit({
            mode: "vuln", ghsaIds: reviewed ? reviewedAdvisories : ["GHSA-aaaa-bbbb-cccc"],
            env: { STUB_ENDPOINT_FIRST: "1", CI_AUDIT_ATTEMPTS: "2" },
        });
        assert.equal(status, reviewed ? 0 : 1);
        assert.equal(calls.length, 2);
        assert.ok(calls.every(call => call.includes("--json")));
        assert.match(output, /advisory endpoint error \(attempt 1\/2\)/);
    }
});

test("rejects malformed reports and advisories with an available patch", { skip }, () => {
    assert.notEqual(runAudit({ mode: "vuln", json: "invalid JSON" }).status, 0);
    assert.notEqual(runAudit({ mode: "vuln", ghsaIds: ["GHSA-ch52-4w7c-c8xp"] }).status, 0);
});

test("locks http-cache-semantics outside the affected range", () => {
    const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
    let found = false;
    for (const [path, pkg] of Object.entries(lock.packages)) {
        if (/(^|\/)node_modules\/http-cache-semantics$/.test(path)) {
            found = true;
            const [major, minor] = pkg.version.split(".").map(Number);
            assert.ok(major > 4 || (major === 4 && minor >= 3), `${path}: max-stale cache disclosure`);
        }
    }
    assert.ok(found);
});

test("accepts only the reviewed development advisories by default", { skip }, () => {
    assert.equal(runAudit({ mode: "vuln", ghsaIds: reviewedAdvisories }).status, 0);
    assert.notEqual(runAudit({
        mode: "vuln", ghsaIds: [...reviewedAdvisories, "GHSA-aaaa-bbbb-cccc"],
    }).status, 0);
    assert.notEqual(runAudit({
        mode: "vuln", ghsaIds: reviewedAdvisories, env: { AUDIT_ALLOWLIST: "" },
    }).status, 0);
});

test("rejects reviewed advisories in production audits", { skip }, () => {
    for (const args of [["--omit=dev"], ["--omit=optional,dev"], ["--omit", "dev"], ["--production"], ["--only=prod"]]) {
        const { status, output } = runAudit({ mode: "vuln", ghsaIds: reviewedAdvisories, args });
        assert.notEqual(status, 0, args.join(" "));
        assert.doesNotMatch(output, /reviewed allowlist/);
    }
    for (const env of [{ NODE_ENV: "production" }, { npm_config_omit: "dev" },
        { npm_config_only: "production" }, { npm_config_production: "true" }]) {
        assert.notEqual(runAudit({ mode: "vuln", ghsaIds: reviewedAdvisories, env }).status, 0);
    }
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
