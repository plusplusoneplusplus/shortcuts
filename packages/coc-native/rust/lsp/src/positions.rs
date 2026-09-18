//! Position arithmetic between three coordinate systems.
//!
//! The index stores one-based lines and one-based UTF-8 *byte* columns. LSP
//! speaks zero-based lines and UTF-16 code-unit characters. A file full of
//! ASCII makes the two look identical, which is exactly why the conversion
//! needs its own tests: the day a comment carries an em dash, an off-by-`n`
//! jump is the only symptom.

/// The line `line` (zero-based) of `source`, without its line terminator.
pub fn line_text(source: &str, line: u32) -> Option<&str> {
    source.split('\n').nth(line as usize).map(|text| text.strip_suffix('\r').unwrap_or(text))
}

/// The C-family identifier under a zero-based LSP position, if any.
///
/// A cursor sitting immediately after a word counts as being in it — that is
/// what Monaco's own `getWordAtPosition` does, and "go to definition" with the
/// caret parked at the end of a token is the common case.
pub fn word_at(source: &str, line: u32, character: u32) -> Option<String> {
    let text = line_text(source, line)?;
    let offset = byte_offset(text, character);
    let bytes = text.as_bytes();
    let mut start = offset;
    let mut end = offset;
    if !bytes.get(offset).is_some_and(|byte| is_word_byte(*byte)) {
        // Not inside a word: step back one character and try again there.
        start = previous_boundary(text, offset)?;
        if !bytes.get(start).is_some_and(|byte| is_word_byte(*byte)) {
            return None;
        }
        end = offset;
    }
    while start > 0 {
        let previous = previous_boundary(text, start)?;
        if !is_word_byte(bytes[previous]) {
            break;
        }
        start = previous;
    }
    while end < bytes.len() && is_word_byte(bytes[end]) {
        end += 1;
    }
    if start == end {
        return None;
    }
    Some(text[start..end].to_owned())
}

/// The UTF-16 character offset of a one-based UTF-8 byte column.
pub fn utf16_character(text: &str, utf8_column: u32) -> u32 {
    let offset = utf8_column.saturating_sub(1) as usize;
    let mut end = offset.min(text.len());
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    utf16_len(&text[..end])
}

/// Length of `text` in UTF-16 code units — the unit an LSP character counts in.
pub fn utf16_len(text: &str) -> u32 {
    text.chars().map(|character| character.len_utf16() as u32).sum()
}

/// Byte offset of a UTF-16 character offset, clamped to the end of the line.
fn byte_offset(text: &str, character: u32) -> usize {
    let mut remaining = character;
    for (offset, value) in text.char_indices() {
        if remaining == 0 {
            return offset;
        }
        let units = value.len_utf16() as u32;
        // A position that lands inside a surrogate pair resolves to the start
        // of the character that pair encodes; there is no smaller unit here.
        if remaining < units {
            return offset;
        }
        remaining -= units;
    }
    text.len()
}

fn previous_boundary(text: &str, offset: usize) -> Option<usize> {
    if offset == 0 {
        return None;
    }
    let mut previous = offset - 1;
    while previous > 0 && !text.is_char_boundary(previous) {
        previous -= 1;
    }
    Some(previous)
}

/// `$` is not standard C, but every compiler CoC's users target accepts it in
/// identifiers, and the extractor already stores such names.
fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$' || byte >= 0x80
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_word_under_and_just_after_the_cursor() {
        let source = "int total = compute(x);\n";
        assert_eq!(word_at(source, 0, 12).as_deref(), Some("compute"));
        assert_eq!(word_at(source, 0, 15).as_deref(), Some("compute"));
        // Just past the final `e`, still the same token.
        assert_eq!(word_at(source, 0, 19).as_deref(), Some("compute"));
        assert_eq!(word_at(source, 0, 20).as_deref(), Some("x"));
    }

    #[test]
    fn punctuation_with_nothing_before_it_is_not_a_word() {
        assert_eq!(word_at("  (a);\n", 0, 0), None);
        assert_eq!(word_at("  (a);\n", 0, 2), None);
    }

    #[test]
    fn counts_characters_past_a_multi_byte_prefix() {
        // `é` is two UTF-8 bytes and one UTF-16 unit.
        let source = "// é\nint widen(void);\n";
        assert_eq!(word_at(source, 1, 4).as_deref(), Some("widen"));
        assert_eq!(line_text(source, 0), Some("// é"));
    }

    #[test]
    fn a_surrogate_pair_is_one_character_in_the_index_and_two_in_lsp() {
        // `𝕏` is four UTF-8 bytes and two UTF-16 units.
        let line = "int 𝕏x = 1;";
        // The index column for `x` is one past the four bytes of `𝕏`, plus the
        // four leading ASCII bytes, one-based.
        assert_eq!(utf16_character(line, 9), 6);
        assert_eq!(utf16_len("𝕏"), 2);
        assert_eq!(word_at(line, 0, 4).as_deref(), Some("𝕏x"));
    }

    #[test]
    fn a_column_past_the_line_clamps_to_its_end() {
        assert_eq!(utf16_character("ab", 99), 2);
        assert_eq!(utf16_character("ab", 0), 0);
    }

    #[test]
    fn a_carriage_return_is_not_part_of_the_line() {
        assert_eq!(line_text("a\r\nb\r\n", 0), Some("a"));
        assert_eq!(word_at("int crlf;\r\nint next;\r\n", 1, 4).as_deref(), Some("next"));
    }

    #[test]
    fn a_line_past_the_end_has_no_word() {
        assert_eq!(word_at("int a;\n", 9, 0), None);
        assert_eq!(line_text("int a;\n", 9), None);
    }
}
