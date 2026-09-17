//! Reading a paper reception sheet into ledger candidates.
//!
//! The desk still receives groups on paper: a scanned sheet, a photo of the
//! sign-in slip, a fax from the agent. Typing four names off it is the slowest
//! part of a busy morning, and the part that quietly keeps visitors out of the
//! ledger altogether.
//!
//! What Field owns is the generic act of reading a document against a form
//! schema. What CourseBoard owns — and what lives here — is the golf side of
//! that: which columns a golf reception sheet has, what they are called in
//! front of a Japanese desk, and what a read row means once it comes back
//! (ADR-0005). Nothing here is persisted: a draft is a proposal the desk
//! corrects, and the sheet itself is never stored.

use std::collections::BTreeMap;

use chrono::NaiveDate;
use serde::Serialize;
use serde_json::Value;

use super::customer_consent::{
    legacy_reception_consent_definitions, reception_consent, ReceptionConsentAnswer,
    ReceptionConsentDefinition,
};
use super::error::CourseError;
use super::NewCustomer;

/// Field's own ceiling for one document (10 MiB). Rejecting oversized uploads
/// here keeps a scan the desk cannot use from crossing the network twice.
pub const MAX_RECEPTION_SHEET_BYTES: usize = 10 * 1024 * 1024;

/// How many sheets one read may carry. A group that arrives on several
/// sheets — or one sheet photographed front and back — is read in one go
/// rather than one file at a time, and Field reads them as consecutive pages
/// of one document. Eight is Field's own ceiling on pictures per read: past it
/// each page would have to be shrunk below what handwriting survives.
pub const MAX_RECEPTION_SHEETS: usize = 8;

/// What all the sheets of one read may weigh together. Field takes them in
/// one synchronous request whose file budget is 4,000,000 bytes, and a body
/// above that is dropped by the platform before anything can say it was too
/// large — so the check lives here, where it can still be a 400.
pub const MAX_RECEPTION_UPLOAD_BYTES: usize = 4_000_000;

/// The generic entity Field drafts for. A golf visitor is an individual
/// customer in the tenant's ledger — the same record the counter registers by
/// hand — so the reception sheet is read against `consumer`.
pub const RECEPTION_OCR_ENTITY_KEY: &str = "consumer";

/// Every row a sheet may yield, capped at what one screen can be checked
/// against the original. Field's own row cap is higher; the desk's is not.
pub const MAX_RECEPTION_ROWS: usize = 50;

/// The address shape accepted by Field's ERP customer endpoint.
#[derive(Clone, Debug, PartialEq)]
pub struct ReceptionAddress {
    pub postal_code: String,
    pub state: String,
    pub city: String,
    pub address1: String,
    pub address2: Option<String>,
}

/// Customer values submitted from a reception sheet.
///
/// The four legacy ledger values remain in [`NewCustomer`] so manual and
/// booking-ledger creation keep their existing StoreKit contract. These
/// additional values are intentionally scoped to the reception-only Field ERP
/// create capability.
#[derive(Clone, Debug, PartialEq)]
pub struct ReceptionCustomerInput {
    pub customer: NewCustomer,
    pub birth_date: Option<NaiveDate>,
    pub sex: Option<String>,
    pub address: Option<ReceptionAddress>,
    pub custom_fields: BTreeMap<String, Value>,
}

impl ReceptionCustomerInput {
    pub fn new(
        customer: NewCustomer,
        birth_date: Option<NaiveDate>,
        sex: Option<String>,
        address: Option<ReceptionAddress>,
        custom_fields: BTreeMap<String, Value>,
    ) -> Self {
        Self {
            customer,
            birth_date,
            sex,
            address,
            custom_fields,
        }
    }
}

/// A scanned reception sheet on its way upstream, already known to be a format
/// the reader accepts.
pub struct ReceptionSheet {
    bytes: Vec<u8>,
    media_type: ReceptionSheetMediaType,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReceptionSheetMediaType {
    Jpeg,
    Png,
    Pdf,
}

/// A transient proposal returned by the blank-form analyzer.
///
/// The proposal is intentionally separate from the persisted reception-field
/// settings.  It is shown to the desk for review and only reaches the local
/// settings table after the existing PUT endpoint is confirmed.  The image is
/// also transient: it may be displayed beside the proposal, but CourseBoard
/// never stores the uploaded sheet or this preview.
#[derive(Clone, Debug, PartialEq)]
pub struct ReceptionFormProposal {
    pub fields: Vec<super::CustomerReceptionField>,
    pub consent_items: Vec<ProposedConsentItem>,
    pub warnings: Vec<String>,
    pub preview_image: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposedConsentItem {
    pub consent_key: String,
    pub label: String,
    pub body: Option<String>,
    pub required: bool,
}

impl ReceptionSheetMediaType {
    pub fn content_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Pdf => "application/pdf",
        }
    }

