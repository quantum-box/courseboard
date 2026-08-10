//! Tenant-wide timezone stored in the golf extension config.

use chrono::{DateTime, NaiveDate, NaiveTime, Offset, TimeZone, Utc};
use chrono_tz::Tz;
use serde_json::Value;

use super::CourseError;

/// Compatibility default for tenants whose config predates the timezone key.
pub const DEFAULT_TIMEZONE: &str = "Asia/Tokyo";

/// Resolve the tenant timezone from the shared golf extension config.
///
/// The fallback keeps pre-SCC-6 tenants operational without a data rewrite.
/// Once the key exists, its value is the source of truth; course master values
/// are deliberately not consulted here.
pub fn tenant_timezone_from_config(config: &Value) -> String {
    config
        .get("timezone")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_TIMEZONE)
        .to_string()
}

pub fn parse_tenant_timezone(value: &str) -> Result<Tz, CourseError> {
    value
        .parse::<Tz>()
        .map_err(|_| CourseError::Provider("tenant timezone is not a valid IANA timezone".into()))
}

/// Calendar date at one fixed instant in the tenant timezone.
pub fn tenant_date_at(now: DateTime<Utc>, timezone: &str) -> Result<NaiveDate, CourseError> {
    Ok(now
        .with_timezone(&parse_tenant_timezone(timezone)?)
        .date_naive())
}

/// Inclusive tenant-local dates as the UTC half-open interval stored by Field.
pub fn tenant_day_bounds(
    from: NaiveDate,
    to: NaiveDate,
    timezone: &str,
) -> Result<(DateTime<Utc>, DateTime<Utc>), CourseError> {
    if to < from {
        return Err(CourseError::BadRequest("to must be on or after from"));
    }
    let timezone = parse_tenant_timezone(timezone)?;
    let start = local_datetime(timezone, from, NaiveTime::MIN, "start date")?;
    let next = to
        .succ_opt()
        .ok_or(CourseError::BadRequest("date is out of range"))?;
    let end = local_datetime(timezone, next, NaiveTime::MIN, "end date")?;
    Ok((start.with_timezone(&Utc), end.with_timezone(&Utc)))
}

pub fn format_datetime_in_timezone(
    value: DateTime<Utc>,
    timezone: &str,
) -> Result<String, CourseError> {
    Ok(value
        .with_timezone(&parse_tenant_timezone(timezone)?)
        .format("%Y-%m-%dT%H:%M:%S%:z")
        .to_string())
}

pub fn format_tenant_wall_clock(
    date: NaiveDate,
    hour: u32,
    minute: u32,
    timezone: &str,
) -> Result<String, CourseError> {
    let time = NaiveTime::from_hms_opt(hour, minute, 0)
        .ok_or(CourseError::BadRequest("invalid wall clock"))?;
    Ok(
        local_datetime(parse_tenant_timezone(timezone)?, date, time, "wall clock")?
            .format("%Y-%m-%dT%H:%M:%S%:z")
            .to_string(),
    )
}

pub fn parse_tenant_tee_time(
    date: NaiveDate,
    tee_time: &str,
    timezone: &str,
) -> Result<DateTime<Utc>, CourseError> {
    let bad_format = || CourseError::BadRequest("tee time must look like HH:MM");
    let (hour, minute) = tee_time.split_once(':').ok_or_else(bad_format)?;
    if hour.len() != 2 || minute.len() != 2 {
        return Err(bad_format());
    }
    let time = NaiveTime::from_hms_opt(
        hour.parse().map_err(|_| bad_format())?,
        minute.parse().map_err(|_| bad_format())?,
        0,
    )
    .ok_or_else(bad_format)?;
    Ok(
        local_datetime(parse_tenant_timezone(timezone)?, date, time, "tee time")?
            .with_timezone(&Utc),
    )
}

pub fn utc_offset_minutes_at(instant: DateTime<Utc>, timezone: &str) -> Result<i64, CourseError> {
    Ok(i64::from(
        instant
            .with_timezone(&parse_tenant_timezone(timezone)?)
            .offset()
            .fix()
            .local_minus_utc()
            / 60,
    ))
}

fn local_datetime(
    timezone: Tz,
    date: NaiveDate,
    time: NaiveTime,
    label: &'static str,
) -> Result<DateTime<Tz>, CourseError> {
    timezone
        .from_local_datetime(&date.and_time(time))
        .earliest()
        .ok_or_else(|| CourseError::Provider(format!("{label} does not exist in tenant timezone")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn configured_tenant_timezone_is_resolved() {
        assert_eq!(
            tenant_timezone_from_config(&json!({ "timezone": "Europe/Berlin" })),
            "Europe/Berlin"
        );
    }

    #[test]
    fn pre_timezone_config_keeps_the_compatibility_default() {
        assert_eq!(tenant_timezone_from_config(&json!({})), DEFAULT_TIMEZONE);
        assert_eq!(
            tenant_timezone_from_config(&json!({ "timezone": "  " })),
            DEFAULT_TIMEZONE
        );
    }

    #[test]
    fn berlin_month_uses_both_dst_offsets() {
        let (start, end) = tenant_day_bounds(
            NaiveDate::from_ymd_opt(2026, 3, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 3, 31).unwrap(),
            "Europe/Berlin",
        )
        .unwrap();
        assert_eq!(start.to_rfc3339(), "2026-02-28T23:00:00+00:00");
        assert_eq!(end.to_rfc3339(), "2026-03-31T22:00:00+00:00");
    }

    #[test]
    fn fixed_instant_uses_the_tenant_calendar_date() {
        let now = "2026-08-10T15:30:00Z".parse().unwrap();
        assert_eq!(
            tenant_date_at(now, "Asia/Tokyo").unwrap(),
            NaiveDate::from_ymd_opt(2026, 8, 11).unwrap()
        );
        assert_eq!(
            tenant_date_at(now, "UTC").unwrap(),
            NaiveDate::from_ymd_opt(2026, 8, 10).unwrap()
        );
    }
}
