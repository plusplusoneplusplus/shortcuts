//! Replace in search results: rewrite exactly the spans the client sent back.
//!
//! A replace never re-searches the repo. The client sends, per file, each
//! matched span as it looked when the search ran — line, the line's text, and
//! UTF-16 columns — and only those spans are rewritten. A file whose lines no
//! longer read that way is skipped whole and reported, never half-written.
//!
//! The matcher is JavaScript's `RegExp` in non-unicode mode (via `regress`
//! over UTF-16 code units), because the query, the columns and `$1` expansion
//! all come from a browser that searched with JavaScript semantics.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use regress::{Flags, Match, Regex};

use super::blob::{is_binary, MAX_BLOB_SIZE};
use super::{resolve_in_root, RepoFilesError};

/// One matched span to rewrite. Numbers are JSON numbers, kept as `f64` so a
/// fractional or out-of-range value reads as stale, as it always has.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "napi", napi_derive::napi(object, js_name = "RepoReplaceTarget"))]
pub struct ReplaceTarget {
    /// One-based line number.
    pub line: f64,
    /// The line's full text at search time, without its terminator.
    pub text: String,
    /// UTF-16 offset of the match within `text`.
    pub start_column: f64,
    /// UTF-16 offset one past the end of the match.
    pub end_column: f64,
}

#[derive(Debug, Clone)]
#[cfg_attr(feature = "napi", napi_derive::napi(object, js_name = "RepoReplaceFile"))]
pub struct ReplaceFile {
    /// Repo-relative path.
    pub path: String,
    pub targets: Vec<ReplaceTarget>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ReplaceOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
    /// Carry the matched text's casing over to the replacement.
    pub preserve_case: bool,
}

/// Why one file was left alone: `stale`, `missing` or `unreadable`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(
    feature = "napi",
    napi_derive::napi(object, object_from_js = false, js_name = "RepoReplaceSkip")
)]
pub struct ReplaceSkip {
    pub path: String,
    #[cfg_attr(feature = "napi", napi(ts_type = "'stale' | 'missing' | 'unreadable'"))]
    pub reason: &'static str,
    /// Human-readable detail, safe to show in the UI.
    pub message: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
#[cfg_attr(
    feature = "napi",
    napi_derive::napi(object, object_from_js = false, js_name = "RepoReplaceResult")
)]
pub struct ReplaceSummary {
    pub replaced_matches: u32,
    pub replaced_files: u32,
    pub skipped: Vec<ReplaceSkip>,
}

/// The query as a JavaScript `RegExp`: literal unless `regex`, `\b` fences
/// under `whole_word`, case-insensitive unless `case_sensitive`.
pub fn build_matcher(query: &str, options: ReplaceOptions) -> Result<Regex, RepoFilesError> {
    let invalid = |message: String| Err(RepoFilesError::InvalidArg(message));
    if query.is_empty() {
        return invalid("Missing required field: query".into());
    }
    if query.contains(['\r', '\n']) {
        return invalid("Replace does not support multi-line queries".into());
    }
    let body = if options.regex {
        query.to_owned()
    } else {
        query.chars().fold(String::new(), |mut out, c| {
            if ".*+?^${}()|[]\\".contains(c) {
                out.push('\\');
            }
            out.push(c);
            out
        })
    };
    let pattern = if options.whole_word { format!("\\b(?:{body})\\b") } else { body };
    let flags = Flags { icase: !options.case_sensitive, ..Flags::default() };
    // Non-unicode mode sees the pattern as UTF-16 code units, as JavaScript does.
    Regex::from_unicode(pattern.encode_utf16().map(u32::from), flags)
        .or_else(|e| invalid(format!("Invalid regular expression: {e}")))
}

/// VS Code's "preserve case": `FOO` → upper, `foo` → lower, `Foo` → capitalized;
/// mixed casing is left exactly as typed.
pub fn preserve_case(matched: &str, replacement: &str) -> String {
    if matched.is_empty()
        || replacement.is_empty()
        || !matched.chars().any(|c| c.is_ascii_alphabetic())
    {
        return replacement.to_owned();
    }
    let lower = matched.to_lowercase();
    if matched == matched.to_uppercase() && matched != lower {
        return replacement.to_uppercase();
    }
    if matched == lower {
        return replacement.to_lowercase();
    }
    let split = |s: &str| {
        let first = s.chars().next().map_or(0, char::len_utf8);
        (s[..first].to_owned(), s[first..].to_owned())
    };
    let (head, tail) = split(matched);
    if head == head.to_uppercase() && tail == tail.to_lowercase() {
        let (head, tail) = split(replacement);
        return head.to_uppercase() + &tail.to_lowercase();
    }
    replacement.to_owned()
}

/// Expand `$$`, `$&` and `$n`/`$nn` against `found` within `line`. An unknown
/// or unmatched group is left as written; literal mode leaves `$` alone.
fn expand(replacement: &str, found: &Match, line: &[u16], regex: bool) -> Vec<u16> {
    let mut out = Vec::new();
    let mut rest = replacement;
    while let Some(at) = rest.find('$').filter(|_| regex) {
        out.extend(rest[..at].encode_utf16());
        let after = &rest[at + 1..];
        let digits = after.bytes().take(2).take_while(u8::is_ascii_digit).count();
        let (token_len, value) = match after.as_bytes().first() {
            Some(b'$') => (1, Some(vec![u16::from(b'$')])),
            Some(b'&') => (1, Some(line[found.range()].to_vec())),
            _ if digits > 0 => {
                let index: usize = after[..digits].parse().unwrap_or(usize::MAX);
                (digits, found.group(index).map(|r| line[r].to_vec()))
            }
            _ => (0, None),
        };
        match value {
            Some(value) => out.extend(value),
            None => out.extend(rest[at..at + 1 + token_len].encode_utf16()),
        }
        rest = &after[token_len..];
    }
    out.extend(rest.encode_utf16());
    out
}

