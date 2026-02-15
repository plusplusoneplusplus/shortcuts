# Breadth-First Iterative Discovery — Design Analysis

## Problem Statement

Current Phase 1 discovery has two modes:
1. **Small repos (<3000 files):** Single AI session scans everything → produces ModuleGraph
2. **Large repos (3000+ files):** Structural scan → per-area sequential drill-down → merge

Both are **top-down, structure-driven** — they rely on directory names and file conventions to identify modules. For legacy codebases with misleading names or monolithic files (50k+ lines), this produces inaccurate graphs.

## Proposed: Breadth-First Iterative Discovery

A new **Phase 0 (Topic Seeds)** step runs before Phase 1 discovery. An AI session scans the repo's README, manifests, directory structure, and configs to identify key architectural topics as seed inputs. These seeds can then feed into a breadth-first iterative discovery mode where many parallel AI sessions — one per topic — each search the codebase for evidence of that topic and loop until convergence.

## Design Analysis

### How It Would Work

```
Input: repo path
                │
                ▼
┌──────────────────────────────┐
│  Phase 0: Topic Seeds        │  Dedicated CLI command: `deep-wiki seeds <repo>`
│  (standalone pre-step)       │  Single AI session with MCP tools
│  Scan README, manifests,     │  Output: seeds.json (editable by user)
│  dirs, configs               │
└──────────────┬───────────────┘
                │
          seeds.json
                │
                ▼
┌──────────────────────────────┐
│  Phase 1: Discovery          │  `deep-wiki discover <repo> --seeds seeds.json`
│  (iterative mode)            │  OR standard mode without seeds
└──────────────┬───────────────┘
                │  (when using iterative mode with seeds)
                ▼
┌──────────────────────────────┐
│  Round 1: Parallel Probes    │  N parallel AI sessions (one per topic)
│  Each probes the codebase    │  grep for patterns, read relevant files
│  for evidence of its topic   │  Output: TopicProbeResult per topic
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Merge + Gap Analysis        │  Single AI session
│  Merge all probe results     │  Identify gaps, overlaps, new topics
│  Output: merged graph +      │  Output: new topic list for next round
│          new topics to probe │
└──────────────┬───────────────┘
               │
               ▼
         Converged? ──No──▶ Back to Round 1 with new topics
               │
              Yes
               │
               ▼
         Final ModuleGraph
```

### Seed Topics Input Format

```csv
topic,description,hints
"authentication","User auth and session management","look for JWT, OAuth, login, session"
"database","Data persistence layer","look for ORM, SQL, migrations, models"
"api-gateway","HTTP request routing","look for routes, controllers, middleware"
```

Or JSON:
```json
{
  "topics": [
    {
      "topic": "authentication",
      "description": "User auth and session management",
      "hints": ["JWT", "OAuth", "login", "session", "passport"]
    }
  ]
}
```

### Per-Topic Probe Session

