-- ============================================================================
-- ACAD SUPERVISORY CONTROL PLANE (ACAD-CONTROL)
-- Production PostgreSQL Database Schema & Indexes
-- Target Platforms: Render PostgreSQL, Neon, Supabase, Self-hosted PG
-- ============================================================================

-- 1. Platform Staff Users (Supervisory Administrators & Engineers)
CREATE TABLE IF NOT EXISTS platform_users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'admin', 'ops_engineer', 'support_agent', 'auditor')),
    mfa_secret VARCHAR(255),
    is_active SMALLINT NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Multi-school Educational Organizations / School Groups
CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'Nigeria',
    state VARCHAR(100),
    city VARCHAR(100),
    contact_name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. School Campuses
CREATE TABLE IF NOT EXISTS schools (
    id SERIAL PRIMARY KEY,
    org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    school_code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'trial' CHECK (status IN ('lead', 'trial', 'active', 'suspended', 'churned')),
    primary_admin_name VARCHAR(255),
    primary_admin_email VARCHAR(255),
    primary_admin_phone VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Physical / Virtual Server Installations (Edge Nodes)
CREATE TABLE IF NOT EXISTS installations (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    installation_id VARCHAR(100) UNIQUE NOT NULL,
    node_id VARCHAR(100) NOT NULL,
    secret_key_hash VARCHAR(255) NOT NULL,
    software_version VARCHAR(50) NOT NULL DEFAULT '5.3.0',
    agent_version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
    release_channel VARCHAR(50) NOT NULL DEFAULT 'stable' CHECK (release_channel IN ('stable', 'beta', 'canary')),
    public_ip VARCHAR(50),
    local_ip VARCHAR(50),
    last_heartbeat_at TIMESTAMPTZ,
    health_status VARCHAR(50) NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'warning', 'degraded', 'critical', 'offline', 'unknown')),
    health_score INTEGER NOT NULL DEFAULT 100,
    is_revoked SMALLINT NOT NULL DEFAULT 0 CHECK (is_revoked IN (0, 1)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Licenses
CREATE TABLE IF NOT EXISTS licenses (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    license_key VARCHAR(255) UNIQUE NOT NULL,
    plan_tier VARCHAR(50) NOT NULL DEFAULT 'standard' CHECK (plan_tier IN ('trial', 'starter', 'standard', 'enterprise', 'government')),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'suspended', 'expired', 'cancelled')),
    max_students INTEGER NOT NULL DEFAULT 500,
    max_teachers INTEGER NOT NULL DEFAULT 50,
    max_installations INTEGER NOT NULL DEFAULT 1,
    enabled_modules_json TEXT NOT NULL DEFAULT '["cbt_exam","question_bank","grading_center","report_cards"]',
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Trials Lifecycle Pipeline
CREATE TABLE IF NOT EXISTS trials (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    installation_id VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('lead', 'provisioned', 'active', 'expiring', 'converted', 'expired')),
    duration_days INTEGER NOT NULL DEFAULT 30,
    started_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    converted_at TIMESTAMPTZ,
    student_limit INTEGER NOT NULL DEFAULT 150,
    teacher_limit INTEGER NOT NULL DEFAULT 15,
    onboarding_step INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Feature Flags (Per-School Modular Controls)
CREATE TABLE IF NOT EXISTS feature_flags (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    flag_key VARCHAR(100) NOT NULL,
    is_enabled SMALLINT NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
    updated_by INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (school_id, flag_key)
);

