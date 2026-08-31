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

use serde::Serialize;

use super::customer_consent::{
    reception_consent, required_reception_consents, ReceptionConsentAnswer, RECEPTION_CONSENTS,
};
use super::error::CourseError;

/// Field's own ceiling for one document (10 MiB). Rejecting oversized uploads
/// here keeps a scan the desk cannot use from crossing the network twice.
pub const MAX_RECEPTION_SHEET_BYTES: usize = 10 * 1024 * 1024;

/// The generic entity Field drafts for. A golf visitor is an individual
/// customer in the tenant's ledger — the same record the counter registers by
/// hand — so the reception sheet is read against `consumer`.
pub const RECEPTION_OCR_ENTITY_KEY: &str = "consumer";

/// Every row a sheet may yield, capped at what one screen can be checked
/// against the original. Field's own row cap is higher; the desk's is not.
pub const MAX_RECEPTION_ROWS: usize = 50;

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

/// One column of the reception sheet as the reader is asked to see it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceptionOcrColumn {
    pub key: &'static str,
    pub label: &'static str,
    pub field_type: &'static str,
    pub options: [&'static str; 0],
}

/// The reception sheet as a form schema the generic reader can work against.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceptionOcrField {
    pub key: &'static str,
    pub label: &'static str,
    pub field_type: &'static str,
    pub options: [&'static str; 0],
    pub item_fields: Vec<ReceptionOcrColumn>,
}

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
    let mut item_fields = vec![
        ReceptionOcrColumn {
            key: RECEPTION_ROW_NAME,
            label: "氏名",
            field_type: "text",
            options: [],
        },
        ReceptionOcrColumn {
            key: RECEPTION_ROW_NAME_KANA,
            label: "氏名のふりがな（カタカナ）",
            field_type: "text",
            options: [],
        },
        ReceptionOcrColumn {
            key: RECEPTION_ROW_PHONE,
            label: "電話番号",
            field_type: "tel",
            options: [],
        },
        ReceptionOcrColumn {
            key: RECEPTION_ROW_EMAIL,
            label: "メールアドレス",
            field_type: "email",
            options: [],
        },
    ];
    item_fields.extend(
        super::customer_consent::RECEPTION_CONSENTS
            .iter()
            .map(|consent| ReceptionOcrColumn {
                key: consent.key,
                label: consent.prompt,
                field_type: RECEPTION_BOOLEAN_FIELD_TYPE,
                options: [],
            }),
    );
    vec![ReceptionOcrField {
        key: RECEPTION_ROWS_KEY,
        label: "来場者（受付用紙に書かれている全員）",
        field_type: "items",
        options: [],
        item_fields,
    }]
}

/// One person as the sheet was read, before anybody has looked at it.
///
/// Every field is optional including the name: a row the reader could not make
/// out is still worth showing, because the desk can read it off the original
/// beside it. Dropping it would silently lose a player from the group.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReceptionDraftRow {
    name: Option<String>,
    name_kana: Option<String>,
    phone: Option<String>,
    email: Option<String>,
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
        Self {
            name: normalize(name),
            name_kana: normalize(name_kana),
            phone: normalize(phone),
            email: normalize(email),
            consents: RECEPTION_CONSENTS
                .iter()
                .map(|consent| ReceptionConsentAnswer {
                    key: consent.key,
                    accepted: None,
                })
                .collect(),
        }
    }

    /// Record a box as the reader saw it on the paper. The printed direction
    /// is resolved here so that everything downstream reads `accepted` the way
    /// Field stores it.
    ///
    /// An unknown key is ignored rather than appended: the only source of keys
    /// is the schema this module also builds, and a row carrying a consent the
    /// desk cannot see is worse than one silently dropped.
    pub fn with_consent_tick(mut self, key: &str, ticked: Option<bool>) -> Self {
        let Some(consent) = reception_consent(key) else {
            return self;
        };
        if let Some(answer) = self
            .consents
            .iter_mut()
            .find(|answer| answer.key == consent.key)
        {
            answer.accepted = consent.polarity.accepted_from_tick(ticked);
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
        required_reception_consents().all(|required| {
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
#[derive(Clone, Debug, Default, PartialEq, Eq)]
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
        let keys: Vec<&str> = schema[0].item_fields.iter().map(|item| item.key).collect();
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
}
