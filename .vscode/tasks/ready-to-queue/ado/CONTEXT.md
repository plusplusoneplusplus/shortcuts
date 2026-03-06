# Context: Azure DevOps Integration

## User Story
User wants to integrate Azure DevOps (ADO) into the CoC CLI. They found `azure-devops-node-api`
useful and want basic utility services for PRs and work items — no CLI command wiring, no config
file integration, just foundational services in `pipeline-core`.

## Goal
Introduce a standalone ADO module in `pipeline-core` with a connection factory and typed service
classes for Work Items and Pull Requests, usable by any consumer without CLI or config coupling.

## Commit Sequence
1. 001 ADO Foundation — connection factory, shared types, env-var PAT auth
2. 002 Work Items Service — CRUD, WIQL queries, and comments via WorkItemTrackingApi
3. 003 Pull Requests Service — list/get/create/update PRs, threads, and reviewers via GitApi

## Key Decisions
- Auth via environment variables only (`AZURE_DEVOPS_TOKEN`, `AZURE_DEVOPS_ORG_URL`); no config file
- Singleton factory pattern mirroring `CopilotSDKService` (`getAdoConnectionFactory` / `resetAdoConnectionFactory`)
- Typed error classes per service for precise error handling
- Commits 002 and 003 are independent of each other; both depend on 001

## Conventions
- Module lives at `packages/pipeline-core/src/ado/`
- Class-based service design; one class per ADO API surface
- Accessor pattern: `getAdoConnectionFactory` returns the singleton, `resetAdoConnectionFactory` replaces it (test seam)
- Tests written in Vitest; run with `npm run test:run` inside the package
