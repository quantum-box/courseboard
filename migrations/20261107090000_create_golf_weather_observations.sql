CREATE TABLE golf_weather_observations (
    tenant_id VARCHAR(64) NOT NULL,
    golf_course_id VARCHAR(64) NOT NULL,
    observed_at DATETIME NOT NULL,
    timezone VARCHAR(64) NOT NULL,
    weather VARCHAR(16) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (tenant_id, golf_course_id, observed_at),
    KEY idx_weather_tenant_date (tenant_id, observed_at)
);
