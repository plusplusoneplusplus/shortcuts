---
name: go-deep
description: Advanced research and verification methodologies using multi-phase approaches and parallel sub-agents. Use for deep research on complex topics, multi-model verification of arguments, or decomposing features into atomic commit plans.
---

# Go Deep

This skill provides structured approaches for thorough investigation, verification, and planning tasks.

## Available Methods

### Deep Research
Use [deep-research](references/deep-research.prompt.md) for multi-phase research:
1. **Scout Phase**: Identify 5-8 key subtopics
2. **Parallel Deep-Dive**: Research each subtopic independently
3. **Synthesis**: Combine findings into a cohesive report

### Multi-Model Verification
Use [deep-verify](references/deep-verify.prompt.md) to verify arguments using multiple AI models:
1. **Task Definition**: Prepare unbiased verification brief
2. **Parallel Verification**: Dispatch to independent sub-agents
3. **Consensus Analysis**: Synthesize findings, surface agreements and conflicts

### Deep Plan
Use [deep-plan](references/deep-plan.prompt.md) to decompose a feature into a sequence of atomic, reviewable commits:
1. **Scope Analysis**: Explore codebase, map dependencies, identify natural split points
2. **Commit Decomposition**: Break work into ordered, independently reviewable commits
3. **Plan File Generation**: Write numbered plan files (`001-*.md`, `002-*.md`, ...) to `.vscode/tasks/<feature>/<work>/`
4. **Validation**: Verify coverage, ordering, atomicity, and testability