    /// Upstream never sees the desk's filename — a scanner names files after
    /// the machine and the minute, and neither is ours to forward.
    pub fn upload_filename(self) -> &'static str {
        match self {
            Self::Jpeg => "document.jpg",
            Self::Png => "document.png",
            Self::Pdf => "document.pdf",
        }
    }
}

/// Never the bytes. A reception sheet is a page of names, addresses and phone
/// numbers; a debug line that carried it would put the whole group into a log
/// nobody meant to fill with personal data.
impl std::fmt::Debug for ReceptionSheet {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ReceptionSheet")
            .field("media_type", &self.media_type)
            .field("bytes", &self.bytes.len())
            .finish()
    }
}

impl ReceptionSheet {
    /// Accepts a sheet only when the bytes agree with the declared type: a
    /// browser will happily label anything `image/jpeg`, and the reader
    /// upstream answers a mismatch with a 400 the desk cannot act on.
    pub fn try_new(bytes: Vec<u8>, content_type: &str) -> Result<Self, CourseError> {
        if bytes.is_empty() {
            return Err(CourseError::BadRequest("reception sheet is empty"));
        }
        if bytes.len() > MAX_RECEPTION_SHEET_BYTES {
            return Err(CourseError::BadRequest(
                "reception sheet is larger than 10MB",
            ));
        }
        let declared = content_type
            .split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        let media_type = match declared.as_str() {
            "image/jpeg" if is_jpeg(&bytes) => ReceptionSheetMediaType::Jpeg,
            "image/png" if is_png(&bytes) => ReceptionSheetMediaType::Png,
            "application/pdf" if is_pdf(&bytes) => ReceptionSheetMediaType::Pdf,
            "image/jpeg" | "image/png" | "application/pdf" => {
                return Err(CourseError::BadRequest(
                    "reception sheet content does not match its file type",
                ))
            }
            _ => {
                return Err(CourseError::BadRequest(
                    "reception sheet must be JPEG, PNG, or PDF",
                ))
            }
        };
        Ok(Self { bytes, media_type })
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }

    pub fn media_type(&self) -> ReceptionSheetMediaType {
        self.media_type
    }
}

/// The sheets of one read, in the order the desk picked them. That order is
/// the page order upstream reads in, and so the order the rows come back in.
#[derive(Debug)]
pub struct ReceptionSheets(Vec<ReceptionSheet>);

impl ReceptionSheets {
    pub fn try_new(sheets: Vec<ReceptionSheet>) -> Result<Self, CourseError> {
        if sheets.is_empty() {
            return Err(CourseError::BadRequest(
                "multipart field 'file' is required",
            ));
        }
        if sheets.len() > MAX_RECEPTION_SHEETS {
            return Err(CourseError::BadRequest(
                "a reception read may contain at most 8 sheets",
            ));
        }
        let total: usize = sheets.iter().map(|sheet| sheet.bytes.len()).sum();
        if total > MAX_RECEPTION_UPLOAD_BYTES {
            return Err(CourseError::BadRequest(
                "reception sheets are larger than 4MB in total",
            ));
        }
        Ok(Self(sheets))
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &ReceptionSheet> {
        self.0.iter()
    }

    pub fn into_inner(self) -> Vec<ReceptionSheet> {
        self.0
    }
}

impl From<ReceptionSheet> for ReceptionSheets {
    fn from(sheet: ReceptionSheet) -> Self {
        Self(vec![sheet])
    }
}

fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xff, 0xd8, 0xff])
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a])
}

fn is_pdf(bytes: &[u8]) -> bool {
    bytes.starts_with(b"%PDF-")
}

/// The column key of a read row. The strings are the contract with the reader
/// upstream, so they live beside the labels rather than in the gateway.
pub const RECEPTION_ROW_NAME: &str = "name";
pub const RECEPTION_ROW_NAME_KANA: &str = "name_kana";
pub const RECEPTION_ROW_PHONE: &str = "phone";
pub const RECEPTION_ROW_EMAIL: &str = "email";
/// The rows field itself, which is what the reader returns them under.
pub const RECEPTION_ROWS_KEY: &str = "visitors";
const RECEPTION_ADDRESS_POSTAL_CODE: &str = "address_postal_code";
const RECEPTION_ADDRESS_STATE: &str = "address_state";
const RECEPTION_ADDRESS_CITY: &str = "address_city";
const RECEPTION_ADDRESS_1: &str = "address1";
const RECEPTION_ADDRESS_2: &str = "address2";

/// One column of the reception sheet as the reader is asked to see it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceptionOcrColumn {
    pub key: String,
    pub label: String,
    pub field_type: String,
    pub options: Vec<String>,
}

