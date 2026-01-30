# Agent Skills Specification Reference

Source: https://agentskills.io/specification

## Directory Structure

```
skill-name/
├── SKILL.md          # Required
├── references/       # Optional - additional documentation
├── scripts/          # Optional - executable code
└── assets/           # Optional - static resources
```

## SKILL.md Format

### Required Frontmatter

```yaml
---
name: skill-name
description: A description of what this skill does and when to use it.
---
```

### Optional Frontmatter Fields

```yaml
---
name: skill-name
description: What this skill does and when to use it.
license: Apache-2.0
compatibility: Requires git, docker, jq
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Read
---
```

## Field Constraints

### name (required)
- 1-64 characters
- Lowercase letters, numbers, and hyphens only (`a-z`, `0-9`, `-`)
- Must not start or end with `-`
- Must not contain consecutive hyphens (`--`)
- Must match the parent directory name

**Valid:**
- `pdf-processing`
- `code-review`
- `data-analysis`

**Invalid:**
- `PDF-Processing` (uppercase)
- `-pdf` (starts with hyphen)
- `pdf--processing` (consecutive hyphens)

### description (required)
- 1-1024 characters
- Should describe both what the skill does AND when to use it
- Include keywords that help agents identify relevant tasks

**Good:**
```yaml
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents or when the user mentions PDFs, forms, or document extraction.
```

**Poor:**
```yaml
description: Helps with PDFs.
```

### license (optional)
- Specifies the license applied to the skill
- Keep it short (license name or reference to bundled file)

### compatibility (optional)
- 1-500 characters if provided
- Only include if skill has specific environment requirements
- Indicate intended product, required system packages, network access, etc.

### metadata (optional)
- Map from string keys to string values
- For additional properties not defined by the spec

### allowed-tools (optional, experimental)
- Space-delimited list of pre-approved tools
- Support varies between agent implementations

## Body Content

The Markdown body after frontmatter contains skill instructions. No format restrictions.

**Recommended sections:**
- Step-by-step instructions
- Examples of inputs and outputs
- Common edge cases

**Best practices:**
- Keep SKILL.md under 500 lines
- Move detailed reference material to separate files
- Use progressive disclosure (metadata → instructions → resources)

## Optional Directories

### references/
Additional documentation agents can read when needed:
- `REFERENCE.md` - Detailed technical reference
- Domain-specific files (`finance.md`, `legal.md`, etc.)

Keep reference files focused. Agents load these on demand.

### scripts/
Executable code that agents can run:
- Should be self-contained or document dependencies
- Include helpful error messages
- Handle edge cases gracefully

### assets/
Static resources:
- Templates (document, configuration)
- Images (diagrams, examples)
- Data files (lookup tables, schemas)

## File References

Use relative paths from skill root:

```markdown
See [the reference guide](references/REFERENCE.md) for details.

Run the extraction script:
scripts/extract.py
```

Keep file references one level deep from SKILL.md.

## Progressive Disclosure

Structure skills for efficient context use:

1. **Metadata** (~100 tokens): `name` and `description` loaded at startup
2. **Instructions** (<5000 tokens): Full SKILL.md body loaded when activated
3. **Resources** (as needed): Files loaded only when required
