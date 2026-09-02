use axum::{
    extract::{Path, State},
    http::{
        header::{AUTHORIZATION, CONTENT_TYPE},
        HeaderMap,
    },
    Json,
};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, MySqlPool};

use crate::{
    config::SettlementSource,
    course::infrastructure::{DEFAULT_FIELD_GENERIC_PATHS, DEFAULT_MULTI_COURSE_PRODUCT_WRITES},
    field_api::DEFAULT_FIELD_API_URL,
    AppError,
};

// Stage 1 of PLT-4119: the operator UI now creates Field invoices directly.
// Keep the handler and public token routes in place for old links, but make it
// impossible for this legacy producer to create any new local/Field pair.
const LEGACY_COLLECTION_CREATION_ENABLED: bool = false;
const LEGACY_COLLECTION_CREATION_DISABLED_MESSAGE: &str =
    "legacy cancellation fee collection creation is disabled; use Field invoice API";

fn legacy_collection_creation_gate() -> Result<(), AppError> {
    if !LEGACY_COLLECTION_CREATION_ENABLED {
        return Err(AppError::Gone(LEGACY_COLLECTION_CREATION_DISABLED_MESSAGE));
    }
    Ok(())
}

#[derive(Clone)]
pub struct CancellationFeeConfig {
    pub public_ui_base_url: String,
    pub sms_sender_name: String,
    pub field_api_url: Option<String>,
    /// Optional outbound Authorization override for `/v1/course/*` and
    /// `/field-api/*`. When unset (normal browser-pkce), the inbound login
    /// bearer is forwarded. Keep only for admin/service-account callers.
    pub field_upstream_authorization: Option<String>,
    pub twilio_account_sid: Option<String>,
    pub twilio_auth_token: Option<String>,
    pub twilio_messaging_service_sid: Option<String>,
    pub twilio_from_number: Option<String>,
    /// Whether a plan may be sold on more than one course (SCC-3).
    ///
    /// The paired `golfCourseIds` / `eligibleResourceIds` write only makes
    /// sense against a Field that reads the second array (PLT-3353). Turning
    /// this off stops the writer without a code revert, which is the order the
    /// rollback has to happen in: CourseBoard stops writing before Field goes
    /// back to a version that would ignore the eligibility.
    pub multi_course_product_writes: bool,
    /// Who adds up the monthly close (ADR-0005 Phase 1).
    ///
    /// The close reaches accounting, so it moves behind a switch rather than
    /// all at once: `compare` serves Field's answer and logs where the local
    /// one differs, and only a whole close shown to agree justifies
    /// `courseboard`.
    pub settlement_source: SettlementSource,
    /// Whether confirmed shifts are mirrored into Field's HRM (ADR-0013).
    /// Off unless the environment sets it; see `config.rs` for why.
    pub field_shift_writeback: bool,
    /// Whether Field's generic paths replace the golf extension aliases
    /// (ADR-0010). Off unless the environment sets it; see `config.rs` for why.
    pub field_generic_paths: bool,
}

impl CancellationFeeConfig {
    /// Where the payer opens the collection.
    ///
    /// A plain path: the UI routes on the URL itself. A base pointing at a file
    /// (`…/index.html`, a Tauri or `file://` build) has no server to hand that
    /// path to, so those keep the hash form the UI still reads.
    fn payment_url(&self, token: &str) -> String {
        let base_url = self.public_ui_base_url.trim_end_matches('/');
        if base_url.ends_with(".html") {
            format!("{base_url}#/pay/{token}")
        } else {
            format!("{base_url}/pay/{token}")
        }
    }

    fn twilio_enabled(&self) -> bool {
        self.twilio_account_sid.is_some()
            && self.twilio_auth_token.is_some()
            && (self.twilio_messaging_service_sid.is_some() || self.twilio_from_number.is_some())
    }
}

