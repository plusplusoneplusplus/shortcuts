---
name: kb-refresh
description: Distill recent CoC chat histories into knowledge-base skill improvements. Scans new conversations since the last run, proposes additions/updates/removals, and patches skill files on confirmation. Use when you want to refresh or update a knowledge-base skill from past chats.
---

# KB Refresh

Automatically distill past CoC conversations into improvements for a knowledge-base skill. Each run processes only chats since the last run (timestamp watermark).

Delegates all chat access to the `coc-chat` skill. Read-only on the chat side, write-only on the skill side.

## Step 1 — Parse Intent

Ask the user which skill to refresh (e.g. `my-queries`, `coc-chat`).

Optionally accept `--workspace <name-or-path>` to target a specific workspace; default to the current working directory. Accept `--limit N` to override the default cap of 50 chats.

## Step 2 — Locate Target Skill

Look for the skill in order:

1. `.github/skills/<name>/SKILL.md` (project skill — editable)
2. `packages/forge/resources/bundled-skills/<name>/SKILL.md` (bundled skill — read-only)

Read `SKILL.md` and all `references/*.md` files into context.

If the skill is bundled (not a project skill), warn the user: **"This is a bundled skill and cannot be edited in-place. Proposals will be shown but not applied."** Continue through Step 8 (show proposal) then stop — do not apply or advance the cursor.

If not found at all, stop and report: **"Skill '<name>' not found."**

## Step 3 — Resolve Workspace

Use the `coc-chat` skill to resolve the workspace:

```bash
python <coc-chat-skill-dir>/scripts/coc_chat.py resolve-workspace <current-working-directory>
```

If `--workspace` was provided, use that value instead. If no workspace matches, run `workspaces` and prompt the user to pick one.

## Step 4 — Read Cursor

Read the cursor file at `~/.coc/repos/<workspaceId>/kb-refresh.json`.

Extract `[skillName].lastRunAt`. If the file or key is absent, this is a first run — scan without `--since`.

Print status:
- **Returning run:** `"Last refreshed: <date>"`
- **First run:** `"First run — will scan all completed chats (up to <limit>)."`

## Step 5 — Scan Chats

Use the `coc-chat` skill to list completed chats:

```bash
python <coc-chat-skill-dir>/scripts/coc_chat.py list <wsId> --status completed [--since <lastRunAt>] --limit <limit>
```

Print: `"Found N new chats to scan."`

If N is 0: print `"Nothing new since last run."`, advance the cursor (Step 11), and stop.

## Step 6 — Read Conversations

For each process from Step 5, read the full conversation:

```bash
python <coc-chat-skill-dir>/scripts/coc_chat.py conversation <wsId> <processId>
```

Skip processes where all assistant turns are pure tool-call-only (no substantive text content).

Collect for each: process ID, title, end time, and full turn content.

## Step 7 — Distill

Load [references/extraction-prompt.md](references/extraction-prompt.md) as the analysis template.

Feed it:
- **(a)** The current skill content (SKILL.md + all references/*.md)
- **(b)** The collected conversation excerpts from Step 6

The AI produces three buckets:

| Bucket | Meaning |
|--------|---------|
| 🆕 **NEW** | Facts, patterns, commands, or constraints not in the skill yet |
| ✏️ **UPDATE** | Existing entries that were refined or corrected in practice |
| 🗑️ **REMOVE** | Entries shown to be wrong, deprecated, or never used |

Every item must cite which process title and ID it came from.

## Step 8 — Show Proposal

Render the proposal per [references/diff-format.md](references/diff-format.md).

If all three buckets are empty: print `"No actionable changes found."`, advance the cursor (Step 11), and stop.

Otherwise, print the full proposal and wait for the user's decision.

## Step 9 — Confirm

Ask: **"Apply these changes? [yes / edit / skip]"**

| Choice | Action |
|--------|--------|
| `yes` | Proceed to Step 10 |
| `edit` | Let the user amend the proposal text, then re-confirm |
| `skip` | Do not write skill files; still advance the cursor (Step 11) |

## Step 10 — Apply

Edit skill files in-place (`SKILL.md` and/or relevant `references/*.md`).

If a proposed addition belongs in a new reference file, create it and add a link in SKILL.md.

Only project skills under `.github/skills/` may be edited. Never modify bundled skills under `packages/forge/resources/bundled-skills/`.

## Step 11 — Update Cursor

Write `[skillName].lastRunAt = <now (ISO 8601)>` into `~/.coc/repos/<workspaceId>/kb-refresh.json`.

Merge into the existing file — do not overwrite other skills' entries. If the file does not exist, create it.

Print: `"Cursor advanced to <now>. Next run will scan chats after this point."`
