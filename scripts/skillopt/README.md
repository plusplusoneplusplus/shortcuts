# SkillOpt

**SkillOpt** is a TypeScript script that implements a simplified [SkillOpt](https://arxiv.org/abs/2605.23904) loop to "train" a CoC skill document (`SKILL.md`) by repeatedly running the **GitHub Copilot CLI** in headless mode and using a held-out validation gate to accept only improvements.

The skill document is treated as the trainable external state of a frozen target agent: the script runs the target model on a corpus of coding tasks **with** the current skill, scores the results, asks an **optimizer** model for one bounded `add`/`delete`/`replace` edit, and accepts the edit only if it strictly improves the held-out selection score.

Output: `best_skill.md` + `history.jsonl` + `summary.json` in the output directory. The checked-in skill is **never** overwritten automatically.

---

## Prerequisites

1. **GitHub Copilot CLI** on PATH and authenticated:
   ```sh
   # Install (pick your platform)
   brew install gh
   gh extension install github/gh-copilot
   # or the standalone copilot CLI binary

   # Authenticate
   copilot auth login
   ```
2. **Node.js ≥ 18** (for `npx tsx`).
3. Run from the **repository root** (or pass absolute paths).

---

## Quick Start

```sh
npx tsx scripts/skillopt/skillopt.ts \
  --skill .github/skills/impl/SKILL.md \
  --corpus scripts/skillopt/corpus \
  --out ./_skillopt_run \
  --max-steps 1
```

This will:
1. Score the baseline skill on the selection split.
2. Run one rollout on each train task.
3. Ask the optimizer for one bounded edit.
4. Score the candidate on the selection split.
5. Accept iff strictly improving → write `_skillopt_run/best_skill.md`.

---

## CLI Reference

```
npx tsx scripts/skillopt/skillopt.ts [options]

Required:
  --skill <path>          Skill document to optimize
  --corpus <path>         Task corpus directory or tasks.json file
  --out <path>            Output directory for artifacts

Optional:
  --target-model <m>      Copilot model for target agent   (default: claude-sonnet-4.6)
  --optimizer-model <m>   Copilot model for optimizer      (default: same as --target-model)
  --max-steps <n>         Max optimization steps           (default: 10)
  --w1 <weight>           Hidden-test pass-rate weight     (default: 0.7)
  --w2 <weight>           LLM-judge / reference weight     (default: 0.3)
  --judge-samples <n>     Judge samples to average         (default: 1)
  --timeout-ms <ms>       Per-CLI-call timeout             (default: 300000)
  --help / -h             Show help and exit
```

---

## Artifacts

| File | Description |
|------|-------------|
| `best_skill.md` | Best skill document seen so far (atomically written). Copy to the checked-in skill manually after review. |
| `history.jsonl` | One JSON line per completed step: train scores, candidate score, gate decision, edit metadata. |
| `summary.json` | Final summary: total steps, accepted steps, initial/final scores. |

---

## Corpus Schema

The corpus is a `tasks.json` file (or a directory containing one):

```json
{
  "tasks": [
    {
      "id": "unique-task-id",
      "prompt": "The coding task shown to the target agent.",
      "seedRef": "optional git ref or directory used to initialise the worktree",
      "visibleTests": "shell command the agent CAN run to verify its work",
      "hiddenTests": "shell command used ONLY for scoring (NEVER shown to agent)",
      "judgeRubric": "plain-text rubric for the LLM judge",
      "judgeTarget": "diff | stdout (optional, default diff)",
      "idealOutput": "reference answer (required when judgeTarget is stdout)",
      "split": "train | selection"
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Unique identifier (string, non-empty). |
| `prompt` | ✅ | Task description shown to the target agent. |
| `split` | ✅ | `"train"` (used for rollouts) or `"selection"` (held-out validation). |
| `seedRef` | ○ | Git ref or directory to seed the worktree. |
| `visibleTests` | ○ | Shell command the agent sees and may run for self-verification. |
| `hiddenTests` | ○ | Shell command run **after** the rollout (not visible to agent) for scoring. |
| `judgeRubric` | ○ | Rubric given to the LLM judge CLI call (diff mode). |
| `judgeTarget` | ○ | `"diff"` (default) or `"stdout"`. Selects the evaluation path (see below). |
| `idealOutput` | ○ | Reference answer. **Required** when `judgeTarget="stdout"`. |

The corpus must have **at least one `train` task** and **at least one `selection` task**. IDs must be unique.

### Evaluation modes (`judgeTarget`)

- **`"diff"` (default):** the LLM judge reviews the produced **git diff** against
  `judgeRubric`, blended with `hiddenTests` pass rate. This is the original behavior and is
  unchanged for tasks that omit `judgeTarget`.
- **`"stdout"` (generic reference-based):** the rollout's **stdout** is compared to the
  task's `idealOutput` by similarity — useful for skills whose output is a plan/answer
  rather than a code change (e.g. the **break-down** commit-split skill). The pipeline is
  skill-agnostic:
  1. **Extract** (`extract.ts`): an LLM normalizes both the candidate stdout and the
     `idealOutput` into a structured list of atomic "points".
  2. **Score** (`reference-judge.ts`): `referenceScore = 0.7·pointF1 + 0.3·holistic`, where
     `pointF1` is the F1 of LLM-matched (by meaning) candidate↔ideal points and `holistic`
     is a single 0–1 substance-similarity judgment. This `referenceScore` takes the place
     of the LLM-judge component in the outer `w1·hidden + w2·reference` blend, so running
     with `--w1 0 --w2 1` makes the reward purely the reference similarity.

  `--judge-samples <n>` averages the judge over `n` runs for self-consistency.

---

## Optimizer Prompt Contract

The optimizer is called via the Copilot CLI with a prompt that includes:
- The current skill document.
- A summary of recent scored rollouts (diffs and scores).

It must return **exactly one JSON code block** (`\`\`\`json ... \`\`\``) containing a single edit object:

