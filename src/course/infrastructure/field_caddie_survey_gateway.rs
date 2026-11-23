//! Field Forms client for the caddie survey (`/v1/erp/field-forms/*`).
//!
//! The survey is Field's `survey` template with the caddie questions put in
//! by Field's `field.staff_rating` object type: a choice of caddie (each
//! option's value is the caddie profile id), a 1–5 rating, and a comment.
//! Field turns each answer into a caddie rating. Everything here that touches
//! the form's JSON definition stays in this file.
//!
//! Which form is the survey is remembered in the golf extension's tenant
//! config under `caddieSurvey`, beside the other per-tenant CourseBoard
//! settings, so renaming the form in Field does not lose it.

use std::collections::BTreeMap;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::course::domain::{
    forms_not_provided, CaddieSurveyForm, CaddieSurveyGateway, CourseError, GatewayCredentials,
    SurveyCaddieChoice, CADDIE_SURVEY_NAME,
};

use super::field_gateway::{
    field_send_json_classified, normalize_base_url, read_extension_config, urlencoding_path,
    write_extension_config_key, FieldStatusFailure,
};

const FORMS: &str = "/v1/erp/field-forms/forms";
const OBJECT_TYPES: &str = "/v1/erp/field-forms/object-types";
const STAFF_RATING: &str = "field.staff_rating";
/// The properties the survey binds, in the order the guest meets them.
const STAFF_RATING_PROPERTIES: [&str; 3] = ["staff", "score", "comment"];
const CONFIG_KEY: &str = "caddieSurvey";

/// The template's own "how was the staff" rating, which the caddie rating
/// replaces, and its free text, which the bound comment replaces.
const TEMPLATE_SERVICE_KEY: &str = "service";
const TEMPLATE_COMMENT_KEY: &str = "comment";
const STAFF_LABEL: &str = "担当したキャディを選んでください";
const SCORE_LABEL: &str = "キャディの対応はいかがでしたか？";

pub struct FieldCaddieSurveyGateway {
    client: reqwest::Client,
    base_url: String,
}

impl FieldCaddieSurveyGateway {
    pub fn new(client: reqwest::Client, field_api_url: Option<&str>) -> Self {
        Self {
            client,
            base_url: normalize_base_url(field_api_url),
        }
    }

    async fn send<T: for<'de> Deserialize<'de>>(
        &self,
        credentials: GatewayCredentials<'_>,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<T, CourseError> {
        field_send_json_classified(
            &self.client,
            &self.base_url,
            method,
            path,
            credentials,
            body,
            classify_forms_failure,
        )
        .await
    }

    async fn get_form(
        &self,
        credentials: GatewayCredentials<'_>,
        form_id: &str,
    ) -> Result<FormDetailDto, CourseError> {
        let path = format!("{FORMS}/{}", urlencoding_path(form_id));
        self.send(credentials, reqwest::Method::GET, &path, None)
            .await
    }

    async fn build_caddie_fields(
        &self,
        credentials: GatewayCredentials<'_>,
        properties: &[String],
        existing_keys: &[String],
    ) -> Result<BuiltFieldsDto, CourseError> {
        let path = format!("{OBJECT_TYPES}/{STAFF_RATING}/form-fields");
        let body = json!({ "properties": properties, "existingKeys": existing_keys });
        self.send(credentials, reqwest::Method::POST, &path, Some(&body))
            .await
    }

    async fn save_draft(
        &self,
        credentials: GatewayCredentials<'_>,
        form_id: &str,
        definition: Value,
        expected_revision: u32,
    ) -> Result<(), CourseError> {
        let path = format!("{FORMS}/{}/draft", urlencoding_path(form_id));
        let body = json!({ "definition": definition, "expectedRevision": expected_revision });
        let _: Value = self
            .send(credentials, reqwest::Method::PUT, &path, Some(&body))
            .await?;
        Ok(())
    }
}