/// The reception sheet as a form schema the generic reader can work against.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceptionOcrField {
    pub key: String,
    pub label: String,
    pub field_type: String,
    pub options: Vec<String>,
    pub item_fields: Vec<ReceptionOcrColumn>,
}

/// Field's `items` reader rejects an item schema wider than twenty columns.
/// Three fixed consent boxes leave room for seventeen tenant reception fields.
pub const MAX_RECEPTION_OCR_COLUMNS: usize = 20;
pub const MAX_RECEPTION_OCR_SCHEMA_BYTES: usize = 64 * 1024;

/// The field type the generic reader uses for a tick box. Anything it cannot
/// resolve to `true` or `false` comes back dropped with a warning rather than
/// guessed, which is what a half-inked box on a carbon copy should do.
pub const RECEPTION_BOOLEAN_FIELD_TYPE: &str = "boolean";

/// What a golf reception sheet is asked for.
///
/// Labels are Japanese on purpose: they are the prompt the reader sees, and a
/// sheet written for a Japanese course reads as 「氏名」, not "name". Only the
/// things the ledger holds are asked for — a sheet also carries the tee time
/// and the plan, but a booking made off an unchecked read is a booking nobody
/// can defend, so this screen stops at the people and what they agreed to.
///
/// The consent boxes are asked for exactly as the paper prints them, opt-out
/// wording included. The desk checks the read against the original, so a
/// question phrased the other way round would not match the page; the flip
/// into Field's direction happens later, in [`super::customer_consent`].
pub fn reception_sheet_schema() -> Vec<ReceptionOcrField> {
    let fields = super::CustomerReceptionField::merge_with_defaults("default", Vec::new());
    reception_sheet_schema_for_fields(&fields)
        .expect("the built-in reception schema fits Field's item column limit")
}

/// Builds the Field OCR schema from the current tenant configuration.
///
/// The outer `visitors` `items` field and the fixed consent columns remain the
/// same contract as the original reader. Only the enabled configured fields
/// between them vary, so the response still maps by `fields.visitors` and row
/// keys rather than by a positional convention.
pub fn reception_sheet_schema_for_fields(
    fields: &[super::CustomerReceptionField],
) -> Result<Vec<ReceptionOcrField>, CourseError> {
    let consents = legacy_reception_consent_definitions();
    reception_sheet_schema_for_fields_and_consents(fields, &consents)
}

/// Builds a reception OCR schema with the active Field consent catalog.
///
/// The catalog is intentionally passed as an argument rather than read from a
/// CourseBoard repository: Field is the source of truth and callers must fetch
/// it for the current tenant immediately before this function is used.
pub fn reception_sheet_schema_for_fields_and_consents(
    fields: &[super::CustomerReceptionField],
    consents: &[ReceptionConsentDefinition],
) -> Result<Vec<ReceptionOcrField>, CourseError> {
    let mut item_fields = Vec::new();
    for field in fields.iter().filter(|field| field.enabled) {
        if field.kind == super::ReceptionFieldKind::Standard && field.field_key == "address" {
            // Field's generic OCR schema has no compound `address` type. Keep
            // address as one setting/UI value, but read its searchable ERP
            // parts as ordinary text columns, as tachyonfield #1255 does.
            let label = field.effective_label();
            item_fields.extend([
                address_column(RECEPTION_ADDRESS_POSTAL_CODE, label, "郵便番号"),
                address_column(RECEPTION_ADDRESS_STATE, label, "都道府県"),
                address_column(RECEPTION_ADDRESS_CITY, label, "市区町村"),
                address_column(RECEPTION_ADDRESS_1, label, "番地"),
                address_column(RECEPTION_ADDRESS_2, label, "建物名・部屋番号"),
            ]);
        } else {
            item_fields.push(ReceptionOcrColumn {
                key: field.field_key.clone(),
                label: field.effective_label().to_string(),
                field_type: field.field_type.as_str().to_string(),
                options: field.options.clone(),
            });
        }
    }
    let mut consent_refs = consents.iter().collect::<Vec<_>>();
    consent_refs.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then_with(|| left.key.cmp(&right.key))
    });
    item_fields.extend(consent_refs.iter().map(|consent| ReceptionOcrColumn {
        key: consent.key.clone(),
        label: consent.prompt().to_string(),
        field_type: RECEPTION_BOOLEAN_FIELD_TYPE.to_string(),
        options: Vec::new(),
    }));
    if item_fields
        .iter()
        .any(|column| column.label.chars().count() > 120)
    {
        return Err(CourseError::BadRequest(
            "reception OCR field label is too long",
        ));
    }
    let unique_keys = item_fields
        .iter()
        .map(|column| column.key.as_str())
        .collect::<std::collections::HashSet<_>>();
    if unique_keys.len() != item_fields.len() {
        return Err(CourseError::BadRequest(
            "reception OCR field keys must be unique",
        ));
    }
    if item_fields.len() > MAX_RECEPTION_OCR_COLUMNS {
        return Err(CourseError::BadRequest(
            "reception sheet has too many OCR fields",
        ));
    }
    let schema = vec![ReceptionOcrField {
        key: RECEPTION_ROWS_KEY.to_string(),
        label: "来場者（受付用紙に書かれている全員）".to_string(),
        field_type: "items".to_string(),
        options: Vec::new(),
        item_fields,
    }];
    let encoded = serde_json::to_vec(&schema).map_err(|error| {
        CourseError::Provider(format!("failed to encode reception OCR schema: {error}"))
    })?;
    if encoded.len() > MAX_RECEPTION_OCR_SCHEMA_BYTES {
        return Err(CourseError::BadRequest("reception OCR schema is too large"));
    }
    Ok(schema)
}

