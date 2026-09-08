//! `Date.prototype.toISOString` for file modification times.
//!
//! The tree response carries `lastModifiedAt` strings that the SPA parses and
//! diffs, so they have to keep coming out exactly as
//! `new Date(stat.mtimeMs).toISOString()` rendered them: UTC, always three
//! fractional digits, and the expanded `±YYYYYY` year form outside 0000–9999.

use std::time::{SystemTime, UNIX_EPOCH};

const MS_PER_DAY: i64 = 86_400_000;

/// Milliseconds since the Unix epoch, matching Node's `stat.mtimeMs` truncated
/// the way the `Date` constructor truncates it: toward zero, not toward
/// negative infinity.
pub fn unix_millis(time: SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(delta) => delta.as_secs() as i64 * 1000 + delta.subsec_millis() as i64,
        Err(err) => {
            let delta = err.duration();
            -(delta.as_secs() as i64 * 1000 + delta.subsec_millis() as i64)
        }
    }
}

/// Render epoch milliseconds the way `toISOString` does.
pub fn format_iso_instant(millis: i64) -> String {
    let days = millis.div_euclid(MS_PER_DAY);
    let time_of_day = millis.rem_euclid(MS_PER_DAY);

    let (year, month, day) = civil_from_days(days);
    let hour = time_of_day / 3_600_000;
    let minute = time_of_day / 60_000 % 60;
    let second = time_of_day / 1_000 % 60;
    let milli = time_of_day % 1_000;

    let year_part = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else if year < 0 {
        format!("-{:06}", -year)
    } else {
        format!("+{year:06}")
    };

    format!("{year_part}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}Z")
}

/// Howard Hinnant's `civil_from_days`: proleptic Gregorian date for a count of
/// days since 1970-01-01, valid across the whole `i64` range we can reach.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    // Shift the epoch to 0000-03-01 so leap days land at the end of the cycle.
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let march_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * march_month + 2) / 5 + 1;
    let month = if march_month < 10 { march_month + 3 } else { march_month - 9 };
    (if month <= 2 { year + 1 } else { year }, month, day)
}