/// The first match exactly at `[start, end)`, scanning like a global `exec`
/// loop: a zero-width hit advances by one code unit.
fn match_at(matcher: &Regex, line: &[u16], start: f64, end: f64) -> Option<Match> {
    let mut from = 0;
    while from <= line.len() {
        let hit = matcher.find_from_ucs2(line, from).next()?;
        if hit.start() as f64 == start && hit.end() as f64 == end {
            return Some(hit);
        }
        from = if hit.end() == hit.start() { hit.end() + 1 } else { hit.end() };
    }
    None
}

/// Rewrite every target span in `content`, or say why the file is stale.
/// Targets on one line apply right-to-left so later columns stay valid; CRLF
/// and a missing trailing newline survive untouched.
pub fn apply_replacements(
    content: &str,
    targets: &[ReplaceTarget],
    matcher: &Regex,
    replacement: &str,
    options: ReplaceOptions,
) -> Result<(String, u32), String> {
    let mut lines: Vec<(String, &str)> = content
        .split('\n')
        .map(|part| match part.strip_suffix('\r') {
            Some(text) => (text.to_owned(), "\r\n"),
            None => (part.to_owned(), "\n"),
        })
        .collect();
    if let Some(last) = lines.last_mut() {
        last.1 = "";
    }

    // Group by line in first-seen order, so the reported stale line is the
    // first one the client listed.
    let mut order: Vec<(f64, Vec<&ReplaceTarget>)> = Vec::new();
    let mut slot: HashMap<u64, usize> = HashMap::new();
    for target in targets {
        let index = *slot.entry(target.line.to_bits()).or_insert_with(|| {
            order.push((target.line, Vec::new()));
            order.len() - 1
        });
        order[index].1.push(target);
    }

    let mut replaced = 0;
    for (line_number, mut line_targets) in order {
        let row = (line_number.fract() == 0.0 && line_number >= 1.0)
            .then(|| line_number as usize - 1)
            .filter(|&i| i < lines.len());
        let Some(row) = row else {
            return Err(format!("Line {line_number} no longer exists"));
        };
        if lines[row].0 != line_targets[0].text {
            return Err(format!("Line {line_number} changed on disk"));
        }
        let original: Vec<u16> = lines[row].0.encode_utf16().collect();
        let mut text = original.clone();
        line_targets.sort_by(|a, b| b.start_column.total_cmp(&a.start_column));
        for target in line_targets {
            let Some(found) = match_at(matcher, &original, target.start_column, target.end_column)
            else {
                return Err(format!(
                    "Match at line {line_number}, column {} no longer matches",
                    target.start_column
                ));
            };
            let mut cased = expand(replacement, &found, &original, options.regex);
            if options.preserve_case {
                let matched = String::from_utf16_lossy(&original[found.range()]);
                cased = preserve_case(&matched, &String::from_utf16_lossy(&cased))
                    .encode_utf16()
                    .collect();
            }
            let (start, end) = (target.start_column as usize, target.end_column as usize);
            text.splice(start..end, cased);
            replaced += 1;
        }
        lines[row].0 = String::from_utf16_lossy(&text);
    }
    Ok((lines.iter().map(|(text, eol)| format!("{text}{eol}")).collect(), replaced))
}

/// Replace the supplied spans in each file under `root`. The matcher is built
/// before any file is touched, so a bad query fails the whole request; a path
/// escaping the root aborts it (earlier files stay written, as before).
pub fn replace_content(
    root: &Path,
    query: &str,
    replacement: &str,
    files: &[ReplaceFile],
    options: ReplaceOptions,
) -> Result<ReplaceSummary, RepoFilesError> {
    let matcher = build_matcher(query, options)?;
    let mut summary = ReplaceSummary::default();
    for file in files {
        let path = resolve_in_root(root, &file.path)?;
        let skip = |reason, message: &str| ReplaceSkip {
            path: file.path.clone(),
            reason,
            message: message.to_owned(),
        };
        let bytes = match fs::metadata(&path) {
            Ok(meta) if !meta.is_file() => Err(skip("unreadable", "Not a file")),
            Ok(meta) if meta.len() > MAX_BLOB_SIZE => {
                Err(skip("unreadable", "File is too large to replace in"))
            }
            Ok(_) => fs::read(&path).map_err(|_| skip("missing", "File no longer exists")),
            Err(_) => Err(skip("missing", "File no longer exists")),
        }
        .and_then(|b| {
            if is_binary(&b) {
                Err(skip("unreadable", "File is binary"))
            } else {
                Ok(b)
            }
        });
        let outcome = bytes.and_then(|bytes| {
            let content = String::from_utf8_lossy(&bytes);
            apply_replacements(&content, &file.targets, &matcher, replacement, options)
                .map_err(|message| skip("stale", &message))
        });
        match outcome {
            Err(skipped) => summary.skipped.push(skipped),
            Ok((_, 0)) => {}
            Ok((content, count)) => {
                fs::write(&path, content)?;
                summary.replaced_matches += count;
                summary.replaced_files += 1;
            }
        }
    }
    Ok(summary)
}