fn address_column(key: &str, label: &str, part: &str) -> ReceptionOcrColumn {
    ReceptionOcrColumn {
        key: key.to_string(),
        label: format!("{label}（{part}）"),
        field_type: "text".to_string(),
        options: Vec::new(),
    }
}

fn sorted_consent_definitions(
    consents: &[ReceptionConsentDefinition],
) -> Vec<ReceptionConsentDefinition> {
    let mut sorted = consents.to_vec();
    sorted.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then_with(|| left.key.cmp(&right.key))
    });
    sorted
}

/// One person as the sheet was read, before anybody has looked at it.
///
/// Every field is optional including the name: a row the reader could not make
/// out is still worth showing, because the desk can read it off the original
/// beside it. Dropping it would silently lose a player from the group.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ReceptionDraftRow {
    name: Option<String>,
    name_kana: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    birth_date: Option<String>,
    sex: Option<String>,
    address: Option<Value>,
    custom_fields: BTreeMap<String, Value>,
    /// One answer per declared consent, in the order they are printed, whether
    /// or not the reader made the box out. The desk needs an unread box to
    /// show up as a question rather than to disappear.
    consents: Vec<ReceptionConsentAnswer>,
}

impl ReceptionDraftRow {
    pub fn new(
        name: Option<String>,
        name_kana: Option<String>,
        phone: Option<String>,
        email: Option<String>,
    ) -> Self {
        let consents = legacy_reception_consent_definitions();
        Self::new_with_consents(name, name_kana, phone, email, &consents)
    }

    /// Creates a row with one unanswered answer for every active Field
    /// catalog item.
    pub fn new_with_consents(
        name: Option<String>,
        name_kana: Option<String>,
        phone: Option<String>,
        email: Option<String>,
        consents: &[ReceptionConsentDefinition],
    ) -> Self {
        Self {
            name: normalize(name),
            name_kana: normalize(name_kana),
            phone: normalize(phone),
            email: normalize(email),
            birth_date: None,
            sex: None,
            address: None,
            custom_fields: BTreeMap::new(),
            consents: sorted_consent_definitions(consents)
                .into_iter()
                .map(|consent| ReceptionConsentAnswer::new(consent.key.clone(), None))
                .collect(),
        }
    }

    /// Adds configured standard/custom values from one Field `items` row.
    ///
    /// The reader answers rows as JSON because a value can be a string,
    /// boolean, object, or null depending on the configured field type. Keep
    /// the typed JSON in custom fields so the confirmation screen can render
    /// booleans and address objects without guessing from strings.
    pub fn with_configured_fields(
        mut self,
        fields: &[super::CustomerReceptionField],
        row: &Value,
    ) -> Self {
        for field in fields.iter().filter(|field| field.enabled) {
            let value = row.get(&field.field_key);
            match (field.kind, field.field_key.as_str()) {
                (super::ReceptionFieldKind::Standard, "name") => {
                    self.name = column(row, RECEPTION_ROW_NAME);
                }
                (super::ReceptionFieldKind::Standard, "name_kana") => {
                    self.name_kana = column(row, RECEPTION_ROW_NAME_KANA);
                }
                (super::ReceptionFieldKind::Standard, "phone") => {
                    self.phone = column(row, RECEPTION_ROW_PHONE);
                }
                (super::ReceptionFieldKind::Standard, "email") => {
                    self.email = column(row, RECEPTION_ROW_EMAIL);
                }
                (super::ReceptionFieldKind::Standard, "birth_date") => {
                    self.birth_date = value.and_then(value_as_string);
                }
                (super::ReceptionFieldKind::Standard, "sex") => {
                    self.sex = value.and_then(value_as_string);
                }
                (super::ReceptionFieldKind::Standard, "address") => {
                    self.address = reception_address(row);
                }
                (super::ReceptionFieldKind::Custom, key) => {
                    self.custom_fields.insert(
                        key.to_string(),
                        normalized_ocr_value(field.field_type, value),
                    );
                }
                _ => {}
            }
        }
        self
    }