-- 8. Installation Heartbeats & Real-time Vitals
CREATE TABLE IF NOT EXISTS installation_heartbeats (
    id SERIAL PRIMARY KEY,
    installation_id VARCHAR(100) NOT NULL REFERENCES installations(installation_id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL,
    cpu_usage REAL,
    memory_usage REAL,
    storage_usage REAL,
    db_status VARCHAR(50),
    connected_clients INTEGER,
    active_exam_sessions INTEGER,
    sync_queue_size INTEGER,
    raw_payload_json TEXT
);

-- 9. Operational Telemetry Events
CREATE TABLE IF NOT EXISTS telemetry_events (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL,
    installation_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(50) NOT NULL CHECK (severity IN ('info', 'warning', 'high', 'critical')),
    metadata_json TEXT,
    software_version VARCHAR(50),
    event_timestamp TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Automated Alert Alarms
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    installation_id VARCHAR(100) NOT NULL,
    alert_type VARCHAR(100) NOT NULL,
    severity VARCHAR(50) NOT NULL CHECK (severity IN ('info', 'warning', 'high', 'critical')),
    title VARCHAR(255) NOT NULL,
    details TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    acknowledged_by INTEGER,
    resolved_by INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- 11. Support Incidents
CREATE TABLE IF NOT EXISTS incidents (
    id SERIAL PRIMARY KEY,
    incident_code VARCHAR(100) UNIQUE NOT NULL,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    installation_id VARCHAR(100),
    severity VARCHAR(50) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'investigating', 'mitigated', 'resolved', 'closed')),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assigned_to INTEGER,
    root_cause TEXT,
    mitigation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- 12. Backup Telemetry Records
CREATE TABLE IF NOT EXISTS backups_telemetry (
    id SERIAL PRIMARY KEY,
    installation_id VARCHAR(100) NOT NULL,
    school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    backup_type VARCHAR(50) NOT NULL DEFAULT 'local_snapshot',
    backup_size_bytes BIGINT NOT NULL DEFAULT 0,
    destination VARCHAR(255) NOT NULL,
    is_successful SMALLINT NOT NULL DEFAULT 1,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Software Releases & Distribution
CREATE TABLE IF NOT EXISTS software_releases (
    id SERIAL PRIMARY KEY,
    version VARCHAR(50) UNIQUE NOT NULL,
    release_channel VARCHAR(50) NOT NULL DEFAULT 'stable' CHECK (release_channel IN ('stable', 'beta', 'canary')),
    min_agent_version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
    release_notes TEXT,
    download_url TEXT,
    sha256_hash VARCHAR(64),
    is_critical_security SMALLINT NOT NULL DEFAULT 0,
    released_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Platform Audit Log (Immutable append-only)
CREATE TABLE IF NOT EXISTS platform_audit_logs (
    id SERIAL PRIMARY KEY,
    actor_id INTEGER,
    actor_email VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(100) NOT NULL,
    target_id VARCHAR(100) NOT NULL,
    details_json TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Bidirectional Sync Queue (Cloud -> Node config push delivery)
CREATE TABLE IF NOT EXISTS sync_queue (
    id SERIAL PRIMARY KEY,
    installation_id VARCHAR(100) NOT NULL REFERENCES installations(installation_id) ON DELETE CASCADE,
    school_id INTEGER NOT NULL,
    payload_type VARCHAR(50) NOT NULL CHECK (payload_type IN ('feature_flags', 'license', 'config', 'force_update', 'reboot_request', 'diagnostics')),
    payload_json TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
    queued_by INTEGER,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
);

-- Optimized Performance Indexes
CREATE INDEX IF NOT EXISTS idx_installations_school_id ON installations(school_id);
CREATE INDEX IF NOT EXISTS idx_installations_health ON installations(health_status);
CREATE INDEX IF NOT EXISTS idx_trials_school_id ON trials(school_id);
CREATE INDEX IF NOT EXISTS idx_trials_status ON trials(status);
CREATE INDEX IF NOT EXISTS idx_licenses_school_id ON licenses(school_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats_install_time ON installation_heartbeats(installation_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_telemetry_school_time ON telemetry_events(school_id, event_timestamp);
CREATE INDEX IF NOT EXISTS idx_alerts_school_status ON alerts(school_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_audit_time ON platform_audit_logs(created_at);
