---
status: pending
---

# 010: Implement Connections and Secrets Management

## Summary
Add a connections/secrets management layer that allows pipelines to securely reference external service credentials, API keys, and connection strings without hardcoding them in YAML.

## Motivation
Airflow's Connections and Variables system lets DAGs reference credentials by name rather than embedding secrets in code. The current pipeline framework has no equivalent — credentials must be in environment variables. This commit provides a secure, manageable layer for external service configuration.

## Changes

### Files to Create
- `packages/pipeline-core/src/connections/types.ts` — Connection types:
  - `Connection`: id, type (http, database, s3, api_key, custom), host?, port?, login?, password?, schema?, extra?
  - `Variable`: key, value, description?, isSecret (boolean)
  - `ConnectionStore`: CRUD interface for connections and variables
- `packages/pipeline-core/src/connections/connection-manager.ts` — `ConnectionManager`:
  - `getConnection(connId)` → Connection (resolved with secrets)
  - `getVariable(key)` → string value
  - `setConnection(connection)` / `deleteConnection(connId)`
  - `setVariable(key, value, isSecret?)` / `deleteVariable(key)`
  - `listConnections()` / `listVariables()`
  - Resolution priority: env vars → file store → defaults
  - Environment variable override: `PIPELINE_CONN_<CONN_ID>` for connections, `PIPELINE_VAR_<KEY>` for variables
- `packages/pipeline-core/src/connections/encrypted-store.ts` — File-based encrypted store:
  - Stores connections in `<baseDir>/connections.enc.json`
  - Encryption: AES-256-GCM using machine-derived key (or user-provided key via env var `PIPELINE_ENCRYPTION_KEY`)
  - Plaintext fallback mode for development (configurable)
  - Variables stored with `isSecret` flag controlling encryption
- `packages/pipeline-core/src/connections/template-resolver.ts` — Template integration:
  - `{{ conn.<connId>.host }}` → resolves connection fields in prompts
  - `{{ var.<key> }}` → resolves variables in prompts
  - Masks secret values in logs (replaces with `***`)
- `packages/pipeline-core/src/connections/index.ts` — Barrel export

### Files to Modify
- `packages/pipeline-core/src/dag/executor.ts` — Inject ConnectionManager into task handler context
- `packages/pipeline-core/src/dag/task-handlers/types.ts` — Add `connections: ConnectionManager` to context
- `packages/pipeline-core/src/dag/xcom/xcom-template-resolver.ts` — Add conn/var template resolution
- `packages/pipeline-core/src/index.ts` — Export connections module

## Implementation Notes
- **YAML usage:**
```yaml
tasks:
  fetch_data:
    type: shell
    command: |
      curl -H "Authorization: Bearer {{ var.api_token }}" \
           {{ conn.data_api.host }}/api/v1/export
    depends_on: []
    
  upload_results:
    type: shell
    command: |
      aws s3 cp output.json s3://{{ conn.s3_bucket.schema }}/results/
    depends_on: [process]
```

- AES-256-GCM is available natively in Node.js `crypto` — no new dependencies
- Machine-derived key uses `os.hostname()` + `os.userInfo().username` + salt — not military-grade but prevents casual read of file
- `PIPELINE_ENCRYPTION_KEY` env var overrides machine key for CI/CD environments
- Connection types mirror Airflow's (`http`, `postgres`, `mysql`, `s3`, etc.) but are not enforced — `custom` type allows anything
- Secret masking in logs is automatic for any field from a connection or variable marked `isSecret`
- Environment variable override means CI/CD can inject secrets without touching the file store

## Tests
- `packages/pipeline-core/test/connections/connection-manager.test.ts`:
  - CRUD operations for connections and variables
  - Environment variable override takes precedence
  - Missing connection → clear error
  - List connections (with passwords masked)
- `packages/pipeline-core/test/connections/encrypted-store.test.ts`:
  - Write and read back encrypted connection
  - Encrypted file is not readable as plain JSON
  - Wrong key → decryption fails gracefully
  - Plaintext fallback mode works
- `packages/pipeline-core/test/connections/template-resolver.test.ts`:
  - `{{ conn.api.host }}` resolves correctly
  - `{{ var.key }}` resolves correctly
  - Secret values masked in log output
  - Missing reference → clear error

## Acceptance Criteria
- [ ] Connections and variables are stored securely (encrypted at rest)
- [ ] Environment variable override works for CI/CD
- [ ] Template syntax resolves connection fields and variables in prompts
- [ ] Secret values are automatically masked in logs
- [ ] CRUD API works for managing connections and variables
- [ ] No new external dependencies (uses Node.js crypto)
- [ ] Existing tests pass

## Dependencies
- Depends on: 004, 007