    /// Record a box as the reader saw it on the paper. The printed direction
    /// is resolved here so that everything downstream reads `accepted` the way
    /// Field stores it.
    ///
    /// An unknown key is ignored rather than appended: the only source of keys
    /// is the schema this module also builds, and a row carrying a consent the
    /// desk cannot see is worse than one silently dropped.
    pub fn with_consent_tick(self, key: &str, ticked: Option<bool>) -> Self {
        let Some(consent) = reception_consent(key) else {
            return self;
        };
        let definition = ReceptionConsentDefinition {
            key: consent.key.to_string(),
            label: consent.label.to_string(),
            body: Some(consent.prompt.to_string()),
            required: consent.required,
            sort_order: 0,
            polarity: consent.polarity,
        };
        self.with_consent_definition(&definition, ticked)
    }

    /// Records a reader answer using one Field catalog definition.
    pub fn with_consent_definition(
        mut self,
        consent: &ReceptionConsentDefinition,
        ticked: Option<bool>,
    ) -> Self {
        let accepted = consent.accepted_from_tick(ticked);
        if let Some(answer) = self
            .consents
            .iter_mut()
            .find(|answer| answer.key == consent.key)
        {
            answer.accepted = accepted;
        } else {
            self.consents
                .push(ReceptionConsentAnswer::new(consent.key.clone(), accepted));
        }
        self
    }

    /// What the sheet said, already in Field's direction.
    pub fn consents(&self) -> &[ReceptionConsentAnswer] {
        &self.consents
    }

    /// Whether the declaration the sheet requires of everyone came back as a
    /// yes. An unread box is not a yes.
    pub fn has_required_consents(&self) -> bool {
        let definitions = legacy_reception_consent_definitions();
        self.has_required_consents_for(&definitions)
    }

    /// Whether every required active Field consent was explicitly accepted.
    pub fn has_required_consents_for(&self, consents: &[ReceptionConsentDefinition]) -> bool {
        consents
            .iter()
            .filter(|consent| consent.required)
            .all(|required| {
                self.consents
                    .iter()
                    .any(|answer| answer.key == required.key && answer.accepted == Some(true))
            })
    }

    /// Consent ticks alone do not make a person. A row the reader answered
    /// with nothing but boxes has nobody in it, and registering it would put a
    /// nameless record in the ledger.
    pub fn is_empty(&self) -> bool {
        self.name.is_none()
            && self.name_kana.is_none()
            && self.phone.is_none()
            && self.email.is_none()
            && self.birth_date.is_none()
            && self.sex.is_none()
            && self.address.is_none()
            && self
                .custom_fields
                .values()
                .all(|value| value.is_null() || value_is_blank(value))
    }

    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    pub fn name_kana(&self) -> Option<&str> {
        self.name_kana.as_deref()
    }

    pub fn phone(&self) -> Option<&str> {
        self.phone.as_deref()
    }

    pub fn email(&self) -> Option<&str> {
        self.email.as_deref()
    }

    pub fn birth_date(&self) -> Option<&str> {
        self.birth_date.as_deref()
    }

    pub fn sex(&self) -> Option<&str> {
        self.sex.as_deref()
    }

    pub fn address(&self) -> Option<&Value> {
        self.address.as_ref()
    }

    pub fn custom_fields(&self) -> &BTreeMap<String, Value> {
        &self.custom_fields
    }
}

fn normalized_ocr_value(field_type: super::ReceptionFieldType, value: Option<&Value>) -> Value {
    let Some(value) = value else {
        return Value::Null;
    };
    if field_type == super::ReceptionFieldType::Boolean {
        if let Some(boolean) = value.as_bool() {
            return Value::Bool(boolean);
        }
        if let Some(text) = value.as_str() {
            return match text.trim().to_ascii_lowercase().as_str() {
                "true" => Value::Bool(true),
                "false" => Value::Bool(false),
                _ => Value::Null,
            };
        }
        return Value::Null;
    }
    value.clone()
}

fn column(row: &Value, key: &str) -> Option<String> {
    row.get(key).and_then(value_as_string)
}

fn reception_address(row: &Value) -> Option<Value> {
    let postal_code = column(row, RECEPTION_ADDRESS_POSTAL_CODE);
    let state = column(row, RECEPTION_ADDRESS_STATE);
    let city = column(row, RECEPTION_ADDRESS_CITY);
    let address1 = column(row, RECEPTION_ADDRESS_1);
    let address2 = column(row, RECEPTION_ADDRESS_2);
    if [&postal_code, &state, &city, &address1, &address2]
        .iter()
        .all(|part| part.is_none())
    {
        return None;
    }
    Some(serde_json::json!({
        "postalCode": postal_code,
        "state": state,
        "city": city,
        "address1": address1,
        "address2": address2,
    }))
}