impl Default for CancellationFeeConfig {
    fn default() -> Self {
        Self {
            public_ui_base_url: "http://localhost:5173".to_string(),
            sms_sender_name: "Course Board".to_string(),
            field_api_url: Some(DEFAULT_FIELD_API_URL.to_string()),
            field_upstream_authorization: None,
            twilio_account_sid: None,
            twilio_auth_token: None,
            twilio_messaging_service_sid: None,
            twilio_from_number: None,
            multi_course_product_writes: DEFAULT_MULTI_COURSE_PRODUCT_WRITES,
            settlement_source: SettlementSource::Field,
            field_shift_writeback: false,
            field_generic_paths: DEFAULT_FIELD_GENERIC_PATHS,
        }
    }
}

#[derive(Clone)]
pub struct MySqlCancellationFeeRepository {
    pool: MySqlPool,
}

impl MySqlCancellationFeeRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    async fn insert(&self, input: NewCancellationFeeCollection<'_>) -> Result<(), AppError> {
        sqlx::query(
            r#"
            INSERT INTO cancellation_fee_collections (
                id,
                tenant_id,
                reference,
                customer_name,
                customer_phone,
                amount,
                currency,
                due_date,
                reason,
                notes,
                public_token,
                payment_url,
                field_invoice_id,
                field_invoice_payment_url,
                sms_message
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(input.id)
        .bind(input.tenant_id)
        .bind(input.reference)
        .bind(input.customer_name)
        .bind(input.customer_phone)
        .bind(input.amount)
        .bind(input.currency)
        .bind(input.due_date)
        .bind(input.reason)
        .bind(input.notes)
        .bind(input.public_token)
        .bind(input.payment_url)
        .bind(input.field_invoice_id)
        .bind(input.field_invoice_payment_url)
        .bind(input.sms_message)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn find_by_token(
        &self,
        token: &str,
    ) -> Result<Option<CancellationFeeCollection>, AppError> {
        let collection = sqlx::query_as::<_, CancellationFeeCollection>(
            r#"
            SELECT
                id,
                tenant_id,
                reference,
                customer_name,
                customer_phone,
                amount,
                currency,
                CAST(due_date AS CHAR) AS due_date,
                reason,
                notes,
                public_token,
                payment_url,
                field_invoice_id,
                field_invoice_payment_url,
                status,
                sms_status,
                sms_message,
                sms_provider_message_id,
                sms_error,
                stripe_payment_intent_id,
                stripe_client_secret,
                CAST(paid_at AS CHAR) AS paid_at,
                CAST(created_at AS CHAR) AS created_at,
                CAST(updated_at AS CHAR) AS updated_at
            FROM cancellation_fee_collections
            WHERE public_token = ?
            "#,
        )
        .bind(token)
        .fetch_optional(&self.pool)
        .await?;

        Ok(collection)
    }

    async fn update_sms_status(
        &self,
        id: &str,
        status: &str,
        provider_message_id: Option<&str>,
        error: Option<&str>,
    ) -> Result<(), AppError> {
        sqlx::query(
            r#"
            UPDATE cancellation_fee_collections
            SET sms_status = ?,
                sms_provider_message_id = ?,
                sms_error = ?,
                updated_at = CURRENT_TIMESTAMP(6)
            WHERE id = ?
            "#,
        )
        .bind(status)
        .bind(provider_message_id)
        .bind(error)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn attach_stripe_payment_intent(
        &self,
        id: &str,
        payment_intent_id: &str,
        client_secret: &str,
    ) -> Result<(), AppError> {
        sqlx::query(
            r#"
            UPDATE cancellation_fee_collections
            SET stripe_payment_intent_id = ?,
                stripe_client_secret = ?,
                updated_at = CURRENT_TIMESTAMP(6)
            WHERE id = ?
            "#,
        )
        .bind(payment_intent_id)
        .bind(client_secret)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn mark_paid(&self, id: &str) -> Result<(), AppError> {
        sqlx::query(
            r#"
            UPDATE cancellation_fee_collections
            SET status = 'paid',
                paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP(6)),
                updated_at = CURRENT_TIMESTAMP(6)
            WHERE id = ?
            "#,
        )
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}

struct NewCancellationFeeCollection<'a> {
    id: &'a str,
    tenant_id: &'a str,
    reference: Option<&'a str>,
    customer_name: &'a str,
    customer_phone: &'a str,
    amount: i64,
    currency: &'a str,
    due_date: &'a str,
    reason: Option<&'a str>,
    notes: Option<&'a str>,
    public_token: &'a str,
    payment_url: &'a str,
    field_invoice_id: Option<&'a str>,
    field_invoice_payment_url: Option<&'a str>,
    sms_message: &'a str,
}

#[derive(Debug, Clone, FromRow)]
pub struct CancellationFeeCollection {
    pub id: String,
    pub tenant_id: String,
    pub reference: Option<String>,
    pub customer_name: String,
    pub customer_phone: String,
    pub amount: i64,
    pub currency: String,
    pub due_date: String,
    pub reason: Option<String>,
    pub notes: Option<String>,
    pub public_token: String,
    pub payment_url: String,
    pub field_invoice_id: Option<String>,
    pub field_invoice_payment_url: Option<String>,
    pub status: String,
    pub sms_status: String,
    pub sms_message: Option<String>,
    pub sms_provider_message_id: Option<String>,
    pub sms_error: Option<String>,
    pub stripe_payment_intent_id: Option<String>,
    pub stripe_client_secret: Option<String>,
    pub paid_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum CancellationFeeBillToRequest {
    Customer {
        customer_id: String,
    },
    Client {
        client_id: String,
        affiliation_id: String,
    },
}

#[derive(Debug, Deserialize)]
pub struct CreateCancellationFeeCollectionRequest {
    pub tenant_id: String,
    pub reference: Option<String>,
    pub bill_to: CancellationFeeBillToRequest,
    pub customer_name: String,
    pub customer_phone: String,
    pub amount: i64,
    pub currency: Option<String>,
    pub due_date: String,
    pub reason: Option<String>,
    pub notes: Option<String>,
    pub send_sms: Option<bool>,
    pub sms_message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CancellationFeeCollectionResponse {
    pub id: String,
    pub tenant_id: String,
    pub reference: Option<String>,
    pub customer_name: String,
    pub amount: i64,
    pub currency: String,
    pub due_date: String,
    pub reason: Option<String>,
    pub payment_url: String,
    pub field_invoice_id: Option<String>,
    pub status: String,
    pub sms_status: String,
    pub paid_at: Option<String>,
}

impl From<CancellationFeeCollection> for CancellationFeeCollectionResponse {
    fn from(value: CancellationFeeCollection) -> Self {
        Self {
            id: value.id,
            tenant_id: value.tenant_id,
            reference: value.reference,
            customer_name: value.customer_name,
            amount: value.amount,
            currency: value.currency,
            due_date: value.due_date,
            reason: value.reason,
            payment_url: value.payment_url,
            field_invoice_id: value.field_invoice_id,
            status: value.status,
            sms_status: value.sms_status,
            paid_at: value.paid_at,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateCancellationFeeCollectionResponse {
    pub collection: CancellationFeeCollectionResponse,
    pub sms_message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StripePaymentIntentClientResponse {
    pub publishable_key: String,
    pub client_secret: String,
    pub payment_intent_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ConfirmStripePaymentRequest {
    pub payment_intent_id: String,
}

#[derive(Debug, Serialize)]
pub struct ConfirmStripePaymentResponse {
    pub status: String,
    pub collection: CancellationFeeCollectionResponse,
}

pub async fn create_collection(
    State(state): State<crate::AppState>,
    State(repository): State<std::sync::Arc<MySqlCancellationFeeRepository>>,
    State(config): State<CancellationFeeConfig>,
    State(http_client): State<reqwest::Client>,
    headers: HeaderMap,
    Json(request): Json<CreateCancellationFeeCollectionRequest>,
) -> Result<Json<CreateCancellationFeeCollectionResponse>, AppError> {
    legacy_collection_creation_gate()?;

    let tenant_id = required_text(&request.tenant_id, "tenant_id is required")?;
    // Against the tenant in the body, which is the one the invoice and the
    // local row are written for. Checking the header's tenant instead would
    // let a grant in one tenant open a collection in another.
    crate::authorize_body_tenant(
        &state,
        &headers,
        tenant_id,
        crate::course::domain::actions::MANAGE_CANCELLATION_FEES,
    )
    .await?;
    let customer_name = required_text(&request.customer_name, "customer_name is required")?;
    let customer_phone = required_text(&request.customer_phone, "customer_phone is required")?;
    let due_date = required_text(&request.due_date, "due_date is required")?;
    let bill_to = validated_bill_to(&request.bill_to)?;
    if request.amount <= 0 {
        return Err(AppError::BadRequest("amount must be greater than zero"));
    }
    let currency = request
        .currency
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("JPY")
        .to_uppercase();
    if currency != "JPY" {
        return Err(AppError::BadRequest(
            "only JPY is supported for cancellation fees",
        ));
    }

    let id = format!("cfc_{}", random_token(18));
    let public_token = random_token(32);
    let payment_url = config.payment_url(&public_token);
    let sms_message = render_sms_message(&config, &request, &currency, &payment_url);
    if config.field_api_url.is_none() {
        return Err(AppError::Provider(
            "TACHYON_FIELD_API_URL is required to create cancellation fee payment links"
                .to_string(),
        ));
    }
    let bearer_token = bearer_token_from_headers(&headers)?;
    let field_invoice = create_field_invoice(
        &http_client,
        &config,
        FieldInvoiceCreateInput {
            request: &request,
            collection_id: &id,
            payment_url: &payment_url,
            tenant_id,
            customer_name,
            customer_phone,
            due_date,
            currency: &currency,
            bearer_token: &bearer_token,
            bill_to,
        },
    )
    .await?;

    repository
        .insert(NewCancellationFeeCollection {
            id: &id,
            tenant_id,
            reference: optional_ref(request.reference.as_deref()),
            customer_name,
            customer_phone,
            amount: request.amount,
            currency: &currency,
            due_date,
            reason: optional_ref(request.reason.as_deref()),
            notes: optional_ref(request.notes.as_deref()),
            public_token: &public_token,
            payment_url: &payment_url,
            field_invoice_id: Some(&field_invoice.id),
            field_invoice_payment_url: field_invoice.payment_link_url.as_deref(),
            sms_message: &sms_message,
        })
        .await?;

    let should_send_sms = request.send_sms.unwrap_or(true);
    if should_send_sms {
        match send_sms(&http_client, &config, customer_phone, &sms_message).await {
            Ok(delivery) => {
                repository
                    .update_sms_status(
                        &id,
                        delivery.status,
                        delivery.provider_message_id.as_deref(),
                        None,
                    )
                    .await?;
            }
            Err(error) => {
                let message = error.to_string();
                repository
                    .update_sms_status(&id, "failed", None, Some(&message))
                    .await?;
                return Err(error);
            }
        }
    }

    let collection = repository
        .find_by_token(&public_token)
        .await?
        .ok_or(AppError::NotFound("cancellation fee collection not found"))?;

    Ok(Json(CreateCancellationFeeCollectionResponse {
        collection: collection.into(),
        sms_message,
    }))
}

pub async fn get_public_collection(
    State(repository): State<std::sync::Arc<MySqlCancellationFeeRepository>>,
    State(config): State<CancellationFeeConfig>,
    State(http_client): State<reqwest::Client>,
    Path(token): Path<String>,
) -> Result<Json<CancellationFeeCollectionResponse>, AppError> {
    let collection = repository
        .find_by_token(&token)
        .await?
        .ok_or(AppError::NotFound("cancellation fee collection not found"))?;
    let collection =
        maybe_sync_paid_status_from_field(&repository, &http_client, &config, collection).await?;

    Ok(Json(collection.into()))
}

pub async fn create_stripe_payment_intent(
    State(repository): State<std::sync::Arc<MySqlCancellationFeeRepository>>,
    State(config): State<CancellationFeeConfig>,
    State(http_client): State<reqwest::Client>,
    Path(token): Path<String>,
) -> Result<Json<StripePaymentIntentClientResponse>, AppError> {
    let collection = repository
        .find_by_token(&token)
        .await?
        .ok_or(AppError::NotFound("cancellation fee collection not found"))?;
    if collection.status != "pending" {
        return Err(AppError::BadRequest("collection is not payable"));
    }
    if let (Some(payment_intent_id), Some(client_secret)) = (
        collection.stripe_payment_intent_id.clone(),
        collection.stripe_client_secret.clone(),
    ) {
        let publishable_key =
            field_invoice_stripe_publishable_key(&http_client, &config, &collection).await?;
        return Ok(Json(StripePaymentIntentClientResponse {
            publishable_key,
            client_secret,
            payment_intent_id,
        }));
    }

    let intent =
        create_field_public_invoice_payment_intent(&http_client, &config, &collection).await?;
    repository
        .attach_stripe_payment_intent(
            &collection.id,
            &intent.payment_intent_id,
            &intent.client_secret,
        )
        .await?;

    Ok(Json(StripePaymentIntentClientResponse {
        publishable_key: intent.publishable_key,
        client_secret: intent.client_secret,
        payment_intent_id: intent.payment_intent_id,
    }))
}

pub async fn confirm_stripe_payment(
    State(repository): State<std::sync::Arc<MySqlCancellationFeeRepository>>,
    State(config): State<CancellationFeeConfig>,
    State(http_client): State<reqwest::Client>,
    Path(token): Path<String>,
    Json(request): Json<ConfirmStripePaymentRequest>,
) -> Result<Json<ConfirmStripePaymentResponse>, AppError> {
    let collection = repository
        .find_by_token(&token)
        .await?
        .ok_or(AppError::NotFound("cancellation fee collection not found"))?;
    let Some(expected_intent_id) = collection.stripe_payment_intent_id.as_deref() else {
        return Err(AppError::BadRequest(
            "collection has no Stripe PaymentIntent",
        ));
    };
    if request.payment_intent_id != expected_intent_id {
        return Err(AppError::BadRequest(
            "Stripe PaymentIntent does not match collection",
        ));
    }
    let updated =
        maybe_sync_paid_status_from_field(&repository, &http_client, &config, collection).await?;

    Ok(Json(ConfirmStripePaymentResponse {
        status: updated.status.clone(),
        collection: updated.into(),
    }))
}

fn required_text<'a>(value: &'a str, message: &'static str) -> Result<&'a str, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(AppError::BadRequest(message))
    } else {
        Ok(trimmed)
    }
}

fn optional_ref(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn random_token(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

fn render_sms_message(
    config: &CancellationFeeConfig,
    request: &CreateCancellationFeeCollectionRequest,
    currency: &str,
    payment_url: &str,
) -> String {
    let currency_label = if currency == "JPY" { "円" } else { currency };
    let default_template = "{company}より、キャンセル料{amount}{currency}のお支払いをお願いします。お支払い期限: {dueDate}。お支払いURL: {url} 停止はSTOPと返信してください。";
    let template = request
        .sms_message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_template);

    template
        .replace("{company}", &config.sms_sender_name)
        .replace("{amount}", &request.amount.to_string())
        .replace("{currency}", currency_label)
        .replace("{dueDate}", request.due_date.trim())
        .replace("{url}", payment_url)
        .replace(
            "{reference}",
            request.reference.as_deref().map(str::trim).unwrap_or(""),
        )
}

struct SmsDelivery {
    status: &'static str,
    provider_message_id: Option<String>,
}

async fn send_sms(
    http_client: &reqwest::Client,
    config: &CancellationFeeConfig,
    to: &str,
    body: &str,
) -> Result<SmsDelivery, AppError> {
    if !config.twilio_enabled() {
        return Ok(SmsDelivery {
            status: "skipped",
            provider_message_id: None,
        });
    }

    let account_sid = config.twilio_account_sid.as_deref().unwrap();
    let auth_token = config.twilio_auth_token.as_deref().unwrap();
    let url = format!("https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json");
    let mut params = vec![
        ("To".to_string(), to.to_string()),
        ("Body".to_string(), body.to_string()),
    ];
    if let Some(value) = config.twilio_messaging_service_sid.as_deref() {
        params.push(("MessagingServiceSid".to_string(), value.to_string()));
    } else if let Some(value) = config.twilio_from_number.as_deref() {
        params.push(("From".to_string(), value.to_string()));
    }
    let encoded = serde_urlencoded::to_string(params)
        .map_err(|error| AppError::Provider(format!("failed to encode Twilio request: {error}")))?;
    let response = http_client
        .post(url)
        .basic_auth(account_sid, Some(auth_token))
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(encoded)
        .send()
        .await
        .map_err(|error| AppError::Provider(format!("Twilio SMS request failed: {error}")))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| String::from("<unreadable Twilio response>"));
    if !status.is_success() {
        return Err(AppError::Provider(format!(
            "Twilio SMS send failed with status {status}"
        )));
    }

    let parsed: TwilioMessageResponse = serde_json::from_str(&body).map_err(|error| {
        AppError::Provider(format!("failed to parse Twilio SMS response: {error}"))
    })?;
    Ok(SmsDelivery {
        status: "sent",
        provider_message_id: parsed.sid,
    })
}

#[derive(Debug, Deserialize)]
struct TwilioMessageResponse {
    sid: Option<String>,
}

struct FieldInvoiceCreateInput<'a> {
    request: &'a CreateCancellationFeeCollectionRequest,
    collection_id: &'a str,
    payment_url: &'a str,
    tenant_id: &'a str,
    customer_name: &'a str,
    customer_phone: &'a str,
    due_date: &'a str,
    currency: &'a str,
    bearer_token: &'a str,
    bill_to: CancellationFeeBillToRequest,
}

async fn create_field_invoice(
    http_client: &reqwest::Client,
    config: &CancellationFeeConfig,
    input: FieldInvoiceCreateInput<'_>,
) -> Result<FieldInvoiceResponse, AppError> {
    let description = input
        .request
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("キャンセル料")
        .to_string();
    let body = FieldCreateInvoiceRequest {
        invoice_number: Some(format!("CB-{}", input.collection_id)),
        bill_to: input.bill_to,
        client_name: Some(input.customer_name.to_string()),
        client_email: None,
        client_phone: Some(input.customer_phone.to_string()),
        line_items: vec![FieldCreateInvoiceLineItemRequest {
            description,
            quantity: 1,
            unit_price: input.request.amount,
            tax_category: Some("out_of_scope".to_string()),
        }],
        due_date: input.due_date.to_string(),
        status: Some("Sent".to_string()),
        currency: Some(input.currency.to_string()),
        tax_category: Some("out_of_scope".to_string()),
        tax_amount: Some(0),
        notes: Some(field_invoice_notes(
            input.request,
            input.collection_id,
            input.payment_url,
        )),
        create_payment_link: Some(true),
        payment_link_provider: Some("stripe".to_string()),
        send_email: Some(false),
        send_sms: Some(false),
        sms_message: None,
    };
    let url = field_api_url(config, "/v1/invoices")?;
    let response = http_client
        .post(url)
        .bearer_auth(input.bearer_token)
        .header("x-operator-id", input.tenant_id)
        .json(&body)
        .send()
        .await
        .map_err(|error| AppError::Provider(format!("Field invoice request failed: {error}")))?;

    parse_field_response(response, "create invoice").await
}

async fn create_field_public_invoice_payment_intent(
    http_client: &reqwest::Client,
    config: &CancellationFeeConfig,
    collection: &CancellationFeeCollection,
) -> Result<FieldPublicInvoicePaymentIntentResponse, AppError> {
    let path = field_public_invoice_path(collection, "payment-intent")?;
    let url = field_api_url(config, &path)?;
    let response = http_client.post(url).send().await.map_err(|error| {
        AppError::Provider(format!(
            "Field invoice payment intent request failed: {error}"
        ))
    })?;

    parse_field_response(response, "create public invoice payment intent").await
}

async fn field_invoice_stripe_publishable_key(
    http_client: &reqwest::Client,
    config: &CancellationFeeConfig,
    collection: &CancellationFeeCollection,
) -> Result<String, AppError> {
    let path = field_public_invoice_path(collection, "stripe-publishable-key")?;
    let url = field_api_url(config, &path)?;
    let response = http_client.get(url).send().await.map_err(|error| {
        AppError::Provider(format!(
            "Field Stripe publishable key request failed: {error}"
        ))
    })?;
    let config: FieldInvoiceStripePublishableKeyResponse =
        parse_field_response(response, "get public invoice Stripe publishable key").await?;
    Ok(config.publishable_key)
}

async fn maybe_sync_paid_status_from_field(
    repository: &MySqlCancellationFeeRepository,
    http_client: &reqwest::Client,
    config: &CancellationFeeConfig,
    collection: CancellationFeeCollection,
) -> Result<CancellationFeeCollection, AppError> {
    if collection.status == "paid"
        || config.field_api_url.is_none()
        || collection.field_invoice_id.is_none()
    {
        return Ok(collection);
    }
    let invoice = match fetch_field_public_invoice(http_client, config, &collection).await {
        Ok(invoice) => invoice,
        Err(error) => {
            tracing::warn!(
                collection_id = %collection.id,
                field_invoice_id = ?collection.field_invoice_id,
                %error,
                "failed to sync Field invoice payment status"
            );
            return Ok(collection);
        }
    };
    if !invoice.status.eq_ignore_ascii_case("paid") {
        return Ok(collection);
    }

    repository.mark_paid(&collection.id).await?;
    repository
        .find_by_token(&collection.public_token)
        .await?
        .ok_or(AppError::NotFound("cancellation fee collection not found"))
}

async fn fetch_field_public_invoice(
    http_client: &reqwest::Client,
    config: &CancellationFeeConfig,
    collection: &CancellationFeeCollection,
) -> Result<FieldPublicInvoiceResponse, AppError> {
    let path = field_public_invoice_path(collection, "")?;
    let url = field_api_url(config, &path)?;
    let response = http_client.get(url).send().await.map_err(|error| {
        AppError::Provider(format!("Field public invoice request failed: {error}"))
    })?;
    parse_field_response(response, "get public invoice").await
}

async fn parse_field_response<T: for<'de> Deserialize<'de>>(
    response: reqwest::Response,
    operation: &str,
) -> Result<T, AppError> {
    let status = response.status();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| String::from("<unreadable Field API response>"));
    if !status.is_success() {
        return Err(AppError::Provider(format!(
            "Field API {operation} failed with status {status}: {body}"
        )));
    }
    serde_json::from_str(&body)
        .map_err(|error| AppError::Provider(format!("failed to parse Field API response: {error}")))
}

fn bearer_token_from_headers(headers: &HeaderMap) -> Result<String, AppError> {
    let value = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    value
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or(AppError::Unauthorized)
}

fn field_api_url(config: &CancellationFeeConfig, path: &str) -> Result<String, AppError> {
    let base_url = config.field_api_url.as_deref().ok_or_else(|| {
        AppError::Provider("TACHYON_FIELD_API_URL is required for Field invoice API".to_string())
    })?;
    Ok(format!("{}{}", base_url.trim_end_matches('/'), path))
}

fn field_public_invoice_path(
    collection: &CancellationFeeCollection,
    suffix: &str,
) -> Result<String, AppError> {
    let field_invoice_id = collection.field_invoice_id.as_deref().ok_or_else(|| {
        AppError::Provider("Field invoice is not attached to this collection".to_string())
    })?;
    let mut path = format!(
        "/v1/public/invoices/{}/{}",
        encode_path_segment(&collection.tenant_id),
        encode_path_segment(field_invoice_id)
    );
    if !suffix.is_empty() {
        path.push('/');
        path.push_str(suffix);
    }
    Ok(path)
}

fn encode_path_segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn field_invoice_notes(
    request: &CreateCancellationFeeCollectionRequest,
    collection_id: &str,
    payment_url: &str,
) -> String {
    let mut parts = vec![
        format!("Course Board collection ID: {collection_id}"),
        format!("Course Board payment URL: {payment_url}"),
    ];
    if let Some(reference) = optional_ref(request.reference.as_deref()) {
        parts.push(format!("Reference: {reference}"));
    }
    if let Some(notes) = optional_ref(request.notes.as_deref()) {
        parts.push(notes.to_string());
    }
    parts.join("\n")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FieldCreateInvoiceRequest {
    invoice_number: Option<String>,
    bill_to: CancellationFeeBillToRequest,
    client_name: Option<String>,
    client_email: Option<String>,
    client_phone: Option<String>,
    line_items: Vec<FieldCreateInvoiceLineItemRequest>,
    due_date: String,
    status: Option<String>,
    currency: Option<String>,
    tax_category: Option<String>,
    tax_amount: Option<i64>,
    notes: Option<String>,
    create_payment_link: Option<bool>,
    payment_link_provider: Option<String>,
    send_email: Option<bool>,
    send_sms: Option<bool>,
    sms_message: Option<String>,
}

fn validated_bill_to(
    bill_to: &CancellationFeeBillToRequest,
) -> Result<CancellationFeeBillToRequest, AppError> {
    match bill_to {
        CancellationFeeBillToRequest::Customer { customer_id } => {
            Ok(CancellationFeeBillToRequest::Customer {
                customer_id: required_text(customer_id, "bill_to.customerId is required")?
                    .to_string(),
            })
        }
        CancellationFeeBillToRequest::Client {
            client_id,
            affiliation_id,
        } => Ok(CancellationFeeBillToRequest::Client {
            client_id: required_text(client_id, "bill_to.clientId is required")?.to_string(),
            affiliation_id: required_text(affiliation_id, "bill_to.affiliationId is required")?
                .to_string(),
        }),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FieldCreateInvoiceLineItemRequest {
    description: String,
    quantity: i64,
    unit_price: i64,
    tax_category: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldInvoiceResponse {
    id: String,
    payment_link_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldPublicInvoiceResponse {
    status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldPublicInvoicePaymentIntentResponse {
    client_secret: String,
    publishable_key: String,
    payment_intent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldInvoiceStripePublishableKeyResponse {
    publishable_key: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_invoice_body_serializes_typed_bill_to_without_legacy_client_id() {
        let body = FieldCreateInvoiceRequest {
            invoice_number: Some("CB-cfc_test".to_string()),
            bill_to: CancellationFeeBillToRequest::Client {
                client_id: "cl_company_x".to_string(),
                affiliation_id: "ccaf_person_a_company_x".to_string(),
            },
            client_name: Some("Company X".to_string()),
            client_email: None,
            client_phone: Some("+819012345678".to_string()),
            line_items: vec![FieldCreateInvoiceLineItemRequest {
                description: "キャンセル料".to_string(),
                quantity: 1,
                unit_price: 5_000,
                tax_category: Some("out_of_scope".to_string()),
            }],
            due_date: "2026-08-31".to_string(),
            status: Some("Sent".to_string()),
            currency: Some("JPY".to_string()),
            tax_category: Some("out_of_scope".to_string()),
            tax_amount: Some(0),
            notes: None,
            create_payment_link: Some(true),
            payment_link_provider: Some("stripe".to_string()),
            send_email: Some(false),
            send_sms: Some(false),
            sms_message: None,
        };

        let body = serde_json::to_value(body).expect("serialize Field invoice request");
        assert_eq!(
            body["billTo"],
            serde_json::json!({
                "kind": "client",
                "clientId": "cl_company_x",
                "affiliationId": "ccaf_person_a_company_x"
            })
        );
        assert!(body.get("clientId").is_none());
        assert!(!body.to_string().contains("courseboard:"));
    }

    #[test]
    fn validates_and_trims_both_typed_bill_to_variants() {
        assert_eq!(
            validated_bill_to(&CancellationFeeBillToRequest::Customer {
                customer_id: " cus_person_a ".to_string(),
            })
            .unwrap(),
            CancellationFeeBillToRequest::Customer {
                customer_id: "cus_person_a".to_string(),
            }
        );
        assert!(validated_bill_to(&CancellationFeeBillToRequest::Client {
            client_id: "cl_company_x".to_string(),
            affiliation_id: " ".to_string(),
        })
        .is_err());
    }

    #[test]
    fn legacy_collection_creation_gate_is_closed() {
        assert!(matches!(
            legacy_collection_creation_gate(),
            Err(AppError::Gone(message))
                if message == LEGACY_COLLECTION_CREATION_DISABLED_MESSAGE
        ));
    }
}
