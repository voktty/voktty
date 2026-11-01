/// Uses the portable UTC filename, never filesystem creation or modification time.
pub fn handoff_created_at_ms(name: &str) -> Option<u64> {
    if name.len() > 256
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\'))
    {
        return None;
    }
    let prefix = name.as_bytes().get(..16)?;
    if prefix[4] != b'-' || prefix[7] != b'-' || prefix[10] != b'-' || prefix[15] != b'-' {
        return None;
    }
    let agent = name.get(16..)?.strip_suffix(".md")?;
    if agent.is_empty() {
        return None;
    }
    let number = |start: usize, end: usize| {
        prefix[start..end].iter().try_fold(0u64, |n, byte| {
            byte.is_ascii_digit()
                .then(|| n * 10 + u64::from(byte - b'0'))
        })
    };
    let (year, month, day, hour, minute) = (
        number(0, 4)?,
        number(5, 7)?,
        number(8, 10)?,
        number(11, 13)?,
        number(13, 15)?,
    );
    if year < 1970 || !(1..=12).contains(&month) || hour > 23 || minute > 59 {
        return None;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if day == 0 || day > days_in_month[(month - 1) as usize] {
        return None;
    }
    let preceding = year - 1;
    let days = preceding * 365 + preceding / 4 - preceding / 100 + preceding / 400 - 719162
        + days_in_month[..(month - 1) as usize].iter().sum::<u64>()
        + day
        - 1;
    Some(((days * 24 + hour) * 60 + minute) * 60000)
}