```json
{
  "type": "add" | "delete" | "replace",
  "anchor": "<substring of the target line>",
  "content": "<new text (required for add/replace)>"
}
```

**Edit semantics:**
- `"add"`: insert `content` as a new line **after** the first line containing `anchor`.
- `"delete"`: remove the first line containing `anchor`.
- `"replace"`: replace the first line containing `anchor` with `content`.

If the optimizer output is malformed or the anchor is not found, the edit is treated as a **no-op** and the run continues (logged to history).

---

## Algorithm Overview

```
1. Load skill S₀ from --skill
2. Score S₀ on selection split → best_score
3. For step = 1..max_steps:
   a. For each train task tᵢ:
      - Create git worktree from HEAD
      - Inject S into .github/skills/active-skill.md
      - Run: copilot -p "<skill + task prompt>" --allow-all-tools -C <worktree> --model <target-model>
      - Run hidden tests (in worktree, NOT shown to agent) → hiddenTestPassRate
      - Run LLM judge on diff → judgeScore
      - score = w1·hiddenTestPassRate + w2·judgeScore  (normalised)
      - Clean up worktree
   b. Build optimizer prompt (current skill + scored rollouts)
   c. Run: copilot -p "<optimizer prompt>" --allow-all-tools --model <optimizer-model>
   d. Parse ONE add/delete/replace edit from optimizer output
   e. Apply edit → candidate skill S'
   f. Score S' on selection split → candidate_score
   g. If candidate_score > best_score:
        accept: S ← S', best_score ← candidate_score, write best_skill.md
      Else:
        reject: S unchanged
   h. Append step record to history.jsonl
4. Write summary.json
```

---

## Running Tests

```sh
cd scripts/skillopt
npm install
npx vitest run
```

Tests use vitest and mock all CLI calls (no real Copilot CLI needed).

---

## Notes

- `best_skill.md` is **never** auto-applied to the checked-in `.github/skills/impl/SKILL.md`. Review the diff and copy manually.
- Rollout isolation uses `git worktree add --detach` (cleaned up in a `finally` block).
- Ctrl-C is handled gracefully: `summary.json` is flushed before exit.
- The `--w1` and `--w2` weights are normalised, so only their ratio matters.
