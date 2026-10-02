//! Pure single-byte-range parsing shared by the LAN and BT HTTP adapters.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RangeRequest {
    Absent,
    From { start: u64, end: Option<u64> },
    Suffix(u64),
    Invalid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ResolvedRange {
    pub start: u64,
    pub length: u64,
    pub partial: bool,
}

impl ResolvedRange {
    pub fn end(self) -> u64 {
        // Only nonempty partial responses use this value in Content-Range.
        self.start + self.length.saturating_sub(1)
    }
}

impl RangeRequest {
    pub fn resolve(self, total: u64) -> Option<ResolvedRange> {
        let (start, end) = match self {
            Self::Absent => {
                return Some(ResolvedRange {
                    start: 0,
                    length: total,
                    partial: false,
                });
            }
            Self::Suffix(length) if length > 0 && total > 0 => {
                (total.saturating_sub(length), total - 1)
            }
            Self::From { start, end } if start < total && end.is_none_or(|end| end >= start) => {
                (start, end.unwrap_or(total - 1).min(total - 1))
            }
            _ => return None,
        };
        Some(ResolvedRange {
            start,
            length: end - start + 1,
            partial: true,
        })
    }
}

pub(crate) fn parse_request_range(request: &str) -> RangeRequest {
    let mut values = request
        .lines()
        .skip(1)
        .take_while(|line| !line.is_empty())
        .filter_map(|line| line.split_once(':'))
        .filter(|(name, _)| name.eq_ignore_ascii_case("range"))
        .map(|(_, value)| value);
    let Some(value) = values.next() else {
        return RangeRequest::Absent;
    };
    // Multiple fields are a combined range list. Neither adapter serves multipart.
    if values.next().is_some() {
        return RangeRequest::Invalid;
    }
    parse_range(value).unwrap_or(RangeRequest::Invalid)
}

fn parse_range(value: &str) -> Option<RangeRequest> {
    let (unit, value) = value.trim().split_once('=')?;
    if !unit.eq_ignore_ascii_case("bytes") {
        return None;
    }
    let (start, end) = value.split_once('-')?;
    if start.is_empty() {
        return Some(RangeRequest::Suffix(decimal(end)?));
    }
    Some(RangeRequest::From {
        start: decimal(start)?,
        end: if end.is_empty() {
            None
        } else {
            Some(decimal(end)?)
        },
    })
}

pub(crate) fn decimal(value: &str) -> Option<u64> {
    // Rust's integer parser accepts a leading '+', which HTTP byte positions do not.
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

#[cfg(test)]
#[path = "http_range_tests.rs"]
mod tests;
