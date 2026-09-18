//! ListReservationCancellationsUseCase: one use case, one public entrypoint
//! (`execute`).
//!
//! The extraction the club works a month from: everybody who gave up a tee
//! time in a period, why, and whether anybody has decided what to do about the
//! fee. Ordinarily narrowed to the reasons the club charges for and the rows
//! nobody has settled, which is the working list for collecting.
//!
//! Two halves from two places, the same split the call list makes. The rows
//! and the judgement on them are CourseBoard's, because what makes a
//! cancellation chargeable is a golf reading of a generic booking (ADR-0005).
//! Who the person is — the name as the ledger now spells it, and the phone
//! number somebody would ring — is Field's, asked for one page at a time
//! rather than copied.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    CancellationQuery, CourseError, Customer, CustomerGateway, GatewayCredentials,
    ReservationCancellation, ReservationCancellationGateway,
};

/// One cancelled booking, with whoever the ledger says booked it.
#[derive(Debug, Clone)]
pub struct CancellationEntry {
    pub cancellation: ReservationCancellation,
    /// Absent when the booking carries no ledger link, and also when Field
    /// would not answer about the one it carries. The row is kept either way:
    /// `customer_name` still says what the booking was taken under, and a row
    /// quietly dropped from a collection list is money nobody chases.
    pub customer: Option<Customer>,
}

impl CancellationEntry {
    /// Whether this booking carries a ledger link.
    ///
    /// Not whether a fee can be raised for it: since PLT-4159 an invoice can
    /// be addressed to a name alone, and the collection screen bills a booking
    /// taken under one as an unregistered recipient. What this still answers
    /// is whether there is a customer to attribute the charge to, which is
    /// what decides between one invoice per person and one per booking.
    pub fn billable(&self) -> bool {
        self.cancellation.customer_id.is_some()
    }
}

#[derive(Debug, Clone)]
pub struct CancellationPage {
    pub entries: Vec<CancellationEntry>,
    /// How many rows the period holds, not how many are on this page.
    pub total: i64,
}

pub struct ListReservationCancellationsUseCase {
    cancellations: Arc<dyn ReservationCancellationGateway>,
    customers: Arc<dyn CustomerGateway>,
}

impl ListReservationCancellationsUseCase {
    pub fn new(
        cancellations: Arc<dyn ReservationCancellationGateway>,
        customers: Arc<dyn CustomerGateway>,
    ) -> Self {
        Self {
            cancellations,
            customers,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        query: &CancellationQuery,
    ) -> Result<CancellationPage, CourseError> {
        // Reading the cancellation list is reading the ledger by another
        // route: it names people and says what they did. Guarded as such
        // rather than as tee sheet work.
        credentials.require(actions::LIST_CUSTOMERS).await?;
        query.validate()?;
        let tenant_id = credentials.operator_id;

        let rows = self
            .cancellations
            .list_cancellations(tenant_id, query)
            .await?;
        let total = self
            .cancellations
            .count_cancellations(tenant_id, query)
            .await?;

        // One question to Field per linked row on this page, run together —
        // the price of not keeping a copy of the ledger, bounded by the page
        // and not by the size of the period.
        let people = futures::future::join_all(rows.iter().map(|row| async move {
            match &row.customer_id {
                Some(customer_id) => {
                    Some(self.customers.get_customer(credentials, customer_id).await)
                }
                None => None,
            }
        }))
        .await;

        let entries = rows
            .into_iter()
            .zip(people)
            .map(|(cancellation, person)| {
                let customer = match person {
                    Some(Ok(customer)) => Some(customer),
                    Some(Err(error)) => {
                        tracing::warn!(
                            error = %error,
                            reservation_id = cancellation.reservation_id.as_str(),
                            "a cancelled booking could not be matched to the ledger"
                        );
                        None
                    }
                    None => None,
                };
                CancellationEntry {
                    cancellation,
                    customer,
                }
            })
            .collect();

        Ok(CancellationPage { entries, total })
    }
}
