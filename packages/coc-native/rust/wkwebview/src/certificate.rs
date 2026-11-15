//! Reads the site-info summary (display names and validity) out of a DER X.509
//! certificate. Only the fields site information shows are parsed; anything
//! malformed yields `None`.

use serde_json::{json, Value};

const MAX_NAME_CHARS: usize = 256;

/// `{subject, issuer, validStart, validExpiry}` with Unix-second times, the shape
/// the desktop reports for the other engines.
pub fn summary(der: &[u8]) -> Option<Value> {
    let (certificate, _) = element(der, 0x30)?;
    let (mut tbs, _) = element(certificate, 0x30)?;
    // Optional explicit version.
    if tbs.first() == Some(&0xA0) {
        tbs = element(tbs, 0xA0)?.1;
    }
    let (_, rest) = element(tbs, 0x02)?; // serial number
    let (_, rest) = element(rest, 0x30)?; // signature algorithm
    let (issuer, rest) = element(rest, 0x30)?;
    let (validity, rest) = element(rest, 0x30)?;
    let (subject, _) = element(rest, 0x30)?;
    let (valid_start, rest) = time(validity)?;
    let (valid_expiry, _) = time(rest)?;
    Some(json!({
        "subject": display_name(subject)?,
        "issuer": display_name(issuer)?,
        "validStart": valid_start,
        "validExpiry": valid_expiry,
    }))
}

/// Splits one DER element with the expected tag into (contents, rest).
fn element(input: &[u8], tag: u8) -> Option<(&[u8], &[u8])> {
    let (&found, input) = input.split_first()?;
    if found != tag {
        return None;
    }
    let (&first, mut input) = input.split_first()?;
    let length = if first < 0x80 {
        first as usize
    } else {
        let count = (first & 0x7F) as usize;
        if count == 0 || count > 4 || input.len() < count {
            return None;
        }
        let length =
            input[..count].iter().fold(0usize, |length, byte| length << 8 | *byte as usize);
        input = &input[count..];
        length
    };
    (input.len() >= length).then(|| input.split_at(length))
}

/// Any element: (tag, contents, rest).
fn any_element(input: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let tag = *input.first()?;
    element(input, tag).map(|(contents, rest)| (tag, contents, rest))
}

/// Common name, else organization, else organizational unit (Chromium's display name).
fn display_name(name: &[u8]) -> Option<String> {
    const OIDS: [[u8; 3]; 3] = [[0x55, 0x04, 0x03], [0x55, 0x04, 0x0A], [0x55, 0x04, 0x0B]];
    let mut found: [Option<String>; 3] = [None, None, None];
    let mut sets = name;
    while !sets.is_empty() {
        let (mut set, rest) = element(sets, 0x31)?;
        sets = rest;
        while !set.is_empty() {
            let (attribute, rest) = element(set, 0x30)?;
            set = rest;
            let (oid, value) = element(attribute, 0x06)?;
            let Some(index) = OIDS.iter().position(|known| known == oid) else { continue };
            if found[index].is_none() {
                let (tag, contents, _) = any_element(value)?;
                found[index] = string(tag, contents);
            }
        }
    }
    Some(found.into_iter().flatten().next().unwrap_or_default())
}

fn string(tag: u8, contents: &[u8]) -> Option<String> {
    let text = match tag {
        // UTF8String, PrintableString, IA5String, T61String (Latin-1 in practice).
        0x0C | 0x13 | 0x16 => String::from_utf8(contents.to_vec()).ok()?,
        0x14 => contents.iter().map(|byte| *byte as char).collect(),
        // BMPString
        0x1E if contents.len().is_multiple_of(2) => char::decode_utf16(
            contents.chunks(2).map(|pair| u16::from_be_bytes([pair[0], pair[1]])),
        )
        .collect::<Result<String, _>>()
        .ok()?,
        _ => return None,
    };
    Some(text.chars().filter(|c| !c.is_control()).take(MAX_NAME_CHARS).collect())
}

/// UTCTime (`YYMMDDHHMMSSZ`) or GeneralizedTime (`YYYYMMDDHHMMSSZ`) as Unix seconds.
fn time(input: &[u8]) -> Option<(i64, &[u8])> {
    let (tag, contents, rest) = any_element(input)?;
    let text = std::str::from_utf8(contents).ok()?;
    let digits = text.strip_suffix('Z')?;
    if !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let (year, digits) = match (tag, digits.len()) {
        (0x17, 12) => {
            let year: i64 = digits[..2].parse().ok()?;
            (if year >= 50 { 1900 + year } else { 2000 + year }, &digits[2..])
        }
        (0x18, 14) => (digits[..4].parse().ok()?, &digits[4..]),
        _ => return None,
    };
    let field = |index: usize| digits[index * 2..index * 2 + 2].parse::<i64>().ok();
    let (month, day, hour, minute, second) =
        (field(0)?, field(1)?, field(2)?, field(3)?, field(4)?);
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    Some((days_from_civil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second, rest))
}

/// Days since 1970-01-01 in the proleptic Gregorian calendar.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_common_name_and_utc_times() {
        let summary = summary(include_bytes!("../testdata/self-signed.der")).unwrap();
        assert_eq!(
            summary,
            json!({ "subject": "coc.test", "issuer": "coc.test", "validStart": 1_794_579_497, "validExpiry": 1_794_665_897 })
        );
    }

    #[test]
    fn falls_back_to_organization_and_reads_generalized_time() {
        let summary = summary(include_bytes!("../testdata/org-only-2050.der")).unwrap();
        assert_eq!(summary["subject"], "Only Org");
        assert_eq!(summary["validStart"], 1_794_579_497);
        assert_eq!(summary["validExpiry"], 2_658_579_497i64);
    }

    #[test]
    fn rejects_malformed_input() {
        let der = include_bytes!("../testdata/self-signed.der");
        assert!(summary(&[]).is_none());
        assert!(summary(&der[..der.len() / 2]).is_none());
        assert!(summary(&[0x30, 0x84, 0xFF, 0xFF, 0xFF, 0xFF]).is_none());
        assert!(summary(&[0x31, 0x00]).is_none());
    }

    #[test]
    fn converts_dates() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(time(b"\x17\x0d491231235959Z").unwrap().0, 2_524_607_999);
        assert_eq!(time(b"\x17\x0d500101000000Z").unwrap().0, -631_152_000);
        assert!(time(b"\x17\x0d501301000000Z").is_none());
        assert!(time(b"\x18\x0d500101000000Z").is_none());
    }

    #[test]
    fn decodes_string_types_and_strips_control_characters() {
        assert_eq!(string(0x1E, &[0x00, 0x41, 0x00, 0x0A, 0x00, 0x42]).as_deref(), Some("AB"));
        assert_eq!(string(0x14, &[0xE9]).as_deref(), Some("é"));
        assert_eq!(string(0x0C, &"x".repeat(400).into_bytes()).unwrap().len(), MAX_NAME_CHARS);
        assert!(string(0x04, b"x").is_none());
    }
}