Each parallel AI session gets:
- The topic name + description + hints
- Access to grep/glob/view tools
- Instructions to:
  1. `grep` for hint keywords across the codebase
  2. Read files that match (sampling mid-file for large files)
  3. Identify which modules/files belong to this topic
  4. Discover **adjacent topics** (things it found that don't belong to its topic)
  5. Return structured result

### TopicProbeResult Schema

```json
{
  "topic": "authentication",
  "foundModules": [
    {
      "id": "auth-core",
      "name": "Authentication Core",
      "path": "src/legacy/utils.java",
      "purpose": "Despite the filename, this contains the JWT validation and session management logic (lines 12000-35000)",
      "keyFiles": ["src/legacy/utils.java", "src/config/auth-config.yaml"],
      "evidence": "Found JWT token handling at line 12450, session creation at line 18200",
      "lineRanges": [[12000, 35000]]
    }
  ],
  "discoveredTopics": [
    {
      "topic": "rate-limiting",
      "description": "Found rate limiting logic interleaved with auth middleware",
      "hints": ["RateLimiter", "throttle", "requestCount"],
      "source": "Discovered while investigating auth middleware in src/legacy/utils.java:28000"
    }
  ],
  "dependencies": ["database", "config"],
  "confidence": 0.85
}
```

### Merge + Gap Analysis

After each round, a single AI session:
1. Merges all TopicProbeResults into a growing ModuleGraph
2. Resolves overlaps (two topics claiming the same file ranges)
3. Identifies coverage gaps (large files/directories no topic touched)
4. Collects all `discoveredTopics` from probes → these become next round's seeds
5. Decides: converged (no new topics, good coverage) or another round needed

### Convergence Criteria

Stop iterating when:
- No new topics discovered in the last round
- File coverage exceeds threshold (e.g., 80% of non-trivial files touched)
- Max rounds reached (configurable, default 3)
- New topics are all low-confidence duplicates of existing ones

## What Makes This Better for Legacy Code

| Problem | Current approach | Breadth-first approach |
|---------|-----------------|----------------------|
| Misleading filenames | Trusts `utils.java` is utilities | Greps for actual patterns, discovers auth logic inside |
| Monolithic files (50k lines) | Reads top ~100 lines, guesses | Multiple probes grep different patterns, each finds its relevant sections with line ranges |
| Missing documentation | Falls back to directory structure | Keyword-based search doesn't need docs |
| Cross-cutting concerns | One session may miss scattered logic | Dedicated probe per concern finds all pieces |
| Unknown unknowns | Must discover everything in one pass | `discoveredTopics` field lets probes surface surprises |

## What Makes This Harder

1. **Cost** — More AI sessions = more tokens. A 3-round discovery with 20 topics = 60+ sessions vs current 1-5.
2. **Merge complexity** — Resolving overlapping claims on the same file regions is non-trivial.
3. **Convergence guarantee** — Could oscillate if topics keep spawning new topics. Need hard cap.
4. **User burden** — ~~Requires seed topics.~~ Addressed by Phase 0 (`deep-wiki seeds <repo>`) which auto-generates seeds. Users of small/well-structured repos don't need this.
5. **Partial file modules** — Current ModuleInfo assumes `path` = directory. Need to support line ranges within files for monolithic codebases.

## Recommendation

**Yes, this makes sense — but as an alternative discovery mode, not a replacement.**

### Integration approach:

```
# Phase 0: Standalone topic seed generation (new dedicated command)
deep-wiki seeds <repo>                             # Generate seeds.json from repo analysis
deep-wiki seeds <repo> --output my-seeds.json      # Custom output path
deep-wiki seeds <repo> --max-topics 30             # Override default 5-20 range

# Phase 1: Discovery (existing command, extended)
deep-wiki discover <repo>                          # Current: auto-detect small/large
deep-wiki discover <repo> --seeds seeds.json       # New: breadth-first iterative mode
deep-wiki discover <repo> --seeds topics.csv       # New: CSV format also supported

# Combined: Phase 0 + Phase 1 in one go
deep-wiki generate <repo> --seeds auto             # Auto-generate seeds, then full pipeline
```

### Key design decisions to make:

1. **Auto-seed generation (Phase 0)** — Confirmed as a dedicated standalone step with its own CLI command (`deep-wiki seeds <repo>`). Runs an AI session that scans `README.md`, `package.json`/`Cargo.toml`/`go.mod`/etc., top-level directory names, and CI configs to generate an initial topics list. Output is saved to `seeds.json` so users can review, edit, and refine before passing to Phase 1. When `--seeds auto` is used with `discover` or `generate`, Phase 0 runs automatically inline.

### Phase 0: Topic Seed Generation (Dedicated CLI Command)

**Command:** `deep-wiki seeds <repo>`

**Purpose:** A standalone pre-step before Phase 1 that identifies the key architectural topics in a codebase. Designed to be run independently so users can review and curate the seeds before committing to a full discovery run.

**CLI Options:**
| Option | Default | Description |
|--------|---------|-------------|
| `--output <path>` | `seeds.json` | Output file path |
| `--max-topics <n>` | `20` | Maximum number of topics to generate |
| `--min-topics <n>` | `5` | Minimum number of topics (falls back to heuristic if AI under-generates) |
| `--model <model>` | (default) | AI model to use |
| `--verbose` | `false` | Show detailed progress |

**Workflow:**
```
$ deep-wiki seeds ./my-legacy-repo
Scanning repository...
  ✓ Found README.md
  ✓ Found package.json (47 dependencies)
  ✓ Found 12 top-level directories
  ✓ Found .github/workflows/ (3 workflows)
  ✓ Found Dockerfile

Generating topic seeds...
  ✓ Identified 14 topics

Saved to: seeds.json

Topics discovered:
  1. authentication      - JWT-based auth and session management
  2. database            - PostgreSQL persistence with Prisma ORM
  3. api-gateway         - Express HTTP routing and middleware
  ...

Review and edit seeds.json, then run:
  deep-wiki discover ./my-legacy-repo --seeds seeds.json
```

**Implementation:**
- Single AI session with MCP tools (`view`, `grep`, `glob`)
- Scans the following sources (prioritized order):
  1. `README.md` / `README.rst` / `CONTRIBUTING.md` — project description, feature lists
  2. Package manifests (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `pom.xml`) — dependencies hint at capabilities
  3. Top-level directory names — `src/auth/`, `lib/db/`, `services/` etc.
  4. CI/CD configs (`.github/workflows/`, `Dockerfile`, `docker-compose.yml`) — infrastructure topics
  5. Config files (`.env.example`, `config/`) — feature flags, integrations
- AI returns a structured list of seed topics with descriptions and search hints
- Output saved to `seeds.json` (or user-specified path) for review

**Prompt template (sketch):**
```
You are analyzing a software repository to identify key architectural topics.

Examine the following project files and directory structure to identify 5-20 distinct 
functional areas or architectural topics in this codebase.

For each topic, provide:
- topic: short identifier (kebab-case)
- description: 1-2 sentence explanation
- hints: comma-separated search terms to find related code

Return JSON: { "topics": [{ "topic": "...", "description": "...", "hints": "..." }] }
```

**Guardrails:**
- Minimum 5 topics, maximum 20 by default (configurable via `--min-topics` / `--max-topics`)
- If AI under-generates, fall back to directory-name-based heuristic to meet minimum
- Output file is human-editable JSON — users can add/remove/refine topics before feeding to `discover`
- When used via `--seeds auto` in `discover`/`generate`, runs Phase 0 inline and pipes results directly
2. **Line-range tracking** — Add optional `lineRanges` to ModuleInfo for monolithic files?
3. **Max rounds** — Default 3? Configurable?
4. **Parallelism** — Reuse existing map-reduce from pipeline-core for the parallel probes?
5. **Output compatibility** — The final ModuleGraph must be compatible with Phase 2/3 (same schema). Topic metadata would be extra fields.

## Workplan

- [x] Confirm design decisions with user
- [x] Define seed file format (CSV + JSON schemas)
- [x] Implement `deep-wiki seeds` CLI command (argument parsing, options)
- [x] Design Phase 0 prompt template (repo scanning for topic identification)
- [x] Implement Phase 0 AI session (scan README, manifests, directories, configs)
- [x] Implement seeds output writer (JSON with human-readable formatting)
- [x] Wire `--seeds auto` shorthand in `discover`/`generate` commands
- [x] Implement seed file parser (JSON + CSV)
- [x] Define TopicProbeResult type
- [x] Add `lineRanges` optional field to ModuleInfo
- [x] Implement topic probe prompt + session
- [x] Implement merge/gap-analysis session  
- [x] Implement convergence loop
- [x] Wire `--seeds <file>` into `discover` for iterative mode
- [x] Add tests (Phase 0 seeds command, seed parsing, iterative discovery)
- [ ] Update design docs
