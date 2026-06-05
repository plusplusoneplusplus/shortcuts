---
name: humanize-doc
description: Review a design doc draft for AI-generated writing patterns and rewrite only the problematic parts in direct engineering language. Use only when user explicitly asks.
metadata:
  author: Yiheng Tao
  version: "0.0.1"
---
# Humanize Design Doc

Review the draft for AI-generated writing patterns and rewrite only the problematic parts.

Flag:
- defensive framing
- vague benefit claims
- marketing language
- unnecessary exposition
- repeated sentence structure
- claims not grounded in facts/code/metrics
- scope statements that should be Goals/Non-goals

Rewrite using:
- direct engineering language
- concrete component names
- short paragraphs
- Goals / Non-goals / Risks / Alternatives where appropriate
- neutral wording suitable for an internal design review

Do not change technical meaning or add facts.