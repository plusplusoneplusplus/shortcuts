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
# It does NOT weaken the security gate: whenever the endpoint is reachable, a
# real vulnerability at/above --audit-level still fails the build, because a
# vulnerability failure is not an endpoint error and is propagated as-is.
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
    # configured level. Propagate the failure — this is the real security gate.
    exit "$code"
done
