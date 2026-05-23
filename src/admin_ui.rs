use axum::{
    extract::{Form, Path, Query, State},
    response::{Html, IntoResponse, Redirect, Response},
};
use serde::Deserialize;

use crate::{
    field_api::{
        DynFieldApi, FieldApiError, ShiftFilter, StaffAssignment, StaffAssignmentInput,
        StaffAvailability, StaffProfile, StaffProfileFilter, StaffProfileInput,
    },
    AppState,
};

#[derive(Debug, Deserialize, Default, Clone)]
pub struct AdminQuery {
    pub tenant_id: Option<String>,
    pub status: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub staff_profile_id: Option<String>,
}

pub async fn redirect_admin() -> Redirect {
    Redirect::to("/admin/caddies")
}

pub async fn caddies_index(
    State(state): State<AppState>,
    Query(query): Query<AdminQuery>,
) -> Response {
    let Some(field_api) = state.field_api.clone() else {
        return render_config_error(state.field_api_config_error).into_response();
    };

    match load_admin_data(field_api, query.clone()).await {
        Ok(data) => Html(render_admin_page(&query, &data)).into_response(),
        Err(error) => Html(render_error_page(&error)).into_response(),
    }
}

pub async fn create_caddie(
    State(state): State<AppState>,
    Form(input): Form<StaffProfileInput>,
) -> Response {
    let Some(field_api) = state.field_api.clone() else {
        return render_config_error(state.field_api_config_error).into_response();
    };

    match field_api.create_staff_profile(input).await {
        Ok(_) => Redirect::to("/admin/caddies").into_response(),
        Err(error) => Html(render_error_page(&error)).into_response(),
    }
}

pub async fn update_caddie(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Form(input): Form<StaffProfileInput>,
) -> Response {
    let Some(field_api) = state.field_api.clone() else {
        return render_config_error(state.field_api_config_error).into_response();
    };

    match field_api.update_staff_profile(&id, input).await {
        Ok(_) => Redirect::to("/admin/caddies").into_response(),
        Err(error) => Html(render_error_page(&error)).into_response(),
    }
}

pub async fn create_shift(
    State(state): State<AppState>,
    Form(input): Form<StaffAssignmentInput>,
) -> Response {
    let Some(field_api) = state.field_api.clone() else {
        return render_config_error(state.field_api_config_error).into_response();
    };

    match field_api.create_staff_assignment(input).await {
        Ok(_) => Redirect::to("/admin/caddies").into_response(),
        Err(error) => Html(render_error_page(&error)).into_response(),
    }
}

pub async fn update_shift(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Form(input): Form<StaffAssignmentInput>,
) -> Response {
    let Some(field_api) = state.field_api.clone() else {
        return render_config_error(state.field_api_config_error).into_response();
    };

    match field_api.update_staff_assignment(&id, input).await {
        Ok(_) => Redirect::to("/admin/caddies").into_response(),
        Err(error) => Html(render_error_page(&error)).into_response(),
    }
}

pub async fn cancel_shift(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let Some(field_api) = state.field_api.clone() else {
        return render_config_error(state.field_api_config_error).into_response();
    };

    match field_api.cancel_staff_assignment(&id).await {
        Ok(_) => Redirect::to("/admin/caddies").into_response(),
        Err(error) => Html(render_error_page(&error)).into_response(),
    }
}

struct AdminData {
    profiles: Vec<StaffProfile>,
    availability: Vec<StaffAvailability>,
    assignments: Vec<StaffAssignment>,
}

async fn load_admin_data(
    field_api: DynFieldApi,
    query: AdminQuery,
) -> Result<AdminData, FieldApiError> {
    let profiles = field_api
        .list_staff_profiles(StaffProfileFilter {
            tenant_id: query.tenant_id.clone().filter(|value| !value.is_empty()),
            status: query.status.clone().filter(|value| !value.is_empty()),
        })
        .await?;
    let shift_filter = ShiftFilter {
        tenant_id: query.tenant_id.clone().filter(|value| !value.is_empty()),
        date_from: query.date_from.clone().filter(|value| !value.is_empty()),
        date_to: query.date_to.clone().filter(|value| !value.is_empty()),
        staff_profile_id: query
            .staff_profile_id
            .clone()
            .filter(|value| !value.is_empty()),
    };
    let availability = field_api
        .list_staff_availability(shift_filter.clone())
        .await?;
    let assignments = field_api.list_staff_assignments(shift_filter).await?;

    Ok(AdminData {
        profiles,
        availability,
        assignments,
    })
}

