//! ListCustomerSummariesUseCase: one use case, one public entrypoint (`execute`).
//!
//! The call list. A slice of the ledger chosen by how people have played —
//! "spent the most", "has not been seen in ninety days", "comes every month" —
//! rather than picked out by eye from a printed sheet.
//!
//! Two halves come from two places on purpose. The figures and the ranking are
//! CourseBoard's, because what makes somebody worth ringing is a golf
//! judgement about generic bookings (ADR-0005). Who they actually are — name,
//! phone — is Field's, and is asked for one page at a time rather than copied,
//! so there is never a second customer ledger to keep in step.

use std::sync::Arc;

use chrono::{DateTime, Utc};

use crate::course::domain::actions;
use crate::course::domain::{
    CourseError, Customer, CustomerGateway, CustomerGradeRulesGateway, CustomerGradeVerdict,
    CustomerSummary, CustomerSummaryGateway, CustomerSummaryQuery, CustomerSummaryRun,
    GatewayCredentials,
};

/// One person on the list.
#[derive(Debug, Clone)]
pub struct CustomerSummaryEntry {
    pub summary: CustomerSummary,
    /// Absent when Field would not tell us who this is. The row is kept
    /// regardless: dropping it would quietly shrink a list the desk is working
    /// through, and a row that says only "could not be read" is at least
    /// something somebody can chase.
    pub customer: Option<Customer>,
    pub grade: CustomerGradeVerdict,
}

#[derive(Debug, Clone)]
pub struct CustomerSummaryPage {
    pub entries: Vec<CustomerSummaryEntry>,
    /// How many people the segment holds, not how many are on this page. The
    /// desk decides whether a filter is worth a morning from this number.
    pub total: i64,
    /// The last refresh. Carried so the screen can say how old the figures are
    /// — nothing in the numbers themselves admits to being three months stale.
    pub last_run: Option<CustomerSummaryRun>,
}

pub struct ListCustomerSummariesUseCase {
    summaries: Arc<dyn CustomerSummaryGateway>,
    customers: Arc<dyn CustomerGateway>,
    grades: Arc<dyn CustomerGradeRulesGateway>,
}

impl ListCustomerSummariesUseCase {
    pub fn new(
        summaries: Arc<dyn CustomerSummaryGateway>,
        customers: Arc<dyn CustomerGateway>,
        grades: Arc<dyn CustomerGradeRulesGateway>,
    ) -> Self {
        Self {
            summaries,
            customers,
            grades,
        }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
        query: &CustomerSummaryQuery,
        now: DateTime<Utc>,
    ) -> Result<CustomerSummaryPage, CourseError> {
        credentials.require(actions::LIST_CUSTOMERS).await?;
        query.validate()?;
        let tenant_id = credentials.operator_id;

        let rows = self
            .summaries
            .list_customer_summaries(tenant_id, query, now)
            .await?;
        let total = self
            .summaries
            .count_customer_summaries(tenant_id, query, now)
            .await?;
        let last_run = self.summaries.latest_summary_run(tenant_id).await?;
        // The same ladder the customer's own page reads. Judged here rather
        // than on the screen so one rule lives in one place.
        let ladder = self.grades.get_customer_grade_rules(tenant_id).await?;

        // One question to Field per row shown, run together. This is the price
        // of not keeping a copy of the ledger, and it is bounded by the page
        // size rather than by the size of the tenant. A generic bulk lookup
        // upstream would collapse it to one call.
        let people = futures::future::join_all(rows.iter().map(|row| async move {
            self.customers
                .get_customer(credentials, &row.customer_id)
                .await
        }))
        .await;

        let entries = rows
            .into_iter()
            .zip(people)
            .map(|(row, person)| {
                let grade = ladder.grade_for(&row.summary, row.truncated);
                let customer = match person {
                    Ok(customer) => Some(customer),
                    Err(error) => {
                        tracing::warn!(
                            error = %error,
                            customer_id = row.customer_id.as_str(),
                            "a row on the call list could not be matched to the ledger"
                        );
                        None
                    }
                };
                CustomerSummaryEntry {
                    summary: row,
                    customer,
                    grade,
                }
            })
            .collect();

        Ok(CustomerSummaryPage {
            entries,
            total,
            last_run,
        })
    }
}
