CREATE TABLE ai_providers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    endpoint_key TEXT UNIQUE,
    current_key_id TEXT,
    current_model_id TEXT,
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(id, current_key_id) REFERENCES ai_provider_keys(provider_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(id, current_model_id) REFERENCES ai_provider_models(provider_id, id)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE ai_provider_keys (
    id TEXT PRIMARY KEY NOT NULL,
    provider_id TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 80 AND label = trim(label)),
    credential_ref TEXT UNIQUE CHECK(credential_ref IS NULL OR length(credential_ref) > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(provider_id, id),
    UNIQUE(provider_id, label)
);
CREATE TABLE ai_provider_models (
    id TEXT PRIMARY KEY NOT NULL,
    provider_id TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    model_key TEXT NOT NULL,
    display_name TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(provider_id, id),
    UNIQUE(provider_id, model_key)
);
CREATE TABLE ai_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    active_provider_id TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
    streaming_enabled INTEGER NOT NULL DEFAULT 1 CHECK(streaming_enabled IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE ai_credential_journal (
    credential_ref TEXT PRIMARY KEY NOT NULL,
    operation_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN ('unpublished', 'retired')),
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_ai_credential_journal_operation ON ai_credential_journal(operation_id);
INSERT INTO ai_settings(id) VALUES(1);