fn render_config_error(message: Option<String>) -> Html<String> {
    Html(page(
        "Caddie admin is not configured",
        &format!(
            r#"<section class="panel"><h2>Admin UI configuration required</h2><p>{}</p><p>Set <code>TACHYON_FIELD_API_URL</code> and configure a field API token provider such as <code>TACHYON_FIELD_API_BEARER_TOKEN</code> through deployment secrets.</p></section>"#,
            escape(
                message
                    .as_deref()
                    .unwrap_or("Field API client is unavailable.")
            )
        ),
    ))
}

fn render_error_page(error: &FieldApiError) -> String {
    page(
        "Caddie admin error",
        &format!(
            r#"<section class="panel error"><h2>Field API request failed</h2><p>{}</p></section>"#,
            escape(&error.to_string())
        ),
    )
}

fn render_admin_page(query: &AdminQuery, data: &AdminData) -> String {
    let active_profiles = data
        .profiles
        .iter()
        .filter(|profile| profile.status.as_deref() != Some("inactive"))
        .count();
    let inactive_profiles = data.profiles.len().saturating_sub(active_profiles);
    let body = format!(
        r#"
<section class="toolbar">
  <form method="get" action="/admin/caddies">
    <label>Tenant <input name="tenant_id" value="{tenant_id}" placeholder="scc"></label>
    <label>Status
      <select name="status">
        {status_options}
      </select>
    </label>
    <label>From <input type="date" name="date_from" value="{date_from}"></label>
    <label>To <input type="date" name="date_to" value="{date_to}"></label>
    <button type="submit">Apply</button>
  </form>
</section>
<section class="metrics" aria-label="Caddie counts">
  <div><strong>{active_profiles}</strong><span>Active caddies</span></div>
  <div><strong>{inactive_profiles}</strong><span>Inactive caddies</span></div>
  <div><strong>{assignment_count}</strong><span>Scheduled shifts</span></div>
  <div><strong>{availability_count}</strong><span>Availability rows</span></div>
</section>
{profile_create_form}
{profiles_table}
{shift_create_form}
{assignments_table}
{availability_table}
"#,
        tenant_id = escape(query.tenant_id.as_deref().unwrap_or_default()),
        status_options = status_options(query.status.as_deref()),
        date_from = escape(query.date_from.as_deref().unwrap_or_default()),
        date_to = escape(query.date_to.as_deref().unwrap_or_default()),
        active_profiles = active_profiles,
        inactive_profiles = inactive_profiles,
        assignment_count = data.assignments.len(),
        availability_count = data.availability.len(),
        profile_create_form = profile_create_form(query),
        profiles_table = profiles_table(&data.profiles),
        shift_create_form = shift_create_form(query, &data.profiles),
        assignments_table = assignments_table(&data.assignments, &data.profiles),
        availability_table = availability_table(&data.availability, &data.profiles),
    );
    page("Caddie admin", &body)
}

fn profile_create_form(query: &AdminQuery) -> String {
    format!(
        r#"
<section class="panel">
  <h2>Create caddie profile</h2>
  <form method="post" action="/admin/caddies" class="grid-form">
    <label>Tenant <input name="tenant_id" required value="{tenant_id}"></label>
    <label>StaffMember ID <input name="staff_member_id" required placeholder="staff_..."></label>
    <label>Name <input name="display_name" required></label>
    <label>Status
      <select name="status"><option value="active">active</option><option value="inactive">inactive</option></select>
    </label>
    <label>Phone <input name="phone"></label>
    <label>Email <input type="email" name="email"></label>
    <label class="wide">Notes <input name="notes"></label>
    <button type="submit">Create</button>
  </form>
</section>
"#,
        tenant_id = escape(query.tenant_id.as_deref().unwrap_or_default())
    )
}

