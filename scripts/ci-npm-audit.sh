#!/usr/bin/env bash
#
# CI-safe wrapper around `npm audit`.
#
# `npm audit` talks to npm's advisory endpoint
# (registry.npmjs.org/-/npm/v1/security/advisories/bulk). When that endpoint has
# a transient outage it returns HTTP 503 and npm exits non-zero with
# "audit endpoint returned an error" — failing the build even though nothing is
# wrong with our dependencies. This wrapper retries those transient endpoint
# errors with exponential backoff and, if the endpoint stays down for the whole
# window, warns and passes (an npm infrastructure outage must not block merges).
#
# Beyond transient endpoint retries, it keeps the security gate strict: a real
# vulnerability at/above --audit-level fails the build. The ONE exception is a
# small, hand-reviewed allowlist of advisory GHSA IDs (see AUDIT_ALLOWLIST
# below) for which no fixed version is reachable yet. Those entries are dev-only,
# and the production audit (`--omit=dev`, run separately in CI) passes on its own
# and therefore never reaches the allowlist branch — so production stays fully
# strict. If npm reports any blocking advisory that is NOT allowlisted, the build
# still fails.
#
# Usage: ci-npm-audit.sh [extra npm-audit args...]   (e.g. --omit=dev)
# The --audit-level is fixed at "high". Runs in the current working directory,
# so callers set `working-directory:` for sub-package audits (e.g. SkillOpt).
#
# Tunables (env): CI_AUDIT_ATTEMPTS (default 4), CI_AUDIT_DELAY seconds (default 10).

set -uo pipefail

attempts="${CI_AUDIT_ATTEMPTS:-4}"
delay="${CI_AUDIT_DELAY:-10}"

# Patterns that identify a transient advisory-endpoint/network failure (as
# opposed to actual vulnerabilities being reported).
endpoint_error_re='audit endpoint returned an error|Service Unavailable|Internal Server Error|Bad Gateway|Gateway Time-?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|429 Too Many Requests|50[0-9] '

# ---------------------------------------------------------------------------
# Reviewed advisory allowlist
# ---------------------------------------------------------------------------
# GHSA IDs we have reviewed and temporarily accept because no fixed version is
# reachable yet. Every entry MUST be dev-only — the production audit
# (`--omit=dev`) passes on its own and never consults this list. Remove an entry
# the moment the upstream parent ships a release that pulls the patched version.
#
# The list is currently EMPTY, so the gate is fully strict: any blocking (>=high)
# advisory fails the build. The previous entry, GHSA-mh99-v99m-4gvg
# (brace-expansion DoS), was dropped once `npm audit fix` could bump every copy
# — including the nested dev ones under electron-builder and jake — in place.
AUDIT_ALLOWLIST="${AUDIT_ALLOWLIST-}"

# Exit 0 iff `npm audit` reports at least one blocking (>= high) advisory AND
# every blocking advisory is in AUDIT_ALLOWLIST. Any non-allowlisted blocking
# advisory — or a parse failure — yields non-zero, so the real gate still fires.
blocking_advisories_all_allowlisted() {
    local json
    json="$(npm audit --json --audit-level=high "$@" 2>/dev/null)" || true
    [ -n "$json" ] || return 1
    printf '%s' "$json" | AUDIT_ALLOWLIST="$AUDIT_ALLOWLIST" node -e '
        const allow = new Set((process.env.AUDIT_ALLOWLIST || "").split(/\s+/).filter(Boolean));
        let raw = "";
        process.stdin.on("data", d => (raw += d));
        process.stdin.on("end", () => {
            let data;
            try { data = JSON.parse(raw); } catch { process.exit(1); }
            const blocking = new Set();
            for (const pkg of Object.values(data.vulnerabilities || {})) {
                for (const via of pkg.via || []) {
                    if (via && typeof via === "object" && (via.severity === "high" || via.severity === "critical")) {
                        const m = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(via.url || "");
                        blocking.add(m ? m[0] : (via.url || String(via.source)));
                    }
                }
            }
            if (blocking.size === 0) process.exit(1);
            for (const id of blocking) if (!allow.has(id)) process.exit(1);
            process.exit(0);
        });
    '
}

for i in $(seq 1 "$attempts"); do
    out="$(npm audit --audit-level=high "$@" 2>&1)"
    code=$?
    printf '%s\n' "$out"

    if [ "$code" -eq 0 ]; then
        exit 0
    fi

    if printf '%s' "$out" | grep -qiE "$endpoint_error_re"; then
        echo "::warning::npm audit advisory endpoint error (attempt ${i}/${attempts})."
        if [ "$i" -lt "$attempts" ]; then
            sleep "$delay"
            delay=$((delay * 2))
            continue
        fi
        echo "::warning::npm audit advisory endpoint unavailable after ${attempts} attempts; skipping the audit gate for this run. This is a transient npm infrastructure outage (HTTP 5xx from the advisories endpoint), not a dependency problem."
        exit 0
    fi

    # A non-endpoint failure means npm audit found vulnerabilities at/above the
    # configured level. Before failing, allow through the reviewed dev-only
    # advisories in AUDIT_ALLOWLIST (see above). Anything else is the real gate.
    if blocking_advisories_all_allowlisted "$@"; then
        echo "::warning::npm audit: every blocking (>=high) advisory is in the reviewed allowlist (${AUDIT_ALLOWLIST}); passing. See scripts/ci-npm-audit.sh to review or remove entries."
        exit 0
    fi

    # Real, non-allowlisted vulnerability — this is the security gate.
    exit "$code"
done
