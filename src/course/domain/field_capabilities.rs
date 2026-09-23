use super::CourseError;

/// A verified Cognito access token delegated by the inbound caller.
///
/// Deliberately does not implement `Debug` or `Display`: tokens must not leak
/// through structured logs or error formatting.
pub struct FieldAccessToken(String);

impl FieldAccessToken {
    pub fn try_new(value: &str) -> Result<Self, CourseError> {
        if value.is_empty() {
            return Err(CourseError::BadRequest("access token must not be empty"));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldOperatorId(String);

impl FieldOperatorId {
    pub fn try_new(value: &str) -> Result<Self, CourseError> {
        if !is_tachyon_tenant_id(value) {
            return Err(CourseError::BadRequest(
                "x-operator-id must be a TACHYON tenant id",
            ));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldPlatformId(String);

impl FieldPlatformId {
    pub fn try_new(value: &str) -> Result<Self, CourseError> {
        if !is_tachyon_tenant_id(value) {
            return Err(CourseError::BadRequest(
                "x-platform-id must be a TACHYON tenant id",
            ));
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Request-scoped Field authorization context.
///
/// This value is built by the HTTP handler after token verification and tenant
/// header parsing, then passed to the use case as value objects only.
pub struct FieldRequestContext {
    access_token: FieldAccessToken,
    operator_id: FieldOperatorId,
    platform_id: FieldPlatformId,
}

impl FieldRequestContext {
    pub fn new(
        access_token: FieldAccessToken,
        operator_id: FieldOperatorId,
        platform_id: FieldPlatformId,
    ) -> Self {
        Self {
            access_token,
            operator_id,
            platform_id,
        }
    }

    pub fn access_token(&self) -> &str {
        self.access_token.as_str()
    }

    pub fn operator_id(&self) -> &str {
        self.operator_id.as_str()
    }

    pub fn platform_id(&self) -> &str {
        self.platform_id.as_str()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldClientCapabilities {
    pub agent_documents: FieldAgentDocumentCapabilities,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldAgentDocumentCapabilities {
    pub invoices: FieldDocumentQueueCapabilities,
    pub quotations: FieldDocumentQueueCapabilities,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldDocumentQueueCapabilities {
    pub list: bool,
    pub send: bool,
}

fn is_tachyon_tenant_id(value: &str) -> bool {
    value.strip_prefix("tn_").is_some_and(|suffix| {
        suffix.len() == 26
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tenant_value_objects_accept_only_canonical_tachyon_ids() {
        let valid = "tn_01hjjn348rn3t49zz6hvmfq67p";
        assert!(FieldOperatorId::try_new(valid).is_ok());
        assert!(FieldPlatformId::try_new(valid).is_ok());

        for invalid in [
            "",
            "tn_short",
            "tn_01HJ JN348RN3T49ZZ6HVMFQ67P",
            " tn_01hjjn348rn3t49zz6hvmfq67p",
            "tn_01hjjn348rn3t49zz6hvmfq67p ",
        ] {
            assert!(FieldOperatorId::try_new(invalid).is_err(), "{invalid}");
            assert!(FieldPlatformId::try_new(invalid).is_err(), "{invalid}");
        }
    }
}
