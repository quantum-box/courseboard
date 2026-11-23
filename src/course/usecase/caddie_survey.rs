//! The caddie survey's use cases: read where it stands, make it, and bring its
//! caddie list back in step with the roster. One public entrypoint each.

use std::sync::Arc;

use crate::course::domain::actions;
use crate::course::domain::{
    caddies_changed, is_forms_not_provided, CaddieSurveyForm, CaddieSurveyGateway,
    CaddieSurveyOverview, CaddieSurveyStatus, CourseError, GatewayCredentials,
};

/// Where the club's survey stands, for the screen that shows the QR.
pub struct GetCaddieSurveyUseCase {
    survey: Arc<dyn CaddieSurveyGateway>,
}

impl GetCaddieSurveyUseCase {
    pub fn new(survey: Arc<dyn CaddieSurveyGateway>) -> Self {
        Self { survey }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CaddieSurveyStatus, CourseError> {
        credentials.require(actions::LIST_CADDIE_INSIGHTS).await?;
        match read_status(self.survey.as_ref(), credentials).await {
            Err(error) if is_forms_not_provided(&error) => Ok(CaddieSurveyStatus::FormsUnavailable),
            other => other,
        }
    }
}

/// Make the survey and publish it. Asking again once it exists answers with
/// the one already made rather than a second form.
pub struct CreateCaddieSurveyUseCase {
    survey: Arc<dyn CaddieSurveyGateway>,
}

impl CreateCaddieSurveyUseCase {
    pub fn new(survey: Arc<dyn CaddieSurveyGateway>) -> Self {
        Self { survey }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CaddieSurveyStatus, CourseError> {
        credentials.require(actions::MANAGE_CADDIES).await?;
        if existing_form(self.survey.as_ref(), credentials)
            .await?
            .is_none()
        {
            require_caddies(self.survey.as_ref(), credentials).await?;
            let form = self.survey.create_survey_draft(credentials).await?;
            self.survey.remember_form_id(credentials, &form.id).await?;
            self.survey.publish_form(credentials, &form.id).await?;
        }
        read_status(self.survey.as_ref(), credentials).await
    }
}

/// Rebuild the survey's caddie list from the roster and publish it again.
pub struct RefreshCaddieSurveyUseCase {
    survey: Arc<dyn CaddieSurveyGateway>,
}

impl RefreshCaddieSurveyUseCase {
    pub fn new(survey: Arc<dyn CaddieSurveyGateway>) -> Self {
        Self { survey }
    }

    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<CaddieSurveyStatus, CourseError> {
        credentials.require(actions::MANAGE_CADDIES).await?;
        let form = existing_form(self.survey.as_ref(), credentials)
            .await?
            .ok_or(CourseError::NotFound(
                "the caddie survey has not been made yet",
            ))?;
        require_caddies(self.survey.as_ref(), credentials).await?;
        self.survey.refresh_caddies(credentials, &form.id).await?;
        read_status(self.survey.as_ref(), credentials).await
    }
}

/// The remembered survey, unless Field no longer has it or it was archived.
async fn existing_form(
    survey: &dyn CaddieSurveyGateway,
    credentials: GatewayCredentials<'_>,
) -> Result<Option<CaddieSurveyForm>, CourseError> {
    let Some(form_id) = survey.remembered_form_id(credentials).await? else {
        return Ok(None);
    };
    Ok(survey
        .find_form(credentials, &form_id)
        .await?
        .filter(|form| !form.is_archived()))
}

async fn require_caddies(
    survey: &dyn CaddieSurveyGateway,
    credentials: GatewayCredentials<'_>,
) -> Result<(), CourseError> {
    match survey.current_caddies(credentials).await? {
        Some(caddies) if !caddies.is_empty() => Ok(()),
        _ => Err(CourseError::BadRequest(
            "there is no active caddie to list in the survey",
        )),
    }
}

async fn read_status(
    survey: &dyn CaddieSurveyGateway,
    credentials: GatewayCredentials<'_>,
) -> Result<CaddieSurveyStatus, CourseError> {
    // Field Forms answers first: when the tenant does not have it, nothing
    // else here can be done and the screen says so.
    let current = survey.current_caddies(credentials).await?;
    let form = existing_form(survey, credentials).await?;
    Ok(match (form, current) {
        (Some(form), current) => {
            let current = current.unwrap_or_default();
            CaddieSurveyStatus::Ready(CaddieSurveyOverview {
                public_url: survey.public_url(&form.public_id),
                current_caddie_count: current.len(),
                caddies_changed: caddies_changed(&form.published_caddies, &current),
                form,
            })
        }
        (None, Some(current)) if !current.is_empty() => CaddieSurveyStatus::NotCreated {
            caddie_count: current.len(),
        },
        (None, _) => CaddieSurveyStatus::NoCaddies,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::course::domain::{forms_not_provided, CourseAuthorizer, SurveyCaddieChoice};

    struct Granting(&'static [&'static str]);

    #[async_trait::async_trait]
    impl CourseAuthorizer for Granting {
        async fn require(
            &self,
            _: GatewayCredentials<'_>,
            action: &'static str,
        ) -> Result<(), CourseError> {
            if self.0.contains(&action) {
                Ok(())
            } else {
                Err(CourseError::Forbidden(action))
            }
        }
    }

    fn choice(id: &str, name: &str) -> SurveyCaddieChoice {
        SurveyCaddieChoice {
            id: id.into(),
            name: name.into(),
        }
    }

    fn form(id: &str, status: &str, caddies: Vec<SurveyCaddieChoice>) -> CaddieSurveyForm {
        CaddieSurveyForm {
            id: id.into(),
            public_id: format!("pub-{id}"),
            status: status.into(),
            published: status == "published",
            has_unpublished_changes: false,
            published_caddies: caddies,
        }
    }

    #[derive(Default)]
    struct FakeSurvey {
        remembered: Mutex<Option<String>>,
        forms: Mutex<Vec<CaddieSurveyForm>>,
        caddies: Option<Vec<SurveyCaddieChoice>>,
        forms_not_provided: bool,
        publish_fails: bool,
        created: Mutex<usize>,
        refreshed: Mutex<Vec<String>>,
    }

    #[async_trait::async_trait]
    impl CaddieSurveyGateway for FakeSurvey {
        async fn remembered_form_id(
            &self,
            _: GatewayCredentials<'_>,
        ) -> Result<Option<String>, CourseError> {
            Ok(self.remembered.lock().unwrap().clone())
        }

        async fn remember_form_id(
            &self,
            _: GatewayCredentials<'_>,
            form_id: &str,
        ) -> Result<(), CourseError> {
            *self.remembered.lock().unwrap() = Some(form_id.into());
            Ok(())
        }

        async fn find_form(
            &self,
            _: GatewayCredentials<'_>,
            form_id: &str,
        ) -> Result<Option<CaddieSurveyForm>, CourseError> {
            Ok(self
                .forms
                .lock()
                .unwrap()
                .iter()
                .find(|form| form.id == form_id)
                .cloned())
        }

        async fn current_caddies(
            &self,
            _: GatewayCredentials<'_>,
        ) -> Result<Option<Vec<SurveyCaddieChoice>>, CourseError> {
            if self.forms_not_provided {
                return Err(forms_not_provided());
            }
            Ok(self.caddies.clone())
        }

        async fn create_survey_draft(
            &self,
            _: GatewayCredentials<'_>,
        ) -> Result<CaddieSurveyForm, CourseError> {
            *self.created.lock().unwrap() += 1;
            let made = form("f-new", "draft", vec![]);
            self.forms.lock().unwrap().push(made.clone());
            Ok(made)
        }

        async fn publish_form(
            &self,
            _: GatewayCredentials<'_>,
            form_id: &str,
        ) -> Result<CaddieSurveyForm, CourseError> {
            if self.publish_fails {
                return Err(CourseError::UpstreamClient {
                    status: 400,
                    message: "caddie option no longer exists".into(),
                });
            }
            let mut forms = self.forms.lock().unwrap();
            let target = forms
                .iter_mut()
                .find(|form| form.id == form_id)
                .expect("publish is only asked for a known form");
            target.status = "published".into();
            target.published = true;
            target.published_caddies = self.caddies.clone().unwrap_or_default();
            Ok(target.clone())
        }

        async fn refresh_caddies(
            &self,
            _: GatewayCredentials<'_>,
            form_id: &str,
        ) -> Result<CaddieSurveyForm, CourseError> {
            self.refreshed.lock().unwrap().push(form_id.into());
            let mut forms = self.forms.lock().unwrap();
            let target = forms
                .iter_mut()
                .find(|form| form.id == form_id)
                .expect("refresh is only asked for a known form");
            target.published_caddies = self.caddies.clone().unwrap_or_default();
            Ok(target.clone())
        }

        fn public_url(&self, public_id: &str) -> String {
            format!("https://field.test/v1/public/forms/{public_id}/frame")
        }
    }

    const ALL: &[&str] = &[actions::LIST_CADDIE_INSIGHTS, actions::MANAGE_CADDIES];

    fn credentials(authorizer: &dyn CourseAuthorizer) -> GatewayCredentials<'_> {
        GatewayCredentials {
            authorization: "Bearer caller",
            caller_bearer: "Bearer caller",
            operator_id: "tenant-a",
            platform_id: None,
            authorizer,
        }
    }

    #[tokio::test]
    async fn a_tenant_without_field_forms_is_told_so_rather_than_failing() {
        let survey = Arc::new(FakeSurvey {
            forms_not_provided: true,
            ..Default::default()
        });
        let status = GetCaddieSurveyUseCase::new(survey)
            .execute(credentials(&Granting(ALL)))
            .await
            .expect("status");
        assert_eq!(status, CaddieSurveyStatus::FormsUnavailable);
    }

    #[tokio::test]
    async fn before_it_is_made_the_status_says_how_many_caddies_it_would_list() {
        let survey = Arc::new(FakeSurvey {
            caddies: Some(vec![choice("c1", "佐藤"), choice("c2", "鈴木")]),
            ..Default::default()
        });
        let status = GetCaddieSurveyUseCase::new(survey)
            .execute(credentials(&Granting(ALL)))
            .await
            .expect("status");
        assert_eq!(status, CaddieSurveyStatus::NotCreated { caddie_count: 2 });
    }

    #[tokio::test]
    async fn without_caddies_there_is_nothing_to_make() {
        let survey = Arc::new(FakeSurvey::default());
        let status = GetCaddieSurveyUseCase::new(survey.clone())
            .execute(credentials(&Granting(ALL)))
            .await
            .expect("status");
        assert_eq!(status, CaddieSurveyStatus::NoCaddies);

        let created = CreateCaddieSurveyUseCase::new(survey.clone())
            .execute(credentials(&Granting(ALL)))
            .await;
        assert!(matches!(created, Err(CourseError::BadRequest(_))));
        assert_eq!(*survey.created.lock().unwrap(), 0);
    }

    #[tokio::test]
    async fn making_it_remembers_the_form_and_a_second_ask_does_not_make_another() {
        let survey = Arc::new(FakeSurvey {
            caddies: Some(vec![choice("c1", "佐藤")]),
            ..Default::default()
        });
        for _ in 0..2 {
            let status = CreateCaddieSurveyUseCase::new(survey.clone())
                .execute(credentials(&Granting(ALL)))
                .await
                .expect("create");
            let CaddieSurveyStatus::Ready(overview) = status else {
                panic!("expected a ready survey, got {status:?}");
            };
            assert_eq!(overview.form.id, "f-new");
            assert_eq!(
                overview.public_url,
                "https://field.test/v1/public/forms/pub-f-new/frame"
            );
            assert!(!overview.caddies_changed);
        }
        assert_eq!(*survey.created.lock().unwrap(), 1);
        assert_eq!(survey.remembered.lock().unwrap().as_deref(), Some("f-new"));
    }

    #[tokio::test]
    async fn a_failed_first_publish_still_leaves_the_survey_findable() {
        let survey = Arc::new(FakeSurvey {
            caddies: Some(vec![choice("c1", "佐藤")]),
            publish_fails: true,
            ..Default::default()
        });
        let created = CreateCaddieSurveyUseCase::new(survey.clone())
            .execute(credentials(&Granting(ALL)))
            .await;
        assert!(matches!(
            created,
            Err(CourseError::UpstreamClient { status: 400, .. })
        ));
        assert_eq!(survey.remembered.lock().unwrap().as_deref(), Some("f-new"));
        let CaddieSurveyStatus::Ready(overview) = GetCaddieSurveyUseCase::new(survey)
            .execute(credentials(&Granting(ALL)))
            .await
            .expect("status")
        else {
            panic!("expected the draft to be found");
        };
        assert_eq!(overview.form.status, "draft");
        assert!(overview.caddies_changed);
    }

    #[tokio::test]
    async fn an_archived_survey_is_made_again() {
        let survey = Arc::new(FakeSurvey {
            caddies: Some(vec![choice("c1", "佐藤")]),
            remembered: Mutex::new(Some("f-old".into())),
            forms: Mutex::new(vec![form("f-old", "archived", vec![])]),
            ..Default::default()
        });
        CreateCaddieSurveyUseCase::new(survey.clone())
            .execute(credentials(&Granting(ALL)))
            .await
            .expect("create");
        assert_eq!(*survey.created.lock().unwrap(), 1);
        assert_eq!(survey.remembered.lock().unwrap().as_deref(), Some("f-new"));
    }

    #[tokio::test]
    async fn a_roster_change_shows_until_the_survey_is_refreshed() {
        let survey = Arc::new(FakeSurvey {
            caddies: Some(vec![choice("c1", "佐藤"), choice("c3", "高橋")]),
            remembered: Mutex::new(Some("f1".into())),
            forms: Mutex::new(vec![form("f1", "published", vec![choice("c1", "佐藤")])]),
            ..Default::default()
        });
        let before = GetCaddieSurveyUseCase::new(survey.clone())
            .execute(credentials(&Granting(ALL)))
            .await
            .expect("status");
        let CaddieSurveyStatus::Ready(before) = before else {
            panic!("expected ready");
        };
        assert!(before.caddies_changed);
        assert_eq!(before.current_caddie_count, 2);

        let after = RefreshCaddieSurveyUseCase::new(survey.clone())
            .execute(credentials(&Granting(ALL)))
            .await
            .expect("refresh");
        let CaddieSurveyStatus::Ready(after) = after else {
            panic!("expected ready");
        };
        assert!(!after.caddies_changed);
        assert_eq!(*survey.refreshed.lock().unwrap(), vec!["f1".to_string()]);
    }

    #[tokio::test]
    async fn refreshing_a_survey_that_was_never_made_is_not_found() {
        let survey = Arc::new(FakeSurvey {
            caddies: Some(vec![choice("c1", "佐藤")]),
            ..Default::default()
        });
        let result = RefreshCaddieSurveyUseCase::new(survey)
            .execute(credentials(&Granting(ALL)))
            .await;
        assert!(matches!(result, Err(CourseError::NotFound(_))));
    }

    #[tokio::test]
    async fn reading_needs_the_insights_grant_and_writing_the_roster_grant() {
        let survey = Arc::new(FakeSurvey {
            caddies: Some(vec![choice("c1", "佐藤")]),
            ..Default::default()
        });
        let read_only = Granting(&[actions::LIST_CADDIE_INSIGHTS]);
        assert!(GetCaddieSurveyUseCase::new(survey.clone())
            .execute(credentials(&read_only))
            .await
            .is_ok());
        assert!(matches!(
            CreateCaddieSurveyUseCase::new(survey.clone())
                .execute(credentials(&read_only))
                .await,
            Err(CourseError::Forbidden(actions::MANAGE_CADDIES))
        ));
        assert!(matches!(
            RefreshCaddieSurveyUseCase::new(survey.clone())
                .execute(credentials(&read_only))
                .await,
            Err(CourseError::Forbidden(actions::MANAGE_CADDIES))
        ));
        assert!(matches!(
            GetCaddieSurveyUseCase::new(survey)
                .execute(credentials(&Granting(&[])))
                .await,
            Err(CourseError::Forbidden(actions::LIST_CADDIE_INSIGHTS))
        ));
    }
}