/// Field answers 403 with a `FEATURE_*` code when the tenant's plan does not
/// deliver Forms; every other failure keeps the default mapping.
fn classify_forms_failure(failure: &FieldStatusFailure<'_>) -> Option<CourseError> {
    let feature_gate = failure.status == reqwest::StatusCode::FORBIDDEN
        && failure
            .code
            .as_deref()
            .is_some_and(|code| code.starts_with("FEATURE_"));
    feature_gate.then(forms_not_provided)
}

#[async_trait]
impl CaddieSurveyGateway for FieldCaddieSurveyGateway {
    async fn remembered_form_id(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Option<String>, CourseError> {
        let config = read_extension_config(&self.client, &self.base_url, credentials).await?;
        Ok(remembered_form_id(&config))
    }

    async fn remember_form_id(
        &self,
        credentials: GatewayCredentials<'_>,
        form_id: &str,
    ) -> Result<(), CourseError> {
        write_extension_config_key(
            &self.client,
            &self.base_url,
            credentials,
            CONFIG_KEY,
            |config| Ok(with_form_id(config, form_id)),
        )
        .await?;
        Ok(())
    }

    async fn find_form(
        &self,
        credentials: GatewayCredentials<'_>,
        form_id: &str,
    ) -> Result<Option<CaddieSurveyForm>, CourseError> {
        match self.get_form(credentials, form_id).await {
            Ok(detail) => Ok(Some(detail.into_form())),
            Err(CourseError::UpstreamClient { status: 404, .. }) => Ok(None),
            Err(error) => Err(error),
        }
    }

    async fn current_caddies(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Option<Vec<SurveyCaddieChoice>>, CourseError> {
        let types: ObjectTypesDto = self
            .send(credentials, reqwest::Method::GET, OBJECT_TYPES, None)
            .await?;
        Ok(types
            .items
            .into_iter()
            .find(|item| item.key == STAFF_RATING)
            .map(|item| {
                item.properties
                    .into_iter()
                    .find(|property| property.key == "staff")
                    .map(|property| {
                        property
                            .choices
                            .into_iter()
                            .map(ChoiceDto::into_choice)
                            .collect()
                    })
                    .unwrap_or_default()
            }))
    }

    async fn create_survey_draft(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CaddieSurveyForm, CourseError> {
        let body = json!({ "name": CADDIE_SURVEY_NAME, "template": "survey" });
        let created: FormDetailDto = self
            .send(credentials, reqwest::Method::POST, FORMS, Some(&body))
            .await?;
        let kept = new_survey_kept_keys(&created.draft);
        let properties: Vec<String> = STAFF_RATING_PROPERTIES.map(String::from).to_vec();
        let built = self
            .build_caddie_fields(credentials, &properties, &kept)
            .await?;
        let definition = compose_new_survey(&created.draft, &built)?;
        self.save_draft(credentials, &created.id, definition, created.draft_revision)
            .await?;
        Ok(self.get_form(credentials, &created.id).await?.into_form())
    }

    async fn publish_form(
        &self,
        credentials: GatewayCredentials<'_>,
        form_id: &str,
    ) -> Result<CaddieSurveyForm, CourseError> {
        let path = format!("{FORMS}/{}/publish", urlencoding_path(form_id));
        let detail: FormDetailDto = self
            .send(credentials, reqwest::Method::POST, &path, None)
            .await?;
        Ok(detail.into_form())
    }

    async fn refresh_caddies(
        &self,
        credentials: GatewayCredentials<'_>,
        form_id: &str,
    ) -> Result<CaddieSurveyForm, CourseError> {
        let detail = self.get_form(credentials, form_id).await?;
        let plan = RefreshPlan::of(&detail.draft);
        let built = self
            .build_caddie_fields(credentials, &plan.properties, &plan.other_keys)
            .await?;
        let definition = rebind_caddies(&detail.draft, &built)?;
        self.save_draft(credentials, form_id, definition, detail.draft_revision)
            .await?;
        self.publish_form(credentials, form_id).await
    }

    fn public_url(&self, public_id: &str) -> String {
        format!(
            "{}/v1/public/forms/{}/frame",
            self.base_url,
            urlencoding_path(public_id)
        )
    }
}

// ─── Remembering the form ─────────────────────────────────────────────────────

fn remembered_form_id(config: &Value) -> Option<String> {
    config
        .get(CONFIG_KEY)
        .and_then(|value| value.get("formId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

fn with_form_id(config: &Value, form_id: &str) -> Value {
    let mut object = config.as_object().cloned().unwrap_or_else(Map::new);
    object.insert(CONFIG_KEY.into(), json!({ "formId": form_id }));
    Value::Object(object)
}

// ─── The form's definition ────────────────────────────────────────────────────

fn field_key(field: &Value) -> Option<&str> {
    field.get("key").and_then(Value::as_str)
}

fn array<'a>(definition: &'a Value, key: &str) -> &'a [Value] {
    definition
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn keys_of(values: &[Value]) -> impl Iterator<Item = String> + '_ {
    values.iter().filter_map(field_key).map(str::to_string)
}

fn is_staff_rating(binding: &Value) -> bool {
    binding.get("objectType").and_then(Value::as_str) == Some(STAFF_RATING)
}

/// Property → the form field that feeds it, for the caddie binding.
fn bound_fields(binding: &Value) -> BTreeMap<String, String> {
    array(binding, "mappings")
        .iter()
        .filter_map(|mapping| {
            let property = mapping.get("property")?.as_str()?;
            let source = mapping.get("source")?;
            if source.get("kind").and_then(Value::as_str) != Some("field") {
                return None;
            }
            Some((
                property.to_string(),
                source.get("key")?.as_str()?.to_string(),
            ))
        })
        .collect()
}

fn caddie_binding(definition: &Value) -> Option<&Value> {
    array(definition, "bindings")
        .iter()
        .find(|b| is_staff_rating(b))
}

/// The caddies a published definition lists: the options of the field bound
/// to the binding's `staff` property.
fn published_caddies(definition: &Value) -> Vec<SurveyCaddieChoice> {
    let Some(staff_key) = caddie_binding(definition)
        .map(bound_fields)
        .and_then(|fields| fields.get("staff").cloned())
    else {
        return Vec::new();
    };
    array(definition, "fields")
        .iter()
        .find(|field| field_key(field) == Some(staff_key.as_str()))
        .map(|field| {
            array(field, "options")
                .iter()
                .filter_map(|option| {
                    Some(SurveyCaddieChoice {
                        id: option.get("value")?.as_str()?.to_string(),
                        name: option.get("label")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The keys a fresh template keeps once the caddie questions take over.
fn new_survey_kept_keys(template: &Value) -> Vec<String> {
    keys_of(array(template, "fields"))
        .filter(|key| key != TEMPLATE_SERVICE_KEY && key != TEMPLATE_COMMENT_KEY)
        .chain(keys_of(array(template, "consents")))
        .collect()
}

/// The fields Field built, looked up by the property each one feeds.
fn built_by_property(built: &BuiltFieldsDto) -> Result<BTreeMap<String, Value>, CourseError> {
    let keys = bound_fields(&built.binding);
    let mut by_property = BTreeMap::new();
    for (property, key) in keys {
        let field = built
            .fields
            .iter()
            .find(|field| field_key(field) == Some(key.as_str()))
            .cloned()
            .ok_or_else(|| {
                CourseError::Provider(format!(
                    "Field built the caddie questions without the `{key}` field its binding names"
                ))
            })?;
        by_property.insert(property, field);
    }
    if !by_property.contains_key("staff") || !by_property.contains_key("score") {
        return Err(CourseError::Provider(
            "Field built the caddie questions without a caddie choice and a rating".into(),
        ));
    }
    Ok(by_property)
}

fn relabel(mut field: Value, label: &str) -> Value {
    if let Some(object) = field.as_object_mut() {
        object.insert("label".into(), Value::from(label));
    }
    field
}

fn with_binding(definition: &mut Map<String, Value>, binding: &Value) {
    let mut bindings: Vec<Value> = definition
        .get("bindings")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    match bindings.iter().position(is_staff_rating) {
        Some(index) => bindings[index] = binding.clone(),
        None => bindings.push(binding.clone()),
    }
    definition.insert("bindings".into(), Value::Array(bindings));
}

/// The template with the caddie questions put in: who walked with you and how
/// they did first, the template's other questions next, the comment last.
fn compose_new_survey(template: &Value, built: &BuiltFieldsDto) -> Result<Value, CourseError> {
    let mut by_property = built_by_property(built)?;
    let mut definition = template.as_object().cloned().unwrap_or_else(Map::new);
    let staff = by_property.remove("staff").expect("checked above");
    let score = by_property.remove("score").expect("checked above");
    let mut fields = vec![relabel(staff, STAFF_LABEL), relabel(score, SCORE_LABEL)];
    fields.extend(
        array(template, "fields")
            .iter()
            .filter(|field| {
                !matches!(
                    field_key(field),
                    Some(TEMPLATE_SERVICE_KEY | TEMPLATE_COMMENT_KEY)
                )
            })
            .cloned(),
    );
    fields.extend(by_property.into_values());
    definition.insert("title".into(), Value::from(CADDIE_SURVEY_NAME));
    definition.insert("fields".into(), Value::Array(fields));
    // Steps name every field; ours are new, so a stepped template would fail
    // validation. The survey is short enough for one page.
    definition.remove("steps");
    with_binding(&mut definition, &built.binding);
    Ok(Value::Object(definition))
}

/// What to ask Field for when rebuilding: the properties the survey binds
/// today, and the keys of every other question so the new ones do not clash.
struct RefreshPlan {
    properties: Vec<String>,
    other_keys: Vec<String>,
}

impl RefreshPlan {
    fn of(draft: &Value) -> Self {
        let bound = caddie_binding(draft).map(bound_fields).unwrap_or_default();
        let properties = if bound.is_empty() {
            STAFF_RATING_PROPERTIES.map(String::from).to_vec()
        } else {
            STAFF_RATING_PROPERTIES
                .iter()
                .filter(|property| bound.contains_key(**property))
                .map(|property| property.to_string())
                .collect()
        };
        let bound_keys: Vec<&String> = bound.values().collect();
        let other_keys = keys_of(array(draft, "fields"))
            .chain(keys_of(array(draft, "consents")))
            .filter(|key| !bound_keys.contains(&key))
            .collect();
        Self {
            properties,
            other_keys,
        }
    }
}

/// The draft with fresh caddie questions in the places the old ones were.
///
/// Each new field keeps the wording the club gave its predecessor; only what
/// Field derives from the roster — the caddie options — is taken new. Every
/// other question is left exactly as it was.
fn rebind_caddies(draft: &Value, built: &BuiltFieldsDto) -> Result<Value, CourseError> {
    let mut fresh = built_by_property(built)?;
    let old_keys = caddie_binding(draft).map(bound_fields).unwrap_or_default();
    let property_of: BTreeMap<&str, &str> = old_keys
        .iter()
        .map(|(property, key)| (key.as_str(), property.as_str()))
        .collect();
    let mut definition = draft.as_object().cloned().unwrap_or_else(Map::new);
    let mut fields = Vec::new();
    for field in array(draft, "fields") {
        let property = field_key(field).and_then(|key| property_of.get(key));
        match property.and_then(|property| fresh.remove(*property)) {
            Some(mut replacement) => {
                for kept in ["label", "helpText", "placeholder"] {
                    if let (Some(value), Some(object)) =
                        (field.get(kept), replacement.as_object_mut())
                    {
                        object.insert(kept.into(), value.clone());
                    }
                }
                fields.push(replacement);
            }
            None if property.is_some() => {}
            None => fields.push(field.clone()),
        }
    }
    // A bound question the club deleted, or a survey that lost its binding:
    // the caddie questions go first and the comment last, as when made.
    let mut leading = Vec::new();
    for property in ["staff", "score"] {
        if let Some(field) = fresh.remove(property) {
            let label = if property == "staff" {
                STAFF_LABEL
            } else {
                SCORE_LABEL
            };
            leading.push(relabel(field, label));
        }
    }
    leading.extend(fields);
    leading.extend(fresh.into_values());
    definition.insert("fields".into(), Value::Array(leading));
    with_binding(&mut definition, &built.binding);
    Ok(Value::Object(definition))
}

// ─── Wire shapes ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormDetailDto {
    id: String,
    public_id: String,
    status: String,
    #[serde(default)]
    published: Option<Value>,
    #[serde(default)]
    has_unpublished_changes: bool,
    #[serde(default)]
    draft: Value,
    #[serde(default)]
    draft_revision: u32,
    #[serde(default)]
    published_version: Option<PublishedVersionDto>,
}

#[derive(Debug, Deserialize)]
struct PublishedVersionDto {
    #[serde(default)]
    definition: Value,
}

impl FormDetailDto {
    fn into_form(self) -> CaddieSurveyForm {
        let published_caddies = self
            .published_version
            .as_ref()
            .map(|version| published_caddies(&version.definition))
            .unwrap_or_default();
        CaddieSurveyForm {
            published: self.published.as_ref().is_some_and(|p| !p.is_null())
                || self.published_version.is_some(),
            id: self.id,
            public_id: self.public_id,
            status: self.status,
            has_unpublished_changes: self.has_unpublished_changes,
            published_caddies,
        }
    }
}

#[derive(Debug, Deserialize)]
struct ObjectTypesDto {
    #[serde(default)]
    items: Vec<ObjectTypeDto>,
}

#[derive(Debug, Deserialize)]
struct ObjectTypeDto {
    key: String,
    #[serde(default)]
    properties: Vec<PropertyDto>,
}

#[derive(Debug, Deserialize)]
struct PropertyDto {
    key: String,
    #[serde(default)]
    choices: Vec<ChoiceDto>,
}

#[derive(Debug, Deserialize)]
struct ChoiceDto {
    value: String,
    label: String,
}

impl ChoiceDto {
    fn into_choice(self) -> SurveyCaddieChoice {
        SurveyCaddieChoice {
            id: self.value,
            name: self.label,
        }
    }
}

#[derive(Debug, Deserialize)]
struct BuiltFieldsDto {
    #[serde(default)]
    fields: Vec<Value>,
    binding: Value,
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{
        extract::Path,
        http::StatusCode,
        routing::{get, patch, post, put},
        Json, Router,
    };

    use super::*;
    use crate::course::domain::is_forms_not_provided;

    fn test_credentials() -> GatewayCredentials<'static> {
        GatewayCredentials {
            authorization: "Bearer test-token",
            operator_id: "operator-test",
            platform_id: None,
            authorizer: &crate::course::infrastructure::ALLOW_ALL,
            caller_bearer: "Bearer test",
        }
    }

    fn template() -> Value {
        let rating = |key: &str, label: &str| json!({ "key": key, "label": label, "kind": "rating", "role": "custom", "required": true });
        json!({
            "title": "アンケート",
            "fields": [
                rating("facility", "施設の整備状態はいかがでしたか？"),
                rating("service", "スタッフの対応はいかがでしたか？"),
                rating("overall", "全体的な満足度はいかがでしたか？"),
                { "key": "revisit", "label": "また来たいと思いますか？", "kind": "select", "options": [] },
                { "key": "comment", "label": "ご意見", "kind": "textarea" },
            ],
            "consents": [],
            "allowedOrigins": [],
        })
    }

    fn built(caddies: &[(&str, &str)]) -> BuiltFieldsDto {
        let options: Vec<Value> = caddies
            .iter()
            .map(|(id, name)| json!({ "value": id, "label": name }))
            .collect();
        BuiltFieldsDto {
            fields: vec![
                json!({ "key": "staff", "label": "評価するスタッフ", "kind": "select", "required": true, "options": options }),
                json!({ "key": "score", "label": "評価", "kind": "rating", "required": true }),
                json!({ "key": "comment", "label": "コメント", "kind": "textarea" }),
            ],
            binding: json!({
                "objectType": STAFF_RATING,
                "mappings": [
                    { "property": "staff", "source": { "kind": "field", "key": "staff" } },
                    { "property": "score", "source": { "kind": "field", "key": "score" } },
                    { "property": "comment", "source": { "kind": "field", "key": "comment" } },
                ],
            }),
        }
    }

    fn keys(definition: &Value) -> Vec<String> {
        keys_of(array(definition, "fields")).collect()
    }

    #[test]
    fn a_new_survey_asks_about_the_caddie_first_and_keeps_one_comment() {
        assert_eq!(
            new_survey_kept_keys(&template()),
            vec!["facility", "overall", "revisit"]
        );
        let definition =
            compose_new_survey(&template(), &built(&[("cp_1", "佐藤")])).expect("compose");
        assert_eq!(
            keys(&definition),
            vec!["staff", "score", "facility", "overall", "revisit", "comment"]
        );
        assert_eq!(definition["title"], CADDIE_SURVEY_NAME);
        assert_eq!(definition["fields"][1]["label"], SCORE_LABEL);
        assert_eq!(definition["fields"][5]["label"], "コメント");
        assert_eq!(definition["bindings"][0]["objectType"], STAFF_RATING);
        assert_eq!(definition["allowedOrigins"], json!([]));
        assert_eq!(
            published_caddies(&definition),
            vec![SurveyCaddieChoice {
                id: "cp_1".into(),
                name: "佐藤".into()
            }]
        );
    }

    #[test]
    fn rebuilding_takes_the_new_caddies_and_keeps_the_clubs_wording_and_order() {
        let mut draft =
            compose_new_survey(&template(), &built(&[("cp_1", "佐藤")])).expect("compose");
        // The club reworded a question and moved the comment up in Field.
        draft["fields"][1]["label"] = json!("担当キャディの接客は？");
        let fields = draft["fields"].as_array_mut().unwrap();
        let comment = fields.pop().unwrap();
        fields.insert(2, comment);

        let plan = RefreshPlan::of(&draft);
        assert_eq!(plan.properties, vec!["staff", "score", "comment"]);
        assert_eq!(plan.other_keys, vec!["facility", "overall", "revisit"]);

        let rebuilt =
            rebind_caddies(&draft, &built(&[("cp_1", "佐藤"), ("cp_2", "鈴木")])).expect("rebind");
        assert_eq!(
            keys(&rebuilt),
            vec!["staff", "score", "comment", "facility", "overall", "revisit"]
        );
        assert_eq!(rebuilt["fields"][1]["label"], "担当キャディの接客は？");
        assert_eq!(published_caddies(&rebuilt).len(), 2);
        assert_eq!(array(&rebuilt, "bindings").len(), 1);
    }

    #[test]
    fn a_comment_the_club_unbound_is_not_asked_for_again() {
        let mut draft =
            compose_new_survey(&template(), &built(&[("cp_1", "佐藤")])).expect("compose");
        draft["bindings"][0]["mappings"]
            .as_array_mut()
            .unwrap()
            .pop();
        let plan = RefreshPlan::of(&draft);
        assert_eq!(plan.properties, vec!["staff", "score"]);
        // The comment field is now an ordinary question and its key is taken.
        assert!(plan.other_keys.contains(&"comment".to_string()));
    }

    #[test]
    fn the_form_id_lives_beside_the_other_extension_settings() {
        let config = json!({ "bookingHorizon": { "mode": "days", "days": 90 } });
        assert_eq!(remembered_form_id(&config), None);
        let stored = with_form_id(&config, "form_1");
        assert_eq!(remembered_form_id(&stored).as_deref(), Some("form_1"));
        assert_eq!(stored["bookingHorizon"], config["bookingHorizon"]);
    }

    async fn spawn_field_server(app: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test Field API");
        let addr = listener.local_addr().expect("test Field API address");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve test Field API");
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn a_tenant_without_forms_is_classified_and_a_missing_form_is_none() {
        let app = Router::new()
            .route(
                OBJECT_TYPES,
                get(|| async {
                    (
                        StatusCode::FORBIDDEN,
                        Json(json!({ "code": "FEATURE_NOT_PROVIDED", "message": "no" })),
                    )
                }),
            )
            .route(
                "/v1/erp/field-forms/forms/:id",
                get(|| async { (StatusCode::NOT_FOUND, Json(json!({ "message": "gone" }))) }),
            );
        let base_url = spawn_field_server(app).await;
        let gateway = FieldCaddieSurveyGateway::new(reqwest::Client::new(), Some(&base_url));

        let error = gateway
            .current_caddies(test_credentials())
            .await
            .expect_err("forms are not delivered");
        assert!(is_forms_not_provided(&error), "{error:?}");
        assert_eq!(
            gateway
                .find_form(test_credentials(), "form_1")
                .await
                .expect("a missing form is not an error"),
            None
        );
        assert_eq!(
            gateway.public_url("pub_1"),
            format!("{base_url}/v1/public/forms/pub_1/frame")
        );
    }

    #[tokio::test]
    async fn creating_builds_the_caddie_questions_into_the_template_and_saves_them() {
        let saved = Arc::new(Mutex::new(None::<Value>));
        let built_request = Arc::new(Mutex::new(None::<Value>));
        let detail = |draft: Value, revision: u32| {
            json!({
                "id": "form_1", "publicId": "pub_1", "name": CADDIE_SURVEY_NAME,
                "status": "draft", "published": null, "hasUnpublishedChanges": true,
                "updatedAt": "2026-11-24T00:00:00Z", "draft": draft, "draftRevision": revision,
                "publishedVersion": null, "warnings": [],
            })
        };
        let app = Router::new()
            .route(
                FORMS,
                post(move |Json(body): Json<Value>| async move {
                    assert_eq!(
                        body,
                        json!({ "name": CADDIE_SURVEY_NAME, "template": "survey" })
                    );
                    Json(detail(template(), 1))
                }),
            )
            .route(
                "/v1/erp/field-forms/object-types/field.staff_rating/form-fields",
                post({
                    let built_request = built_request.clone();
                    move |Json(body): Json<Value>| async move {
                        *built_request.lock().unwrap() = Some(body);
                        let built = built(&[("cp_1", "佐藤")]);
                        Json(json!({ "fields": built.fields, "binding": built.binding }))
                    }
                }),
            )
            .route(
                "/v1/erp/field-forms/forms/:id/draft",
                put({
                    let saved = saved.clone();
                    move |Path(id): Path<String>, Json(body): Json<Value>| async move {
                        assert_eq!(id, "form_1");
                        *saved.lock().unwrap() = Some(body);
                        Json(json!({}))
                    }
                }),
            )
            .route(
                "/v1/erp/field-forms/forms/:id",
                get({
                    let saved = saved.clone();
                    move || async move {
                        let draft = saved.lock().unwrap().clone().unwrap()["definition"].clone();
                        Json(detail(draft, 2))
                    }
                }),
            )
            // Never called: creating does not touch the extension config.
            .route(
                "/v1/erp/extensions/golf_course/config",
                patch(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
            );
        let base_url = spawn_field_server(app).await;
        let gateway = FieldCaddieSurveyGateway::new(reqwest::Client::new(), Some(&base_url));

        let form = gateway
            .create_survey_draft(test_credentials())
            .await
            .expect("create");
        assert_eq!(form.id, "form_1");
        assert_eq!(form.status, "draft");
        assert_eq!(
            built_request.lock().unwrap().clone().unwrap(),
            json!({
                "properties": ["staff", "score", "comment"],
                "existingKeys": ["facility", "overall", "revisit"],
            })
        );
        let saved = saved.lock().unwrap().clone().unwrap();
        assert_eq!(saved["expectedRevision"], 1);
        assert_eq!(
            keys(&saved["definition"]),
            vec!["staff", "score", "facility", "overall", "revisit", "comment"]
        );
    }
}
