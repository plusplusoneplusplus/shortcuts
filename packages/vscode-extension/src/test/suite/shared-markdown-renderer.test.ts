/**
 * Unit tests for the shared markdown renderer
 * Tests the renderCommentMarkdown and renderInlineMarkdown functions
 * 
 * Note: Since the markdown renderer uses DOM APIs (document.createElement for escapeHtml),
 * we test the logic by reimplementing the escapeHtml function for testing purposes.
 */

import * as assert from 'assert';

// Reimplement escapeHtml for testing (the actual implementation uses DOM)
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Render inline markdown elements (bold, italic, code, links, etc.)
 * This is a copy of the implementation for testing without DOM dependencies
 */
function renderInlineMarkdown(text: string): string {
    if (!text) return '';
    
    let html = escapeHtml(text);
    
    // Inline code (must be before bold/italic to avoid conflicts)
    html = html.replace(/`([^`]+)`/g, '<code class="comment-inline-code">$1</code>');
    
    // Bold + Italic (***text*** or ___text___)
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
    
    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // Italic (*text* or _text_) - careful not to match inside bold
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
    
    // Strikethrough (~~text~~)
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    
    // Links [text](url) - make clickable
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="comment-link" target="_blank" rel="noopener">$1</a>');
    
    return html;
}

/**
 * Render markdown content to HTML for display in comment bubbles.
 * This is a copy of the implementation for testing without DOM dependencies
 */
function renderCommentMarkdown(markdown: string): string {
    if (!markdown) return '';
    
    const lines = markdown.split('\n');
    const htmlLines: string[] = [];
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockContent: string[] = [];
    let inList = false;
    let listType: 'ul' | 'ol' = 'ul';
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Handle code blocks
        if (line.startsWith('```')) {
            if (!inCodeBlock) {
                // Start code block
                inCodeBlock = true;
                codeBlockLang = line.slice(3).trim();
                codeBlockContent = [];
            } else {
                // End code block
                inCodeBlock = false;
                const langClass = codeBlockLang ? ` class="language-${escapeHtml(codeBlockLang)}"` : '';
                htmlLines.push(`<pre class="comment-code-block"><code${langClass}>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
                codeBlockContent = [];
                codeBlockLang = '';
            }
            continue;
        }
        
        if (inCodeBlock) {
            codeBlockContent.push(line);
            continue;
        }
        
        // Check for list items
        const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
        const olMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
        
        if (ulMatch || olMatch) {
            if (!inList) {
                inList = true;
                listType = ulMatch ? 'ul' : 'ol';
                htmlLines.push(`<${listType} class="comment-list">`);
            }
            const content = ulMatch ? ulMatch[3] : olMatch![3];
            htmlLines.push(`<li>${renderInlineMarkdown(content)}</li>`);
            
            // Check if next line is not a list item to close the list
            const nextLine = lines[i + 1];
            if (!nextLine || (!nextLine.match(/^(\s*)([-*+])\s+/) && !nextLine.match(/^(\s*)(\d+\.)\s+/))) {
                htmlLines.push(`</${listType}>`);
                inList = false;
            }
            continue;
        }
        
        // Close any open list if we hit a non-list line
        if (inList) {
            htmlLines.push(`</${listType}>`);
            inList = false;
        }
        
        // Empty line
        if (line.trim() === '') {
            htmlLines.push('<br>');
            continue;
        }
        
        // Headings (# to ######)
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const content = renderInlineMarkdown(headingMatch[2]);
            htmlLines.push(`<h${level} class="comment-heading comment-h${level}">${content}</h${level}>`);
            continue;
        }
        
        // Blockquotes (>)
        if (line.startsWith('>')) {
            const content = line.replace(/^>\s*/, '');
            htmlLines.push(`<blockquote class="comment-blockquote">${renderInlineMarkdown(content)}</blockquote>`);
            continue;
        }
        
        // Horizontal rule
        if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) {
            htmlLines.push('<hr class="comment-hr">');
            continue;
        }
        
        // Regular paragraph
        htmlLines.push(`<p class="comment-paragraph">${renderInlineMarkdown(line)}</p>`);
    }
    
    // Close any unclosed code block
    if (inCodeBlock && codeBlockContent.length > 0) {
        htmlLines.push(`<pre class="comment-code-block"><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
    }
    
    // Close any unclosed list
    if (inList) {
        htmlLines.push(`</${listType}>`);
    }
    
    return htmlLines.join('');
}

