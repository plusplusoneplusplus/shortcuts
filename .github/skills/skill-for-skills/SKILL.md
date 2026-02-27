---
name: skill-for-skills
description: Create and update Agent Skills following the agentskills.io specification. Use when creating new skills, updating existing skills, or validating skill structure.
---

# Skill for Skills

This skill helps you create, update, and validate Agent Skills following the [agentskills.io specification](https://agentskills.io/specification).

## Creating a New Skill

1. Create the skill directory: `.github/skills/<skill-name>/`
2. Create `SKILL.md` with required frontmatter and instructions
3. Optionally add `references/`, `scripts/`, or `assets/` directories

## SKILL.md Template

```markdown
---
name: <skill-name>
description: <What this skill does and when to use it. Max 1024 chars.>
---

# <Skill Title>

<Brief overview of the skill>

## Instructions

<Step-by-step instructions for the agent>

## References

- [Reference Name](references/reference-file.md) - Description
```

## Validation Checklist

Before finalizing a skill, verify:

- [ ] `name` field: lowercase, hyphens only, 1-64 chars, matches directory name
- [ ] `description` field: describes what AND when to use, 1-1024 chars
- [ ] Body content: clear instructions, under 500 lines
- [ ] References: relative paths, one level deep from SKILL.md

See [specification reference](references/specification.md) for complete details.