fn value_as_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            value
                .as_number()
                .map(ToString::to_string)
                .or_else(|| value.as_bool().map(|value| value.to_string()))
        })
}

fn value_is_blank(value: &Value) -> bool {
    value.as_str().is_some_and(|value| value.trim().is_empty())
        || value
            .as_object()
            .is_some_and(|value| value.values().all(value_is_blank))
}

fn normalize(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

/// Why no read happened at all, when the sheet is not the reason.
///
/// Field used to answer an upstream failure with a 200, an empty draft and the
/// same sentence a blurry photo gets, so a desk whose provider had run out of
/// credit photographed a perfectly good sheet over and over. Field now answers
/// with a status of its own (PLT-4033); this type is what keeps that
/// distinction alive on the way to the screen, because none of these is fixed
/// by pointing the camera again.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ReceptionReaderFailure {
    /// Upstream billing is not satisfied. Deliberately one case rather than
    /// two: the provider answers 402 both for a billing account that was never
    /// linked and for one whose balance has run out, Field copies no provider
    /// body (it can echo the document), so nothing on this side can tell them
    /// apart — and naming only one of the two remedies sends the operator to
    /// the wrong half of the same billing screen.
    #[error("document reading is unavailable until upstream billing is linked and funded")]
    BillingUnsatisfied,
    /// Upstream is rate limiting. The only one of the three that answers to
    /// waiting.
    #[error("document reading is rate limited upstream")]
    RateLimited,
    /// The reader is down, unreachable, or not configured. Field also lands an
    /// upstream 401/403 here rather than forwarding it: the desk's own session
    /// is fine, and forwarding it would sign a working operator out.
    #[error("the document reader is unavailable upstream")]
    Unavailable,
}

impl ReceptionReaderFailure {
    /// Classifies one of Field's OCR failures, or leaves the response alone.
    ///
    /// `None` for every other status on purpose. A 400 is a request this
    /// gateway built wrong and a 401 is the caller's own bearer — neither is
    /// the reader failing, and dressing them up as one would tell the desk to
    /// go and check the billing screen over a bug or an expired session.
    ///
    /// Both the status and Field's `code` are accepted for a case because the
    /// two are written at different layers upstream and only the pair is worth
    /// trusting: the code is what Field's OCR handler decided, the status is
    /// what survives a proxy.
    pub fn classify(status: u16, code: Option<&str>) -> Option<Self> {
        match (status, code) {
            (402, _) | (_, Some("PAYMENT_REQUIRED")) => Some(Self::BillingUnsatisfied),
            (429, _) | (_, Some("TOO_MANY_REQUESTS")) => Some(Self::RateLimited),
            (503, _) | (_, Some("SERVICE_UNAVAILABLE")) => Some(Self::Unavailable),
            _ => None,
        }
    }
}

/// What came back from one sheet: rows to check, and anything the reader could
/// not do.
///
/// The warnings are not decoration. A partial read looks exactly like a
/// complete one on screen, and the only thing that tells the desk to go back to
/// the original is a sentence saying so.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ReceptionDraft {
    rows: Vec<ReceptionDraftRow>,
    warnings: Vec<String>,
}

impl ReceptionDraft {
    pub fn new(rows: Vec<ReceptionDraftRow>, warnings: Vec<String>) -> Self {
        let mut rows: Vec<ReceptionDraftRow> =
            rows.into_iter().filter(|row| !row.is_empty()).collect();
        rows.truncate(MAX_RECEPTION_ROWS);
        Self { rows, warnings }
    }

    pub fn rows(&self) -> &[ReceptionDraftRow] {
        &self.rows
    }

    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }
}

#[cfg(test)]
mod tests {
    use super::super::customer_consent::RECEPTION_CONSENTS;
    use super::*;

    fn jpeg(extra: usize) -> Vec<u8> {
        let mut bytes = vec![0xff, 0xd8, 0xff];
        bytes.extend(std::iter::repeat_n(0u8, extra));
        bytes
    }

    #[test]
    fn a_jpeg_labelled_as_a_jpeg_is_accepted() {
        let sheet = ReceptionSheet::try_new(jpeg(16), "image/jpeg").unwrap();
        assert_eq!(sheet.media_type(), ReceptionSheetMediaType::Jpeg);
        assert_eq!(sheet.media_type().upload_filename(), "document.jpg");
    }

    #[test]
    fn the_browsers_charset_suffix_does_not_hide_the_type() {
        let sheet = ReceptionSheet::try_new(b"%PDF-1.7 body".to_vec(), "APPLICATION/PDF; q=1")
            .expect("pdf with a parameterised content type is still a pdf");
        assert_eq!(sheet.media_type(), ReceptionSheetMediaType::Pdf);
    }

