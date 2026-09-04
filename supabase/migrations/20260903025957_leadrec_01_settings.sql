-- LEAD RECOVERY ENGINE — 01: thresholds are data, never constants.
--
-- Deliberately EMPTY on creation. No dealership has stated a rule about how
-- long a customer may wait, so the engine runs on documented defaults and says
-- so on every row (v_lead_recovery.settings_are_defaults). An empty table is
-- the honest state; a seeded row would claim someone decided something.
--
-- Provenance of each default, so nobody re-invents them later:
--   sla_first_response_minutes = 5   already hardcoded in v_needs_attention
--                                    ('sla_breach' branch) and v_team_performance
--                                    (within_sla/breached_sla). This engine does
--                                    NOT own that number - it copies it. See the
--                                    divergence guard in v_lead_recovery_coverage.
--   silence_hours              = 12  the n8n workflow is literally named
--                                    "Phase 6 - 12-Hour Silence Detector" and its
--                                    markers read "[SILENCE-ESCALATED] Silent for 12h".
--   stale_silence_hours        = 72  6 x silence_hours. NOBODY HAS STATED THIS.
--                                    It is the one number here with no external
--                                    source and it is why settings_are_defaults
--                                    matters commercially.
--   engagement_window_days     = 14  no external source either.
--   detector_max_age_hours     = 26  two detector cycles plus two hours' slack.

create table public.lead_recovery_settings (
  tenant_id                  uuid primary key references public.tenants(id) on delete restrict,
  sla_first_response_minutes integer check (sla_first_response_minutes is null or sla_first_response_minutes > 0),
  silence_hours              integer check (silence_hours is null or silence_hours > 0),
  stale_silence_hours        integer check (stale_silence_hours is null or stale_silence_hours > 0),
  engagement_window_days     integer check (engagement_window_days is null or engagement_window_days > 0),
  detector_max_age_hours     integer check (detector_max_age_hours is null or detector_max_age_hours > 0),
  set_by                     text,
  set_at                     timestamptz not null default now(),
  note                       text,
  constraint lead_recovery_settings_stale_exceeds_silence
    check (stale_silence_hours is null or silence_hours is null or stale_silence_hours >= silence_hours)
);

comment on table public.lead_recovery_settings is
  'Per-dealership thresholds for the Lead Recovery Engine. Empty means nobody has '
  'stated a rule and the engine is running on defaults - which every row of '
  'v_lead_recovery reports as settings_are_defaults = true. sla_first_response_minutes '
  'is a COPY of a number hardcoded in v_needs_attention and v_team_performance; '
  'changing it here without changing those makes NEXUS quote two different SLAs. '
  'v_lead_recovery_coverage.sla_agrees_with_needs_attention exists to make that visible.';

alter table public.lead_recovery_settings enable row level security;

create policy lead_recovery_settings_authenticated_read
  on public.lead_recovery_settings for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));

-- RESTRICTIVE, not permissive. inventory_profit_settings.ipset_deny_anon is
-- permissive-false, which happens to yield zero rows today only because anon
-- holds no other permissive policy there. A name that says "deny" should deny
-- structurally.
create policy lead_recovery_settings_deny_anon
  on public.lead_recovery_settings as restrictive for all to anon
  using (false) with check (false);

create policy lead_recovery_settings_service_role_all
  on public.lead_recovery_settings for all to service_role
  using (true) with check (true);

revoke all on public.lead_recovery_settings from anon, public;
grant select on public.lead_recovery_settings to authenticated;
grant all    on public.lead_recovery_settings to service_role;