suite('Shared Markdown Renderer Tests', () => {

    suite('escapeHtml', () => {

        test('should return empty string for empty input', () => {
            const result = escapeHtml('');
            assert.strictEqual(result, '');
        });

        test('should preserve whitespace-only strings', () => {
            assert.strictEqual(escapeHtml('   '), '   ');
            assert.strictEqual(escapeHtml(' '), ' ');
            assert.strictEqual(escapeHtml('\t'), '\t');
        });

        test('should escape ampersand', () => {
            assert.strictEqual(escapeHtml('&'), '&amp;');
            assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
        });

        test('should escape less than', () => {
            assert.strictEqual(escapeHtml('<'), '&lt;');
            assert.strictEqual(escapeHtml('<div>'), '&lt;div&gt;');
        });

        test('should escape greater than', () => {
            assert.strictEqual(escapeHtml('>'), '&gt;');
        });

        test('should escape double quotes', () => {
            assert.strictEqual(escapeHtml('"'), '&quot;');
            assert.strictEqual(escapeHtml('say "hello"'), 'say &quot;hello&quot;');
        });

        test('should escape single quotes', () => {
            assert.strictEqual(escapeHtml("'"), '&#039;');
            assert.strictEqual(escapeHtml("it's"), 'it&#039;s');
        });

        test('should handle multiple special characters', () => {
            const result = escapeHtml('<script>alert("xss")</script>');
            assert.strictEqual(result, '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        });

        test('should preserve regular text', () => {
            assert.strictEqual(escapeHtml('hello world'), 'hello world');
            assert.strictEqual(escapeHtml('abc123'), 'abc123');
        });

        test('should preserve unicode characters', () => {
            assert.strictEqual(escapeHtml('你好'), '你好');
            assert.strictEqual(escapeHtml('🌍'), '🌍');
            assert.strictEqual(escapeHtml('émoji'), 'émoji');
        });

        test('should handle non-breaking space character', () => {
            // Non-breaking space should be preserved as-is
            assert.strictEqual(escapeHtml('\u00a0'), '\u00a0');
        });
    });

    suite('renderInlineMarkdown', () => {

        test('should handle empty string', () => {
            const result = renderInlineMarkdown('');
            assert.strictEqual(result, '');
        });

        test('should escape HTML entities', () => {
            const result = renderInlineMarkdown('<script>alert("xss")</script>');
            assert.ok(result.includes('&lt;script&gt;'));
            assert.ok(!result.includes('<script>'));
        });

        test('should render bold text with asterisks', () => {
            const result = renderInlineMarkdown('This is **bold** text');
            assert.ok(result.includes('<strong>bold</strong>'));
        });

        test('should render bold text with underscores', () => {
            const result = renderInlineMarkdown('This is __bold__ text');
            assert.ok(result.includes('<strong>bold</strong>'));
        });

        test('should render italic text with asterisks', () => {
            const result = renderInlineMarkdown('This is *italic* text');
            assert.ok(result.includes('<em>italic</em>'));
        });

        test('should render italic text with underscores', () => {
            const result = renderInlineMarkdown('This is _italic_ text');
            assert.ok(result.includes('<em>italic</em>'));
        });

        test('should render bold and italic combined', () => {
            const result = renderInlineMarkdown('This is ***bold italic*** text');
            assert.ok(result.includes('<strong><em>bold italic</em></strong>'));
        });

        test('should render inline code', () => {
            const result = renderInlineMarkdown('Use the `console.log()` function');
            assert.ok(result.includes('<code class="comment-inline-code">console.log()</code>'));
        });

        test('should render strikethrough', () => {
            const result = renderInlineMarkdown('This is ~~deleted~~ text');
            assert.ok(result.includes('<del>deleted</del>'));
        });

        test('should render links', () => {
            const result = renderInlineMarkdown('Visit [Google](https://google.com) for search');
            assert.ok(result.includes('<a href="https://google.com" class="comment-link" target="_blank" rel="noopener">Google</a>'));
        });

        test('should handle multiple inline formats in same line', () => {
            const result = renderInlineMarkdown('**bold** and *italic* and `code`');
            assert.ok(result.includes('<strong>bold</strong>'));
            assert.ok(result.includes('<em>italic</em>'));
            assert.ok(result.includes('<code class="comment-inline-code">code</code>'));
        });
    });

    suite('renderCommentMarkdown', () => {

        test('should handle empty string', () => {
            const result = renderCommentMarkdown('');
            assert.strictEqual(result, '');
        });

        test('should render paragraphs', () => {
            const result = renderCommentMarkdown('This is a paragraph.');
            assert.ok(result.includes('<p class="comment-paragraph">This is a paragraph.</p>'));
        });

        test('should render multiple paragraphs', () => {
            const result = renderCommentMarkdown('Paragraph 1\n\nParagraph 2');
            assert.ok(result.includes('<p class="comment-paragraph">Paragraph 1</p>'));
            assert.ok(result.includes('<br>'));
            assert.ok(result.includes('<p class="comment-paragraph">Paragraph 2</p>'));
        });

        test('should render h1 heading', () => {
            const result = renderCommentMarkdown('# Heading 1');
            assert.ok(result.includes('<h1 class="comment-heading comment-h1">Heading 1</h1>'));
        });

        test('should render h2 heading', () => {
            const result = renderCommentMarkdown('## Heading 2');
            assert.ok(result.includes('<h2 class="comment-heading comment-h2">Heading 2</h2>'));
        });

        test('should render h3 through h6 headings', () => {
            const result = renderCommentMarkdown('### H3\n#### H4\n##### H5\n###### H6');
            assert.ok(result.includes('<h3 class="comment-heading comment-h3">H3</h3>'));
            assert.ok(result.includes('<h4 class="comment-heading comment-h4">H4</h4>'));
            assert.ok(result.includes('<h5 class="comment-heading comment-h5">H5</h5>'));
            assert.ok(result.includes('<h6 class="comment-heading comment-h6">H6</h6>'));
        });

        test('should render blockquotes', () => {
            const result = renderCommentMarkdown('> This is a quote');
            assert.ok(result.includes('<blockquote class="comment-blockquote">This is a quote</blockquote>'));
        });

        test('should render horizontal rule with dashes', () => {
            const result = renderCommentMarkdown('---');
            assert.ok(result.includes('<hr class="comment-hr">'));
        });

        test('should render horizontal rule with asterisks', () => {
            const result = renderCommentMarkdown('***');
            assert.ok(result.includes('<hr class="comment-hr">'));
        });

        test('should render unordered list with dashes', () => {
            const result = renderCommentMarkdown('- Item 1\n- Item 2');
            assert.ok(result.includes('<ul class="comment-list">'));
            assert.ok(result.includes('<li>Item 1</li>'));
            assert.ok(result.includes('<li>Item 2</li>'));
            assert.ok(result.includes('</ul>'));
        });

        test('should render unordered list with asterisks', () => {
            const result = renderCommentMarkdown('* Item 1\n* Item 2');
            assert.ok(result.includes('<ul class="comment-list">'));
            assert.ok(result.includes('<li>Item 1</li>'));
            assert.ok(result.includes('<li>Item 2</li>'));
        });

        test('should render ordered list', () => {
            const result = renderCommentMarkdown('1. First\n2. Second\n3. Third');
            assert.ok(result.includes('<ol class="comment-list">'));
            assert.ok(result.includes('<li>First</li>'));
            assert.ok(result.includes('<li>Second</li>'));
            assert.ok(result.includes('<li>Third</li>'));
            assert.ok(result.includes('</ol>'));
        });

        test('should render code block without language', () => {
            const result = renderCommentMarkdown('```\nconst x = 1;\n```');
            assert.ok(result.includes('<pre class="comment-code-block">'));
            assert.ok(result.includes('<code>const x = 1;</code>'));
            assert.ok(result.includes('</pre>'));
        });

        test('should render code block with language', () => {
            const result = renderCommentMarkdown('```javascript\nconst x = 1;\n```');
            assert.ok(result.includes('<pre class="comment-code-block">'));
            assert.ok(result.includes('<code class="language-javascript">const x = 1;</code>'));
        });

        test('should render code block with TypeScript', () => {
            const result = renderCommentMarkdown('```typescript\nconst x: number = 1;\n```');
            assert.ok(result.includes('<code class="language-typescript">'));
        });

        test('should escape HTML in code blocks', () => {
            const result = renderCommentMarkdown('```\n<div>test</div>\n```');
            assert.ok(result.includes('&lt;div&gt;test&lt;/div&gt;'));
            assert.ok(!result.includes('<div>test</div>'));
        });

        test('should handle unclosed code block', () => {
            const result = renderCommentMarkdown('```\nsome code');
            assert.ok(result.includes('<pre class="comment-code-block">'));
            assert.ok(result.includes('some code'));
        });

        test('should handle inline markdown in headings', () => {
            const result = renderCommentMarkdown('## **Bold** Heading');
            assert.ok(result.includes('<h2 class="comment-heading comment-h2"><strong>Bold</strong> Heading</h2>'));
        });

        test('should handle inline markdown in list items', () => {
            const result = renderCommentMarkdown('- **Bold** item\n- *Italic* item');
            assert.ok(result.includes('<li><strong>Bold</strong> item</li>'));
            assert.ok(result.includes('<li><em>Italic</em> item</li>'));
        });

        test('should handle inline markdown in blockquotes', () => {
            const result = renderCommentMarkdown('> This is **important**');
            assert.ok(result.includes('<blockquote class="comment-blockquote">This is <strong>important</strong></blockquote>'));
        });

        test('should handle complex markdown document', () => {
            const markdown = `# AI Clarification

This is a **summary** of the code.

## Key Points

- Point 1: \`function\` call
- Point 2: *Important* note

\`\`\`javascript
const result = doSomething();
\`\`\`

> Remember to check the docs!`;

            const result = renderCommentMarkdown(markdown);
            
            assert.ok(result.includes('<h1 class="comment-heading comment-h1">AI Clarification</h1>'));
            assert.ok(result.includes('<strong>summary</strong>'));
            assert.ok(result.includes('<h2 class="comment-heading comment-h2">Key Points</h2>'));
            assert.ok(result.includes('<ul class="comment-list">'));
            assert.ok(result.includes('<code class="comment-inline-code">function</code>'));
            assert.ok(result.includes('<em>Important</em>'));
            assert.ok(result.includes('<pre class="comment-code-block">'));
            assert.ok(result.includes('const result = doSomething();'));
            assert.ok(result.includes('<blockquote class="comment-blockquote">Remember to check the docs!</blockquote>'));
        });

        test('should handle AI response format', () => {
            const aiResponse = `🤖 **AI Clarification:**

This function handles user authentication.

**Key aspects:**
1. Validates credentials
2. Creates session token
3. Returns user object

\`\`\`typescript
async function authenticate(user: string, pass: string): Promise<User> {
    // Implementation
}
\`\`\``;

            const result = renderCommentMarkdown(aiResponse);
            
            assert.ok(result.includes('<strong>AI Clarification:</strong>'));
            assert.ok(result.includes('<strong>Key aspects:</strong>'));
            assert.ok(result.includes('<ol class="comment-list">'));
            assert.ok(result.includes('Validates credentials'));
            assert.ok(result.includes('<code class="language-typescript">'));
        });
    });

    suite('Edge Cases', () => {

        test('should handle null-like values gracefully', () => {
            assert.strictEqual(renderInlineMarkdown(''), '');
            assert.strictEqual(renderCommentMarkdown(''), '');
        });

        test('should handle only whitespace', () => {
            const result = renderCommentMarkdown('   ');
            // Whitespace-only lines are treated as empty lines (produce <br>)
            assert.ok(result.includes('<br>'));
        });

        test('should handle very long lines', () => {
            const longLine = 'x'.repeat(10000);
            const result = renderCommentMarkdown(longLine);
            assert.ok(result.includes(longLine));
        });

        test('should handle nested formatting attempts', () => {
            // This tests that we don't break on edge cases
            const result = renderInlineMarkdown('**bold *and italic* together**');
            assert.ok(result.length > 0);
        });

        test('should handle special characters', () => {
            const result = renderCommentMarkdown('Special: <>&"\'');
            assert.ok(result.includes('&lt;'));
            assert.ok(result.includes('&gt;'));
            assert.ok(result.includes('&amp;'));
        });

        test('should handle unicode characters', () => {
            const result = renderCommentMarkdown('Unicode: 你好 🌍 émoji');
            assert.ok(result.includes('你好'));
            assert.ok(result.includes('🌍'));
            assert.ok(result.includes('émoji'));
        });

        test('should handle mixed list types', () => {
            const result = renderCommentMarkdown('- Unordered\n\n1. Ordered');
            assert.ok(result.includes('<ul class="comment-list">'));
            assert.ok(result.includes('<ol class="comment-list">'));
        });
    });
});