    #[test]
    fn a_png_renamed_to_jpg_is_refused_here_rather_than_upstream() {
        let png = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        let error = ReceptionSheet::try_new(png, "image/jpeg").unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
    }

    #[test]
    fn a_word_document_is_refused() {
        let error =
            ReceptionSheet::try_new(b"PK\x03\x04".to_vec(), "application/msword").unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
    }

    #[test]
    fn a_sheet_over_ten_megabytes_never_leaves_courseboard() {
        let error =
            ReceptionSheet::try_new(jpeg(MAX_RECEPTION_SHEET_BYTES), "image/jpeg").unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
    }

    fn sheet_of(extra: usize) -> ReceptionSheet {
        ReceptionSheet::try_new(jpeg(extra), "image/jpeg").unwrap()
    }

    #[test]
    fn several_sheets_are_one_read_in_the_order_they_were_picked() {
        let sheets = ReceptionSheets::try_new(vec![
            sheet_of(1),
            ReceptionSheet::try_new(b"%PDF-1.7 body".to_vec(), "application/pdf").unwrap(),
        ])
        .unwrap();
        let kinds: Vec<_> = sheets.iter().map(ReceptionSheet::media_type).collect();
        assert_eq!(
            kinds,
            [ReceptionSheetMediaType::Jpeg, ReceptionSheetMediaType::Pdf]
        );
    }

    #[test]
    fn a_read_needs_a_sheet_and_stops_at_what_upstream_reads_at_once() {
        assert!(matches!(
            ReceptionSheets::try_new(Vec::new()).unwrap_err(),
            CourseError::BadRequest(_)
        ));
        let nine = (0..=MAX_RECEPTION_SHEETS).map(|_| sheet_of(1)).collect();
        assert!(matches!(
            ReceptionSheets::try_new(nine).unwrap_err(),
            CourseError::BadRequest(_)
        ));
        let eight = (0..MAX_RECEPTION_SHEETS).map(|_| sheet_of(1)).collect();
        assert_eq!(ReceptionSheets::try_new(eight).unwrap().len(), 8);
    }

    /// Each sheet fits, the request does not: the platform would drop it
    /// before Field could say so, so it is refused here while it can still be
    /// a message.
    #[test]
    fn sheets_that_fit_one_by_one_can_still_be_too_heavy_together() {
        let half = MAX_RECEPTION_UPLOAD_BYTES / 2;
        let error = ReceptionSheets::try_new(vec![sheet_of(half), sheet_of(half)]).unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
    }

    #[test]
    fn rows_the_reader_left_entirely_blank_are_dropped() {
        let draft = ReceptionDraft::new(
            vec![
                ReceptionDraftRow::new(Some("本田 康彦".into()), None, None, None),
                ReceptionDraftRow::new(Some("  ".into()), Some(String::new()), None, None),
            ],
            vec![],
        );
        assert_eq!(draft.rows().len(), 1);
        assert_eq!(draft.rows()[0].name(), Some("本田 康彦"));
    }

    #[test]
    fn a_row_with_only_a_phone_number_is_kept_for_the_desk_to_finish() {
        let draft = ReceptionDraft::new(
            vec![ReceptionDraftRow::new(
                None,
                None,
                Some("090-1234-5678".into()),
                None,
            )],
            vec!["読み取れない項目があります。".into()],
        );
        assert_eq!(draft.rows().len(), 1);
        assert_eq!(draft.rows()[0].name(), None);
        assert_eq!(draft.warnings().len(), 1);
    }

    #[test]
    fn more_rows_than_one_desk_can_check_are_capped() {
        let rows = (0..MAX_RECEPTION_ROWS + 10)
            .map(|index| ReceptionDraftRow::new(Some(format!("来場者{index}")), None, None, None))
            .collect();
        assert_eq!(
            ReceptionDraft::new(rows, vec![]).rows().len(),
            MAX_RECEPTION_ROWS
        );
    }

    #[test]
    fn the_schema_asks_for_what_the_ledger_holds_and_what_was_agreed_to() {
        let schema = reception_sheet_schema();
        assert_eq!(schema.len(), 1);
        assert_eq!(schema[0].key, RECEPTION_ROWS_KEY);
        assert_eq!(schema[0].field_type, "items");
        let keys: Vec<&str> = schema[0]
            .item_fields
            .iter()
            .map(|item| item.key.as_str())
            .collect();
        let mut expected = vec![
            RECEPTION_ROW_NAME,
            RECEPTION_ROW_NAME_KANA,
            RECEPTION_ROW_PHONE,
            RECEPTION_ROW_EMAIL,
        ];
        expected.extend(RECEPTION_CONSENTS.iter().map(|consent| consent.key));
        assert_eq!(keys, expected);
    }