fn profiles_table(profiles: &[StaffProfile]) -> String {
    let rows = profiles
        .iter()
        .map(|profile| {
            let status = profile.status.as_deref().unwrap_or("unknown");
            format!(
                r#"<tr class="{row_class}">
  <td>{name}</td>
  <td><code>{id}</code></td>
  <td><code>{staff_member_id}</code></td>
  <td><span class="status {status_class}">{status}</span></td>
  <td>{phone}</td>
  <td>{email}</td>
  <td>
    <form method="post" action="/admin/caddies/{id}" class="inline-form">
      <input type="hidden" name="tenant_id" value="{tenant_id}">
      <input type="hidden" name="staff_member_id" value="{staff_member_id}">
      <input name="display_name" value="{name}">
      <select name="status">{row_status_options}</select>
      <input name="phone" value="{phone}">
      <input name="email" value="{email}">
      <input name="notes" value="{notes}">
      <button type="submit">Save</button>
    </form>
  </td>
</tr>"#,
                row_class = if status == "inactive" {
                    "muted-row"
                } else {
                    ""
                },
                status_class = if status == "inactive" {
                    "inactive"
                } else {
                    "active"
                },
                status = escape(status),
                id = escape(&profile.id),
                tenant_id = escape(profile.tenant_id.as_deref().unwrap_or_default()),
                staff_member_id = escape(profile.staff_member_id.as_deref().unwrap_or_default()),
                name = escape(display_name(profile)),
                phone = escape(profile.phone.as_deref().unwrap_or_default()),
                email = escape(profile.email.as_deref().unwrap_or_default()),
                notes = escape(profile.notes.as_deref().unwrap_or_default()),
                row_status_options = status_options(profile.status.as_deref()),
            )
        })
        .collect::<String>();

    format!(
        r#"
<section class="panel">
  <h2>Caddie profiles</h2>
  <table>
    <thead><tr><th>Name</th><th>Profile ID</th><th>StaffMember</th><th>Status</th><th>Phone</th><th>Email</th><th>Edit</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</section>
"#
    )
}

fn shift_create_form(query: &AdminQuery, profiles: &[StaffProfile]) -> String {
    format!(
        r#"
<section class="panel">
  <h2>Create shift</h2>
  <form method="post" action="/admin/shifts" class="grid-form">
    <label>Tenant <input name="tenant_id" required value="{tenant_id}"></label>
    <label>Caddie
      <select name="staff_profile_id" required>{profile_options}</select>
    </label>
    <label>Reservation <input name="reservation_id" placeholder="optional"></label>
    <label>Date <input type="date" name="date" required value="{date_from}"></label>
    <label>Start <input type="time" name="starts_at" required></label>
    <label>End <input type="time" name="ends_at" required></label>
    <label>Status <input name="status" value="scheduled"></label>
    <label class="wide">Note <input name="note"></label>
    <button type="submit">Schedule</button>
  </form>
</section>
"#,
        tenant_id = escape(query.tenant_id.as_deref().unwrap_or_default()),
        date_from = escape(query.date_from.as_deref().unwrap_or_default()),
        profile_options = profile_options(profiles),
    )
}

