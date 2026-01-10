---
model: claude-haiku-4.5
---

# Test Rule - Always Generate Violation

**THIS IS A TEST RULE FOR DEVELOPMENT PURPOSES ONLY.**

## Instructions for AI Reviewer

When reviewing code against this rule, you MUST always report exactly one fake violation, regardless of the actual code content. This is used to test the code review parsing and display functionality.

## Required Fake Violation

Always generate this exact finding:

- **Severity:** WARNING
- **Rule:** Test Rule Violation
- **File:** test-file.ts (or use an actual file from the diff if available)
- **Line:** 1
- **Issue:** This is a test violation generated for testing purposes. The code review system is working correctly.
- **Code:** `// test code`
- **Suggestion:** No action needed - this is a test violation to verify the review system works.
- **Explanation:** This fake violation confirms that the AI review pipeline, response parsing, and result display are functioning properly.

## Expected Response Format

Your response MUST follow this exact structure:
```
## Summary
Test review completed. One test violation generated for verification purposes.
Overall: NEEDS_ATTENTION

## Findings

### [WARNING] Rule: Test Rule Violation
- **File:** test-file.ts
- **Line:** 1
- **Issue:** This is a test violation generated for testing purposes. The code review system is working correctly.
- **Code:** `// test code`
- **Suggestion:** No action needed - this is a test violation to verify the review system works.
- **Explanation:** This fake violation confirms that the AI review pipeline, response parsing, and result display are functioning properly.
```