    /// Field caps an `items` field at 20 columns and answers a wider schema
    /// with a 400. Consents are the thing most likely to grow — a course adds
    /// a box, then another — so the ceiling is worth failing against here.
    #[test]
    fn the_row_stays_inside_the_readers_column_ceiling() {
        assert!(reception_sheet_schema()[0].item_fields.len() <= 20);
    }

    /// The reader resolves `boolean` columns to `true` / `false` and drops
    /// anything else with a warning. Sending a tick box as `text` would let a
    /// stray mark through as a consent.
    #[test]
    fn every_consent_column_is_asked_for_as_a_tick_box() {
        let schema = reception_sheet_schema();
        for consent in RECEPTION_CONSENTS.iter() {
            let column = schema[0]
                .item_fields
                .iter()
                .find(|item| item.key == consent.key)
                .unwrap_or_else(|| panic!("{} is missing from the schema", consent.key));
            assert_eq!(column.field_type, RECEPTION_BOOLEAN_FIELD_TYPE);
        }
    }

    #[test]
    fn the_schema_serializes_as_the_reader_expects() {
        let json = serde_json::to_value(reception_sheet_schema()).unwrap();
        let field = &json[0];
        assert_eq!(field["fieldType"], "items");
        assert_eq!(field["options"], serde_json::json!([]));
        assert_eq!(field["itemFields"][2]["fieldType"], "tel");
        assert_eq!(field["itemFields"][2]["key"], RECEPTION_ROW_PHONE);
    }

    #[test]
    fn address_is_split_into_field_supported_text_columns_and_reassembled() {
        let mut fields = crate::course::domain::CustomerReceptionField::merge_with_defaults(
            "tenant-1",
            Vec::new(),
        );
        fields
            .iter_mut()
            .find(|field| field.field_key == "address")
            .unwrap()
            .enabled = true;
        let schema = reception_sheet_schema_for_fields(&fields).unwrap();
        let address_columns = &schema[0].item_fields[4..9];
        assert_eq!(
            address_columns
                .iter()
                .map(|column| column.key.as_str())
                .collect::<Vec<_>>(),
            [
                RECEPTION_ADDRESS_POSTAL_CODE,
                RECEPTION_ADDRESS_STATE,
                RECEPTION_ADDRESS_CITY,
                RECEPTION_ADDRESS_1,
                RECEPTION_ADDRESS_2,
            ]
        );
        assert!(address_columns
            .iter()
            .all(|column| column.field_type == "text"));

        let row = serde_json::json!({
            "name": "本田 康彦",
            "address_postal_code": "100-0001",
            "address_state": "東京都",
            "address_city": "千代田区",
            "address1": "千代田1-1-1",
            "address2": "サンプルビル"
        });
        let draft = ReceptionDraftRow::default().with_configured_fields(&fields, &row);
        assert_eq!(draft.address().unwrap()["postalCode"], "100-0001");
        assert_eq!(draft.address().unwrap()["address1"], "千代田1-1-1");
    }

    #[test]
    fn field_string_boolean_is_normalized_for_the_confirmation_and_create_contract() {
        let custom = crate::course::domain::CustomerReceptionField::try_new(
            "tenant-1",
            crate::course::domain::ReceptionFieldInput {
                field_key: "needs_cart".to_string(),
                kind: crate::course::domain::ReceptionFieldKind::Custom,
                field_type: crate::course::domain::ReceptionFieldType::Boolean,
                enabled: true,
                required: false,
                label: Some("カート希望".to_string()),
                sort_order: 7,
                options: Vec::new(),
            },
        )
        .unwrap();
        let row = ReceptionDraftRow::default()
            .with_configured_fields(&[custom], &serde_json::json!({ "needs_cart": "true" }));
        assert_eq!(row.custom_fields()["needs_cart"], true);
    }

    #[test]
    fn a_schema_over_fields_multipart_limit_is_rejected_when_settings_are_saved() {
        let mut fields = crate::course::domain::CustomerReceptionField::merge_with_defaults(
            "tenant-1",
            Vec::new(),
        );
        for index in 0..13 {
            let options = (0..50)
                .map(|option| format!("{}{option:04}", "あ".repeat(116)))
                .collect();
            fields.push(
                crate::course::domain::CustomerReceptionField::try_new(
                    "tenant-1",
                    crate::course::domain::ReceptionFieldInput {
                        field_key: format!("custom_{index}"),
                        kind: crate::course::domain::ReceptionFieldKind::Custom,
                        field_type: crate::course::domain::ReceptionFieldType::Select,
                        enabled: true,
                        required: false,
                        label: None,
                        sort_order: 7 + index,
                        options,
                    },
                )
                .unwrap(),
            );
        }
        let error = reception_sheet_schema_for_fields(&fields).unwrap_err();
        assert!(matches!(error, CourseError::BadRequest(_)));
    }
}