fn assignments_table(assignments: &[StaffAssignment], profiles: &[StaffProfile]) -> String {
    let rows = assignments
        .iter()
        .map(|assignment| {
            let profile_name = assignment
                .staff_profile_id
                .as_deref()
                .and_then(|id| profiles.iter().find(|profile| profile.id == id))
                .map(display_name)
                .unwrap_or("");
            let status = assignment.status.as_deref().unwrap_or("scheduled");
            format!(
                r#"<tr class="{row_class}">
  <td>{date}</td>
  <td>{starts_at}-{ends_at}</td>
  <td>{profile_name}<br><code>{staff_profile_id}</code></td>
  <td><code>{reservation_id}</code></td>
  <td><span class="status {status_class}">{status}</span></td>
  <td>
    <form method="post" action="/admin/shifts/{id}" class="inline-form">
      <input type="hidden" name="tenant_id" value="{tenant_id}">
      <input type="hidden" name="staff_profile_id" value="{staff_profile_id}">
      <input name="reservation_id" value="{reservation_id}">
      <input type="date" name="date" value="{date}">
      <input type="time" name="starts_at" value="{starts_at}">
      <input type="time" name="ends_at" value="{ends_at}">
      <input name="status" value="{status}">
      <input name="note" value="{note}">
      <button type="submit">Save</button>
    </form>
    <form method="post" action="/admin/shifts/{id}/cancel" class="cancel-form">
      <button type="submit">Cancel</button>
    </form>
  </td>
</tr>"#,
                row_class = if status == "cancelled" {
                    "muted-row"
                } else {
                    ""
                },
                status_class = if status == "cancelled" {
                    "inactive"
                } else {
                    "active"
                },
                id = escape(&assignment.id),
                tenant_id = escape(assignment.tenant_id.as_deref().unwrap_or_default()),
                date = escape(assignment.date.as_deref().unwrap_or_default()),
                starts_at = escape(assignment.starts_at.as_deref().unwrap_or_default()),
                ends_at = escape(assignment.ends_at.as_deref().unwrap_or_default()),
                profile_name = escape(profile_name),
                staff_profile_id =
                    escape(assignment.staff_profile_id.as_deref().unwrap_or_default()),
                reservation_id = escape(assignment.reservation_id.as_deref().unwrap_or_default()),
                status = escape(status),
                note = escape(assignment.note.as_deref().unwrap_or_default()),
            )
        })
        .collect::<String>();

    format!(
        r#"
<section class="panel">
  <h2>Shift calendar</h2>
  <table>
    <thead><tr><th>Date</th><th>Time</th><th>Caddie</th><th>Reservation</th><th>Status</th><th>Edit</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
  <p class="note">The generic field API exposes PATCH for staff assignments. Cancel uses <code>status=cancelled</code>; hard delete is intentionally not used.</p>
</section>
"#
    )
}

fn availability_table(availability: &[StaffAvailability], profiles: &[StaffProfile]) -> String {
    let rows = availability
        .iter()
        .map(|item| {
            let profile_name = item
                .staff_profile_id
                .as_deref()
                .and_then(|id| profiles.iter().find(|profile| profile.id == id))
                .map(display_name)
                .unwrap_or("");
            format!(
                r#"<tr>
  <td>{date}</td>
  <td>{starts_at}-{ends_at}</td>
  <td>{profile_name}<br><code>{staff_profile_id}</code></td>
  <td><span class="status active">{status}</span></td>
  <td>{note}</td>
</tr>"#,
                date = escape(item.date.as_deref().unwrap_or_default()),
                starts_at = escape(item.starts_at.as_deref().unwrap_or_default()),
                ends_at = escape(item.ends_at.as_deref().unwrap_or_default()),
                profile_name = escape(profile_name),
                staff_profile_id = escape(item.staff_profile_id.as_deref().unwrap_or_default()),
                status = escape(item.status.as_deref().unwrap_or("available")),
                note = escape(item.note.as_deref().unwrap_or_default()),
            )
        })
        .collect::<String>();

    format!(
        r#"
<section class="panel">
  <h2>Availability</h2>
  <table>
    <thead><tr><th>Date</th><th>Time</th><th>Caddie</th><th>Status</th><th>Note</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</section>
"#
    )
}

