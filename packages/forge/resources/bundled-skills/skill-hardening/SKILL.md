---
name: skill-hardening
description: Harden a skill from one failure case without overfitting — name the failure class, derive an abstract rule, validate it against three cases, then emit a minimal diff.
metadata:
  author: Yiheng Tao
  version: "0.0.1"
---

# Skill Hardening

Improve a skill using the given case, but avoid overfitting. Do not directly patch for the exact case.

First:

1. Identify the general failure mode.
2. Explain why a naive fix would overfit.
3. Propose a general rule that would prevent similar failures.
4. Create 3 validation cases:
   - similar case
   - adjacent different case
   - case where the rule should not apply
5. Only then propose a minimal skill diff.

Constraints:

- Do not include names, exact file paths, exact error strings, or case-specific details unless they represent a reusable category.
- Prefer abstract decision rules over concrete commands.
- Reject any change that only improves the provided case.
- Keep examples separate from rules.
