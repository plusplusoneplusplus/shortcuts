/**
 * Tests for the heading collapse feature in the markdown review editor
 *
 * Tests cover:
 * - Heading parsing from markdown content
 * - Anchor ID generation (cross-platform)
 * - Section boundary detection
 * - Section map building
 * - Collapsed state management
 */

import * as assert from 'assert';
import {
    buildSectionMap,
    findSectionEndLine,
    generateAnchorId,
    getHeadingAnchorId,
    getHeadingLevel,
    HeadingInfo,
    parseHeadings
} from '../../shortcuts/markdown-comments/webview-logic/heading-parser';

suite('Heading Collapse Tests', () => {

    suite('parseHeadings', () => {
        test('should parse single heading', () => {
            const content = '# Main Title\nSome content';
            const headings = parseHeadings(content);

            assert.strictEqual(headings.length, 1);
            assert.strictEqual(headings[0].lineNum, 1);
            assert.strictEqual(headings[0].level, 1);
            assert.strictEqual(headings[0].text, 'Main Title');
            assert.strictEqual(headings[0].anchorId, 'main-title');
        });

        test('should parse multiple headings at different levels', () => {
            const content = `# Heading 1
Content under H1

## Heading 2
Content under H2

### Heading 3
Content under H3`;

            const headings = parseHeadings(content);

            assert.strictEqual(headings.length, 3);
            assert.strictEqual(headings[0].level, 1);
            assert.strictEqual(headings[1].level, 2);
            assert.strictEqual(headings[2].level, 3);
        });

        test('should track correct line numbers', () => {
            const content = `Line 1
Line 2
# Heading on Line 3
Line 4
## Heading on Line 5`;

            const headings = parseHeadings(content);

            assert.strictEqual(headings.length, 2);
            assert.strictEqual(headings[0].lineNum, 3);
            assert.strictEqual(headings[1].lineNum, 5);
        });

        test('should ignore headings inside code blocks', () => {
            const content = `# Real Heading

\`\`\`markdown
# This is not a heading
## Neither is this
\`\`\`

## Another Real Heading`;

            const headings = parseHeadings(content);

            assert.strictEqual(headings.length, 2);
            assert.strictEqual(headings[0].text, 'Real Heading');
            assert.strictEqual(headings[1].text, 'Another Real Heading');
        });

        test('should handle code blocks with indentation', () => {
            const content = `# Heading

   \`\`\`python
   # This is a comment in Python, not a heading
   def foo():
       pass
   \`\`\`

## Next Heading`;

            const headings = parseHeadings(content);

            assert.strictEqual(headings.length, 2);
        });

        test('should handle empty content', () => {
            const headings = parseHeadings('');
            assert.strictEqual(headings.length, 0);
        });

        test('should handle content with no headings', () => {
            const content = 'Just some text\nNo headings here\nMore text';
            const headings = parseHeadings(content);
            assert.strictEqual(headings.length, 0);
        });

        test('should handle CRLF line endings (Windows)', () => {
            const content = '# Heading 1\r\nContent\r\n## Heading 2\r\nMore content';
            const headings = parseHeadings(content);

            assert.strictEqual(headings.length, 2);
            assert.strictEqual(headings[0].lineNum, 1);
            assert.strictEqual(headings[1].lineNum, 3);
        });

        test('should handle CR line endings (old Mac)', () => {
            const content = '# Heading 1\rContent\r## Heading 2';
            const headings = parseHeadings(content);

            assert.strictEqual(headings.length, 2);
        });

        test('should parse all heading levels (1-6)', () => {
            const content = `# H1
## H2
### H3
#### H4
##### H5
###### H6`;

            const headings = parseHeadings(content);

            assert.strictEqual(headings.length, 6);
            for (let i = 0; i < 6; i++) {
                assert.strictEqual(headings[i].level, i + 1);
            }
        });

        test('should not parse 7+ hashes as heading', () => {
            const content = '####### Not a heading';
            const headings = parseHeadings(content);
            assert.strictEqual(headings.length, 0);
        });
    });

    suite('generateAnchorId', () => {
        test('should generate simple anchor from heading', () => {
            assert.strictEqual(generateAnchorId('Getting Started'), 'getting-started');
        });

        test('should handle heading with numbers', () => {
            assert.strictEqual(generateAnchorId('Step 1 Configuration'), 'step-1-configuration');
        });

        test('should remove punctuation', () => {
            assert.strictEqual(generateAnchorId('Hello, World!'), 'hello-world');
            assert.strictEqual(generateAnchorId("What's New?"), 'whats-new');
            assert.strictEqual(generateAnchorId('Section (Beta)'), 'section-beta');
        });

        test('should handle markdown formatting markers', () => {
            assert.strictEqual(generateAnchorId('**Bold** Heading'), 'bold-heading');
            assert.strictEqual(generateAnchorId('*Italic* Text'), 'italic-text');
            assert.strictEqual(generateAnchorId('`Code` Example'), 'code-example');
            assert.strictEqual(generateAnchorId('~~Strikethrough~~ Text'), 'strikethrough-text');
        });

        test('should collapse multiple spaces and hyphens', () => {
            assert.strictEqual(generateAnchorId('Multiple   Spaces'), 'multiple-spaces');
            assert.strictEqual(generateAnchorId('Hyphen---Test'), 'hyphen-test');
            assert.strictEqual(generateAnchorId('Mixed - - Separators'), 'mixed-separators');
        });

        test('should remove leading and trailing hyphens', () => {
            assert.strictEqual(generateAnchorId('- Leading Hyphen'), 'leading-hyphen');
            assert.strictEqual(generateAnchorId('Trailing Hyphen -'), 'trailing-hyphen');
            assert.strictEqual(generateAnchorId('- Both Ends -'), 'both-ends');
        });

        test('should handle empty and whitespace-only strings', () => {
            assert.strictEqual(generateAnchorId(''), '');
            assert.strictEqual(generateAnchorId('   '), '');
        });

        test('should handle unicode characters (cross-platform)', () => {
            // German umlauts
            assert.strictEqual(generateAnchorId('Über uns'), 'über-uns');
            // French accents
            assert.strictEqual(generateAnchorId('Café Menu'), 'café-menu');
            // Spanish
            assert.strictEqual(generateAnchorId('Información'), 'información');
        });

        test('should work consistently across platforms', () => {
            // Test various special characters
            const testCases = [
                { input: 'Path\\Like\\Windows', expected: 'pathlikewindows' },
                { input: 'Path/Like/Unix', expected: 'pathlikeunix' },
                { input: 'Line\nBreak', expected: 'line-break' },
                { input: 'Tab\tCharacter', expected: 'tab-character' },
            ];

            for (const { input, expected } of testCases) {
                assert.strictEqual(generateAnchorId(input), expected, `Failed for input: ${JSON.stringify(input)}`);
            }
        });
    });

    suite('getHeadingLevel', () => {
        test('should return level for valid headings', () => {
            assert.strictEqual(getHeadingLevel('# H1'), 1);
            assert.strictEqual(getHeadingLevel('## H2'), 2);
            assert.strictEqual(getHeadingLevel('### H3'), 3);
            assert.strictEqual(getHeadingLevel('#### H4'), 4);
            assert.strictEqual(getHeadingLevel('##### H5'), 5);
            assert.strictEqual(getHeadingLevel('###### H6'), 6);
        });

        test('should return 0 for non-headings', () => {
            assert.strictEqual(getHeadingLevel('Not a heading'), 0);
            assert.strictEqual(getHeadingLevel('####### Too many'), 0);
            assert.strictEqual(getHeadingLevel('#NoSpace'), 0);
            assert.strictEqual(getHeadingLevel(''), 0);
        });
    });

    suite('getHeadingAnchorId', () => {
        test('should return anchor ID for heading line', () => {
            assert.strictEqual(getHeadingAnchorId('# My Heading'), 'my-heading');
            assert.strictEqual(getHeadingAnchorId('## Sub Heading'), 'sub-heading');
        });

        test('should return empty string for non-heading', () => {
            assert.strictEqual(getHeadingAnchorId('Not a heading'), '');
            assert.strictEqual(getHeadingAnchorId(''), '');
        });
    });

    suite('findSectionEndLine', () => {
        test('should find end at next same-level heading', () => {
            const headings: HeadingInfo[] = [
                { lineNum: 1, level: 2, anchorId: 'section-1', text: 'Section 1' },
                { lineNum: 5, level: 2, anchorId: 'section-2', text: 'Section 2' },
            ];

            const endLine = findSectionEndLine(headings, 0, 10);
            assert.strictEqual(endLine, 4); // Line before next heading
        });

        test('should find end at next higher-level heading', () => {
            const headings: HeadingInfo[] = [
                { lineNum: 1, level: 2, anchorId: 'section', text: 'Section' },
                { lineNum: 5, level: 1, anchorId: 'top', text: 'Top' },
            ];

            const endLine = findSectionEndLine(headings, 0, 10);
            assert.strictEqual(endLine, 4);
        });

        test('should extend to document end if no next heading', () => {
            const headings: HeadingInfo[] = [
                { lineNum: 1, level: 2, anchorId: 'section', text: 'Section' },
            ];

            const endLine = findSectionEndLine(headings, 0, 20);
            assert.strictEqual(endLine, 20);
        });

        test('should include nested lower-level headings', () => {
            const headings: HeadingInfo[] = [
                { lineNum: 1, level: 1, anchorId: 'h1', text: 'H1' },
                { lineNum: 5, level: 2, anchorId: 'h2', text: 'H2' },
                { lineNum: 10, level: 3, anchorId: 'h3', text: 'H3' },
                { lineNum: 15, level: 1, anchorId: 'h1-2', text: 'H1-2' },
            ];

            // H1 section should extend until next H1
            const endLine = findSectionEndLine(headings, 0, 20);
            assert.strictEqual(endLine, 14);
        });
    });

    suite('buildSectionMap', () => {
        test('should build map for simple document', () => {
            const content = `# Section 1
Content 1

## Section 2
Content 2`;

            const map = buildSectionMap(content);

            assert.strictEqual(map.size, 2);
            assert.ok(map.has('section-1'));
            assert.ok(map.has('section-2'));
        });

        test('should handle duplicate anchor IDs', () => {
            const content = `# Test
Content

## Test
More content`;

            const map = buildSectionMap(content);

            // Should create unique IDs
            assert.strictEqual(map.size, 2);
            assert.ok(map.has('test'));
            assert.ok(map.has('test-1'));
        });

        test('should calculate correct line ranges', () => {
            // Content layout:
            // Line 1: # Heading 1
            // Line 2: Line 2
            // Line 3: Line 3
            // Line 4: (empty)
            // Line 5: ## Heading 2
            // Line 6: Line 6
            // Line 7: Line 7
            const content = `# Heading 1
Line 2
Line 3

## Heading 2
Line 6
Line 7`;

            const map = buildSectionMap(content);

            // H1 section ends at line before H2 (line 4)
            const section1 = map.get('heading-1');
            assert.ok(section1, 'section-1 should exist');
            assert.strictEqual(section1.startLine, 1);
            // Note: H1 section should extend until next H1 or higher level
            // Since ## Heading 2 is H2 (lower level than H1), H1 continues to end
            assert.strictEqual(section1.endLine, 7); // H1 includes H2 content

            // H2 section starts at line 5, extends to end
            const section2 = map.get('heading-2');
            assert.ok(section2, 'section-2 should exist');
            assert.strictEqual(section2.startLine, 5);
            assert.strictEqual(section2.endLine, 7); // End of document
        });

        test('should handle nested sections correctly', () => {
            // Content layout:
            // Line 1: # Top Level
            // Line 2: Content
            // Line 3: (empty)
            // Line 4: ## Nested Level 1
            // Line 5: Content
            // Line 6: (empty)
            // Line 7: ### Deeply Nested
            // Line 8: Content
            // Line 9: (empty)
            // Line 10: ## Another Nested
            // Line 11: Content
            // Line 12: (empty)
            // Line 13: # Another Top
            // Line 14: Content
            const content = `# Top Level
Content

## Nested Level 1
Content

### Deeply Nested
Content

## Another Nested
Content

# Another Top
Content`;

            const map = buildSectionMap(content);

            // Top Level (H1) should extend to line before Another Top (H1)
            const topLevel = map.get('top-level');
            assert.ok(topLevel);
            assert.strictEqual(topLevel.startLine, 1);
            assert.strictEqual(topLevel.endLine, 12); // Line before "Another Top" at line 13
        });

        test('should handle empty content', () => {
            const map = buildSectionMap('');
            assert.strictEqual(map.size, 0);
        });

        test('should handle content without headings', () => {
            const content = 'Just text\nNo headings';
            const map = buildSectionMap(content);
            assert.strictEqual(map.size, 0);
        });
    });

    suite('Cross-Platform Compatibility', () => {
        test('should handle mixed line endings', () => {
            // Mix of CRLF, LF, and CR
            const content = '# Heading 1\r\nContent\n## Heading 2\rMore content';
            const headings = parseHeadings(content);

            assert.strictEqual(headings.length, 2);
        });

        test('should generate consistent anchors regardless of line endings', () => {
            const contentLF = '# Test Heading\nContent';
            const contentCRLF = '# Test Heading\r\nContent';
            const contentCR = '# Test Heading\rContent';

            const headingsLF = parseHeadings(contentLF);
            const headingsCRLF = parseHeadings(contentCRLF);
            const headingsCR = parseHeadings(contentCR);

            assert.strictEqual(headingsLF[0].anchorId, 'test-heading');
            assert.strictEqual(headingsCRLF[0].anchorId, 'test-heading');
            assert.strictEqual(headingsCR[0].anchorId, 'test-heading');
        });

        test('should handle paths with different separators in headings', () => {
            // Headings might contain file paths
            const heading1 = generateAnchorId('Config file: /etc/config.json');
            const heading2 = generateAnchorId('Config file: C:\\Users\\config.json');

            // Both should produce valid anchor IDs
            assert.ok(heading1.length > 0);
            assert.ok(heading2.length > 0);
            assert.ok(!heading1.includes('/'));
            assert.ok(!heading2.includes('\\'));
        });
    });

    suite('Integration Tests', () => {
        test('should handle real-world markdown document', () => {
            // This test verifies headings are parsed correctly from a realistic document
            const content = `# Project Documentation

Welcome to the project.

## Getting Started

Follow these steps:

### Prerequisites

- Node.js 18+
- npm

### Installation

\`\`\`bash
# Clone the repo
git clone https://example.com/repo.git
\`\`\`

## API Reference

### \`initialize()\`

Initializes the system.

### \`shutdown()\`

Shuts down the system.

## Contributing

See CONTRIBUTING.md`;

            const headings = parseHeadings(content);
            const map = buildSectionMap(content);

            // Should have all headings (# comments inside code blocks are ignored)
            // Headings: Project Documentation, Getting Started, Prerequisites,
            // Installation, API Reference, initialize(), shutdown(), Contributing
            assert.strictEqual(headings.length, 8);

            // Main sections should be present
            assert.ok(map.has('project-documentation'));
            assert.ok(map.has('getting-started'));
            assert.ok(map.has('prerequisites'));
            assert.ok(map.has('installation'));
            assert.ok(map.has('api-reference'));
            assert.ok(map.has('contributing'));

            // Check nested structure
            const gettingStarted = map.get('getting-started');
            assert.ok(gettingStarted);
            // Should extend until API Reference (same level H2)
            const apiRef = map.get('api-reference');
            assert.ok(apiRef);
            // Getting Started (H2) should end before API Reference (H2)
            assert.ok(gettingStarted.endLine < apiRef.startLine,
                `Getting Started endLine (${gettingStarted.endLine}) should be before API Reference startLine (${apiRef.startLine})`);
        });
    });
});