fn page(title: &str, body: &str) -> String {
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    :root {{ color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    body {{ margin: 0; background: #f6f7f9; color: #18202a; }}
    header {{ background: #143d52; color: #fff; padding: 20px 28px; }}
    h1 {{ font-size: 24px; margin: 0; }}
    h2 {{ font-size: 18px; margin: 0 0 14px; }}
    main {{ max-width: 1440px; margin: 0 auto; padding: 20px; }}
    .toolbar, .panel {{ background: #fff; border: 1px solid #dbe1e7; border-radius: 8px; margin-bottom: 16px; padding: 16px; }}
    .toolbar form, .grid-form {{ display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); align-items: end; }}
    label {{ display: grid; gap: 5px; font-size: 12px; font-weight: 650; color: #4b5966; }}
    input, select, button {{ min-height: 34px; border-radius: 6px; border: 1px solid #b8c2cc; font: inherit; padding: 6px 8px; box-sizing: border-box; }}
    button {{ background: #176b5f; border-color: #176b5f; color: #fff; font-weight: 700; cursor: pointer; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th, td {{ border-bottom: 1px solid #e5e9ee; padding: 10px; text-align: left; vertical-align: top; }}
    th {{ background: #eef3f6; color: #394855; font-size: 12px; text-transform: uppercase; }}
    code {{ background: #eef1f4; border-radius: 4px; padding: 2px 4px; }}
    .metrics {{ display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-bottom: 16px; }}
    .metrics div {{ background: #fff; border: 1px solid #dbe1e7; border-radius: 8px; padding: 14px; }}
    .metrics strong {{ display: block; font-size: 26px; }}
    .metrics span, .note {{ color: #66727d; font-size: 12px; }}
    .status {{ display: inline-block; border-radius: 999px; padding: 3px 8px; font-weight: 700; font-size: 12px; }}
    .status.active {{ background: #dff3ea; color: #0e654d; }}
    .status.inactive {{ background: #eceff3; color: #66727d; }}
    .muted-row {{ color: #78838e; background: #fafbfc; }}
    .inline-form {{ display: grid; gap: 6px; grid-template-columns: repeat(4, minmax(110px, 1fr)); align-items: end; min-width: 560px; }}
    .cancel-form {{ margin-top: 6px; }}
    .cancel-form button {{ background: #8a3b2d; border-color: #8a3b2d; }}
    .wide {{ grid-column: span 2; }}
    .error {{ border-color: #d28a7a; }}
    @media (max-width: 900px) {{
      main {{ padding: 12px; }}
      .panel {{ overflow-x: auto; }}
      .inline-form {{ min-width: 720px; }}
      .wide {{ grid-column: auto; }}
    }}
  </style>
</head>
<body>
  <header><h1>{title}</h1></header>
  <main>{body}</main>
</body>
</html>"#,
        title = escape(title),
        body = body
    )
}

fn status_options(selected: Option<&str>) -> String {
    ["", "active", "inactive"]
        .iter()
        .map(|value| {
            let label = if value.is_empty() { "all" } else { value };
            if Some(*value) == selected {
                format!(
                    r#"<option value="{}" selected>{}</option>"#,
                    escape(value),
                    escape(label)
                )
            } else {
                format!(
                    r#"<option value="{}">{}</option>"#,
                    escape(value),
                    escape(label)
                )
            }
        })
        .collect()
}

fn profile_options(profiles: &[StaffProfile]) -> String {
    profiles
        .iter()
        .filter(|profile| profile.status.as_deref() != Some("inactive"))
        .map(|profile| {
            format!(
                r#"<option value="{}">{} ({})</option>"#,
                escape(&profile.id),
                escape(display_name(profile)),
                escape(profile.staff_member_id.as_deref().unwrap_or("unlinked"))
            )
        })
        .collect()
}

fn display_name(profile: &StaffProfile) -> &str {
    profile.display_name.as_deref().unwrap_or("Unnamed caddie")
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admin_page_distinguishes_active_and_inactive_caddies() {
        let query = AdminQuery {
            tenant_id: Some("scc".to_string()),
            status: None,
            date_from: Some("2026-06-01".to_string()),
            date_to: Some("2026-06-07".to_string()),
            staff_profile_id: None,
        };
        let data = AdminData {
            profiles: vec![
                StaffProfile {
                    id: "sp_active".to_string(),
                    tenant_id: Some("scc".to_string()),
                    staff_member_id: Some("sm_1".to_string()),
                    display_name: Some("Active Caddie".to_string()),
                    status: Some("active".to_string()),
                    role: Some("caddie".to_string()),
                    phone: None,
                    email: None,
                    notes: None,
                    extra: serde_json::Value::Null,
                },
                StaffProfile {
                    id: "sp_inactive".to_string(),
                    tenant_id: Some("scc".to_string()),
                    staff_member_id: Some("sm_2".to_string()),
                    display_name: Some("Inactive Caddie".to_string()),
                    status: Some("inactive".to_string()),
                    role: Some("caddie".to_string()),
                    phone: None,
                    email: None,
                    notes: None,
                    extra: serde_json::Value::Null,
                },
            ],
            availability: vec![],
            assignments: vec![],
        };

        let html = render_admin_page(&query, &data);

        assert!(html.contains("Active caddies"));
        assert!(html.contains("Inactive caddies"));
        assert!(html.contains("StaffMember"));
        assert!(html.contains("sp_inactive"));
        assert!(html.contains("muted-row"));
    }
}
