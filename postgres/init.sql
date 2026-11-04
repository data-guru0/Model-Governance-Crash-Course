-- Runs once, on the first start of an empty Postgres volume.
-- One server, three databases: LiteLLM (gateway), MLflow (registry), governance (our own records).
CREATE DATABASE litellm;
CREATE DATABASE mlflow;

-- We are connected to the "governance" database (POSTGRES_DB).
CREATE SCHEMA governance;

-- Append-only audit log. Every governance action writes one row.
-- Rows are hash-chained (hash = sha256(prev_hash + row content)) so tampering is detectable,
-- and triggers below make UPDATE / DELETE / TRUNCATE impossible for every client.
CREATE TABLE governance.audit_log (
    id         BIGSERIAL PRIMARY KEY,
    ts         TIMESTAMPTZ NOT NULL,
    actor      TEXT NOT NULL,
    stage      TEXT NOT NULL,
    action     TEXT NOT NULL,
    decision   TEXT,
    details    JSONB NOT NULL DEFAULT '{}',
    evidence   JSONB NOT NULL DEFAULT '{}',
    prev_hash  TEXT,
    hash       TEXT NOT NULL
);

CREATE FUNCTION governance.forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'governance.audit_log is append-only';
END $$;

CREATE TRIGGER audit_no_update_delete BEFORE UPDATE OR DELETE ON governance.audit_log
    FOR EACH ROW EXECUTE FUNCTION governance.forbid_change();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON governance.audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION governance.forbid_change();

-- Small key/value store for the current lifecycle state (stage, weights, virtual keys).
CREATE TABLE governance.state (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every gate evaluation, pass or fail, with the exact checks and thresholds used.
CREATE TABLE governance.gate_decisions (
    id         BIGSERIAL PRIMARY KEY,
    ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
    stage      TEXT NOT NULL,
    passed     BOOLEAN NOT NULL,
    checks     JSONB NOT NULL,
    evidence   JSONB NOT NULL DEFAULT '{}',
    policy_version TEXT NOT NULL
);

-- Production requests as seen by the Nova Assist app (one row per user request).
CREATE TABLE governance.requests (
    id                BIGSERIAL PRIMARY KEY,
    ts                TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_id        TEXT NOT NULL UNIQUE,
    litellm_call_id   TEXT,
    stage             TEXT NOT NULL,
    intent            TEXT,
    category          TEXT,
    prompt            TEXT NOT NULL,
    response          TEXT,
    model_version     TEXT,
    model_id          TEXT,
    latency_ms        DOUBLE PRECISION,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    cost_usd          DOUBLE PRECISION,
    error             TEXT,
    quality_score     DOUBLE PRECISION,
    quality_reason    TEXT,
    simulated         BOOLEAN NOT NULL DEFAULT false,  -- classroom simulator row, never real traffic
    story_day         INTEGER                          -- day of the classroom story calendar (simulated rows)
);
CREATE INDEX requests_stage_idx ON governance.requests (stage, model_version);

-- Shadow comparisons: the champion answer the user saw vs the silent challenger answer.
CREATE TABLE governance.shadow_pairs (
    id                    BIGSERIAL PRIMARY KEY,
    ts                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_id            TEXT NOT NULL UNIQUE,
    intent                TEXT,
    prompt                TEXT NOT NULL,
    champion_response     TEXT,
    challenger_response   TEXT,
    champion_latency_ms   DOUBLE PRECISION,
    challenger_latency_ms DOUBLE PRECISION,
    champion_tokens       INTEGER,
    challenger_tokens     INTEGER,
    champion_cost_usd     DOUBLE PRECISION,
    challenger_cost_usd   DOUBLE PRECISION,
    challenger_error      TEXT,
    verdict               TEXT,      -- challenger | champion | tie
    verdict_reason        TEXT,
    challenger_violation  TEXT,      -- none | minor | critical
    judged_at             TIMESTAMPTZ,
    review_decision       TEXT,      -- human review of a critical flag: confirmed | overturned
    reviewed_by           TEXT,
    review_note           TEXT,
    simulated             BOOLEAN NOT NULL DEFAULT false
);

-- Per-example offline evaluation results. Persisted as they complete so a run that hits
-- a rate limit can resume where it stopped instead of re-spending tokens.
CREATE TABLE governance.eval_results (
    id          BIGSERIAL PRIMARY KEY,
    run_key     TEXT NOT NULL,
    example_id  TEXT NOT NULL,
    result      JSONB NOT NULL,
    UNIQUE (run_key, example_id)
);

-- Background jobs requested from the console and executed by the governance worker.
CREATE TABLE governance.jobs (
    id          BIGSERIAL PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    kind        TEXT NOT NULL,
    params      JSONB NOT NULL DEFAULT '{}',
    actor       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed
    progress    TEXT,
    result      JSONB,
    error       TEXT
);
