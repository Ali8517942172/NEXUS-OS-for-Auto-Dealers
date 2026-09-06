-- ============================================================================
-- NEXUS OS — demo dealership seed
--
--   Creates ONE fictional dealership on the STAGING project
--   (wwspuxrbiyagnrnzgate) and the dataset that makes `Today's Money Leaks`
--   say something true and interesting about it.
--
--   IT MUST NEVER RUN AGAINST PRODUCTION (dsvuoovivysszdoiorch). Production
--   holds the one real dealership, ALBA CARS. Synthetic rows filed beside real
--   ones poison every count on every screen, and that is exactly what this
--   project's tenancy work exists to prevent. The guard at the top refuses on
--   two independent tests and neither can be satisfied by production.
--
--   IDEMPOTENT. It purges everything it owns — every row carrying the demo
--   tenant id, and nothing else — before writing. Run it as often as you like;
--   run it again the morning of a demo so the ageing dates are fresh.
--
--   SCOPE. Every DELETE and every INSERT in this file is keyed on
--   tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'. Nothing here can
--   reach Alpha Motors, Bravo Autos, the quarantine tenant, or any platform
--   reference table. `ops/demo/teardown_demo_tenant.sql` reverses it.
--
--   EVERY ROW IS UNMISTAKABLY SYNTHETIC, at the data level and on the screen:
--     · the dealership is named  NORTHWIND MOTORS (DEMO — FICTIONAL DEALERSHIP)
--     · every person is  <First> Example (demo)
--     · every address is in the RFC 2606 `.invalid` namespace
--     · every phone is +9715000000NN — a number that cannot be dialled
--     · every unit id starts DEMO- and every VIN starts DEMOVIN
--     · every competitor is  ... (demo)
--
--   WHAT IT DELIBERATELY DOES NOT DO
--     · It records NO holding-cost rate. Net margin therefore renders
--       NOT_COMPUTABLE with its reason on all 29 units, and the exposure
--       figures stay gross. That refusal is the product, not a gap in the
--       fixture.
--     · It attributes NO revenue to NEXUS. Two confirmed sales exist and
--       neither is credited to any action.
--     · It writes no silence-detector audit rows, so the detector reads
--       NEVER_SUCCEEDED for this dealership — which is true: no workflow has
--       ever run for it.
--
--   Written 6 September 2026.
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 0 · THE GUARD. Two tests, both must pass.
--     (a) a negative test that cannot pass on production, and
--     (b) a positive test that cannot pass anywhere but staging.
--     A mistake is impossible rather than merely unlikely.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
begin
  if exists (select 1 from public.tenants
              where lower(slug) like '%alba%' or lower(name) like '%alba%') then
    raise exception using
      errcode = 'NX999',
      message = 'REFUSED: this database contains the ALBA CARS tenant, which identifies it as NEXUS PRODUCTION.',
      detail  = 'The demo dataset is synthetic. Writing it beside the one real dealership would poison every '
             || 'count on every screen and is the precise failure this product''s tenancy work exists to prevent.',
      hint    = 'Run this against the staging project (wwspuxrbiyagnrnzgate) only. Nothing in this file may be '
             || 'run against dsvuoovivysszdoiorch, with or without edits.';
  end if;

  if not (exists (select 1 from public.tenants where slug = 'staging-alpha')
      and exists (select 1 from public.tenants where slug = 'staging-bravo')) then
    raise exception using
      errcode = 'NX999',
      message = 'REFUSED: this database does not look like NEXUS STAGING.',
      detail  = 'The staging fixture tenants staging-alpha and staging-bravo were not both found. This script '
             || 'only recognises staging by their presence, and it refuses rather than guess where it is.',
      hint    = 'If staging has been rebuilt without those fixtures, restore them first, or change this test '
             || 'deliberately — do not delete it.';
  end if;
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1 · PURGE. Everything this script owns, and nothing else.
--     Order is FK order. Every predicate names the demo tenant id.
-- ────────────────────────────────────────────────────────────────────────────
delete from public.inventory_action_events        where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.inventory_actions              where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.lead_recovery_action_events    where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.lead_recovery_actions          where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.purchase_history               where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.deals_embeddings               where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.communication_logs             where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.whatsapp_contacts              where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.competitors                    where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.audit_log                      where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.kyc_documents                  where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.finance_quotes                 where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.customer_360_profiles          where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.daily_metrics                  where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.processed_messages             where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.rag_documents                  where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.leads                          where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.inventory                      where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.inventory_profit_settings      where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.inventory_action_policy        where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.lead_recovery_settings         where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.deal_rescue_settings           where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.tenant_configuration           where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.tenant_capability              where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.tenant_members                 where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.users                          where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

-- ────────────────────────────────────────────────────────────────────────────
-- 2 · THE DEALERSHIP
-- ────────────────────────────────────────────────────────────────────────────
insert into public.tenants (id, slug, name, status, is_quarantine, is_unattributed_default)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'demo-northwind',
        'NORTHWIND MOTORS (DEMO — FICTIONAL DEALERSHIP)', 'active', false, false)
on conflict (id) do update
   set slug = excluded.slug, name = excluded.name, status = excluded.status;

-- ────────────────────────────────────────────────────────────────────────────
-- 3 · THE PEOPLE — three sign-ins, three staff records, three roles.
--     Passwords are set here because a demo needs a login. They protect
--     nothing: this tenant holds no real person's data. Rotate them anyway if
--     the staging URL is ever shared outside the team.
-- ────────────────────────────────────────────────────────────────────────────
--  The eight empty-string columns are load-bearing and were learned the hard
--  way: GoTrue scans confirmation_token, recovery_token, email_change,
--  email_change_token_new/current, phone_change, phone_change_token and
--  reauthentication_token into non-nullable Go strings. Leave any of them NULL
--  and every sign-in for that account returns
--      500 unexpected_failure "Database error querying schema"
--  with nothing in the row that looks wrong. '' is not the same as NULL here.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token, email_change,
                        email_change_token_new, email_change_token_current,
                        phone_change, phone_change_token, reauthentication_token,
                        created_at, updated_at)
values
 ('00000000-0000-0000-0000-000000000000', 'dddddddd-a001-4ddd-8ddd-dddddddddddd',
  'authenticated', 'authenticated', 'owner@northwind.demo.invalid',
  extensions.crypt('NexusDemo!2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', '', '', '', '', '', now(), now()),
 ('00000000-0000-0000-0000-000000000000', 'dddddddd-a002-4ddd-8ddd-dddddddddddd',
  'authenticated', 'authenticated', 'manager@northwind.demo.invalid',
  extensions.crypt('NexusDemo!2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', '', '', '', '', '', now(), now()),
 ('00000000-0000-0000-0000-000000000000', 'dddddddd-a003-4ddd-8ddd-dddddddddddd',
  'authenticated', 'authenticated', 'sales@northwind.demo.invalid',
  extensions.crypt('NexusDemo!2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', '', '', '', '', '', now(), now())
on conflict (id) do update
   set email                      = excluded.email,
       encrypted_password         = excluded.encrypted_password,
       email_confirmed_at         = excluded.email_confirmed_at,
       raw_app_meta_data          = excluded.raw_app_meta_data,
       confirmation_token         = '',
       recovery_token             = '',
       email_change               = '',
       email_change_token_new     = '',
       email_change_token_current = '',
       phone_change               = '',
       phone_change_token         = '',
       reauthentication_token     = '',
       updated_at                 = now();

insert into auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at)
select gen_random_uuid(), u.id, 'email', u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email,
                          'email_verified', true, 'phone_verified', false),
       now(), now()
  from auth.users u
 where u.id in ('dddddddd-a001-4ddd-8ddd-dddddddddddd',
                'dddddddd-a002-4ddd-8ddd-dddddddddddd',
                'dddddddd-a003-4ddd-8ddd-dddddddddddd')
   and not exists (select 1 from auth.identities i
                    where i.user_id = u.id and i.provider = 'email');

insert into public.users (id, name, email, role, status, tenant_id, created_at) values
 ('dddddddd-0001-4ddd-8ddd-dddddddddddd', 'Dana Example (demo)',  'owner@northwind.demo.invalid',   'Owner',           'active', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', now() - interval '120 days'),
 ('dddddddd-0002-4ddd-8ddd-dddddddddddd', 'Omar Example (demo)',  'manager@northwind.demo.invalid', 'Sales Manager',   'active', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', now() - interval '118 days'),
 ('dddddddd-0003-4ddd-8ddd-dddddddddddd', 'Rita Example (demo)',  'sales@northwind.demo.invalid',   'Sales Executive', 'active', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', now() - interval '96 days');

insert into public.tenant_members (tenant_id, auth_user_id, role, staff_user_id) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'dddddddd-a001-4ddd-8ddd-dddddddddddd', 'owner',   'dddddddd-0001-4ddd-8ddd-dddddddddddd'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'dddddddd-a002-4ddd-8ddd-dddddddddddd', 'manager', 'dddddddd-0002-4ddd-8ddd-dddddddddddd'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'dddddddd-a003-4ddd-8ddd-dddddddddddd', 'sales',   'dddddddd-0003-4ddd-8ddd-dddddddddddd');

-- ────────────────────────────────────────────────────────────────────────────
-- 4 · THE DEALERSHIP'S OWN THRESHOLDS
--     Deliberately NOT the NEXUS defaults, so the Sentinel is measuring this
--     dealership against numbers it chose. holding_cost_per_day_aed is left
--     NULL on purpose — see the header.
-- ────────────────────────────────────────────────────────────────────────────
insert into public.inventory_profit_settings
  (tenant_id, holding_cost_per_day_aed, holding_cost_source, holding_cost_basis, holding_cost_set_by,
   aging_warn_days, aging_critical_days, promote_days, wholesale_days,
   min_reprice_margin_pct, market_tolerance_pct, enquiry_window_days, min_enquiry_sources,
   min_model_token_overlap, accepted_market_match_quality, market_max_age_days)
values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', null, null, null, null,
   75, 110, 60, 170, 9.00, 3.00, 30, 50, 2, array['exact','strong'], 14);

insert into public.inventory_action_policy
  (tenant_id, approver_tenant_roles, approver_staff_roles, reproposal_cooldown_days, set_by, note)
values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', array['owner','admin','manager'], array[]::text[], 14,
   'NEXUS demo seed',
   'Owner, admin and manager may approve an inventory action. A salesperson may not.');

-- ────────────────────────────────────────────────────────────────────────────
-- 5 · THE LOT — 29 units. 27 available, 2 sold.
--     `days` is days in stock TODAY; acquired_at is derived from it, so the
--     ageing story is the same however long after seeding the demo happens.
--     The derived columns below are exactly what recompute_inventory_derived()
--     would write for this tenant, with ONE deliberate difference recorded in
--     ops/DEMO.md: for DEMO-2130, whose acquisition cost was never recorded,
--     gross_margin is left NULL rather than being set to the full list price.
-- ────────────────────────────────────────────────────────────────────────────
insert into public.inventory
  (tenant_id, id, model, vin, status, acquired_at, days_in_stock,
   price_aed, cost_aed, gross_margin, vat_amount, holding_cost_accrued, net_margin,
   recommended_commission, aging_alert, ai_recommendation)
select 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
       s.id, s.model, s.vin, s.status,
       ((now() at time zone 'Asia/Dubai')::date - s.days),
       s.days,
       s.price, s.cost,
       case when s.price is null or s.cost is null then null else s.price - s.cost end,
       round(coalesce(s.price,0) * 0.05),
       null, null, null,
       case when lower(s.status) = 'sold' then 'HEALTHY'
            when s.days >= 110 then 'CRITICAL'
            when s.days >=  75 then 'WARNING'
            else 'HEALTHY' end,
       null
  from (values
    -- ── the nine units the engine flags ──────────────────────────────────
    ('DEMO-2101','Toyota Land Cruiser VXR 2022',      'DEMOVIN0000002101','Available',214, 279000, 268000),
    ('DEMO-2104','Land Rover Range Rover Vogue 2021', 'DEMOVIN0000002104','Available',187, 352000, 305000),
    ('DEMO-2107','Nissan Patrol LE 2022',             'DEMOVIN0000002107','Available',148, 262000, 232000),
    ('DEMO-2109','BMW X5 xDrive40i 2022',             'DEMOVIN0000002109','Available',121, 224000, 198000),
    ('DEMO-2112','Kia Sportage GT-Line 2023',         'DEMOVIN0000002112','Available', 96,  82500,  79000),
    ('DEMO-2115','Toyota Fortuner VXR 2023',          'DEMOVIN0000002115','Available',103, 158000, 141000),
    ('DEMO-2118','Hyundai Tucson Premium 2023',       'DEMOVIN0000002118','Available', 72,  79000,  71000),
    ('DEMO-2124','Ford Explorer ST 2022',             'DEMOVIN0000002124','Available', 41, 153500, 149000),
    -- the unit whose acquisition cost was never entered. The engine will
    -- name it and refuse to size it, which is the point of its being here.
    ('DEMO-2130','GMC Yukon Denali 2022',             'DEMOVIN0000002130','Available',132, 235000, null),
    -- ── nineteen units the engine is content with ────────────────────────
    ('DEMO-2002','Toyota Corolla 1.6 SE 2023',        'DEMOVIN0000002002','Available',  6,  58500,  52000),
    ('DEMO-2004','Nissan Sunny SV 2024',              'DEMOVIN0000002004','Available', 11,  47500,  42000),
    ('DEMO-2006','Honda Accord Sport 2023',           'DEMOVIN0000002006','Available', 15,  88000,  78000),
    ('DEMO-2008','Toyota Camry GLE 2023',             'DEMOVIN0000002008','Available', 19,  94500,  84000),
    ('DEMO-2010','Hyundai Elantra Smart 2024',        'DEMOVIN0000002010','Available', 23,  62000,  55000),
    ('DEMO-2012','Kia Seltos EX 2023',                'DEMOVIN0000002012','Available', 26,  74000,  66000),
    ('DEMO-2014','Mitsubishi Pajero GLS 2022',        'DEMOVIN0000002014','Available', 30, 121000, 108000),
    ('DEMO-2016','Toyota RAV4 XLE 2023',              'DEMOVIN0000002016','Available', 33, 108000,  96000),
    ('DEMO-2018','Nissan X-Trail SV 2023',            'DEMOVIN0000002018','Available', 37,  99000,  88000),
    ('DEMO-2020','Chevrolet Tahoe LT 2022',           'DEMOVIN0000002020','Available', 40, 193000, 172000),
    ('DEMO-2022','Lexus ES 300h 2022',                'DEMOVIN0000002022','Available', 44, 166000, 148000),
    ('DEMO-2026','Mercedes-Benz C200 AMG Line 2022',  'DEMOVIN0000002026','Available', 47, 189000, 168000),
    ('DEMO-2028','Audi Q5 45 TFSI 2022',              'DEMOVIN0000002028','Available', 50, 178000, 158000),
    ('DEMO-2032','Volkswagen Teramont SEL 2022',      'DEMOVIN0000002032','Available', 52, 133000, 118000),
    ('DEMO-2034','Jeep Grand Cherokee Limited 2022',  'DEMOVIN0000002034','Available', 54, 164000, 146000),
    ('DEMO-2036','Toyota Hilux Adventure 2023',       'DEMOVIN0000002036','Available', 56, 132000, 118000),
    ('DEMO-2038','Honda CR-V EX 2023',                'DEMOVIN0000002038','Available', 58, 103000,  92000),
    ('DEMO-2040','Suzuki Grand Vitara GLX 2023',      'DEMOVIN0000002040','Available', 12,  69500,  62000),
    -- ── two units that sold ──────────────────────────────────────────────
    ('DEMO-2050','Toyota Prado TXL 2022',             'DEMOVIN0000002050','Sold',      96, 199000, 178000),
    ('DEMO-2052','Nissan Kicks S 2023',               'DEMOVIN0000002052','Sold',      71,  55000,  48000)
  ) as s(id, model, vin, status, days, price, cost);

-- ────────────────────────────────────────────────────────────────────────────
-- 6 · THE ENQUIRIES — 24 leads.
--     Ids are in a reserved 9,000,00x band so they cannot collide with the
--     staging fixtures, and the sequence behind `leads` is deliberately not
--     advanced: nothing else on staging allocates ids up there.
-- ────────────────────────────────────────────────────────────────────────────
insert into public.leads
  (id, tenant_id, name, email, phone, source, vehicle_interest, budget_aed, status,
   ai_score, assigned_to_id, response_time_minutes, escalated_at, created_at)
select s.id, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', s.name, e.email, e.phone, s.source,
       s.vehicle, null, s.status, s.score,
       (case s.owner when 'manager' then 'dddddddd-0002-4ddd-8ddd-dddddddddddd'
                     when 'sales'   then 'dddddddd-0003-4ddd-8ddd-dddddddddddd'
                     else null end)::uuid,
       s.rt, null, now() - make_interval(days => s.age_days)
  from (values
   -- id,      name,                     local-part,  phone-tail, source,      vehicle interest,                        status,         score, owner,     response min, age days
   (9000001,'Faisal Example (demo)',  'faisal',  '01','WhatsApp', 'Toyota Prado TXL 2022',              'WON',          88,'manager',   4, 45),
   (9000002,'Noura Example (demo)',   'noura',   '02','Website',  'Nissan Kicks S 2023',                'WON',          74,'sales',     9, 38),
   (9000003,'Yusuf Example (demo)',   'yusuf',   '03','WhatsApp', 'Nissan Patrol LE 2022',              'WARM',         71,'sales',     7, 22),
   (9000004,'Hessa Example (demo)',   'hessa',   '04','Instagram','BMW X5 xDrive40i 2022',              'HOT',          92, null,    null, 12),
   (9000005,'Bilal Example (demo)',   'bilal',   '05','WhatsApp', 'Toyota Fortuner VXR 2023',           'WARM',         66,'sales',     3, 30),
   (9000006,'Mariam Example (demo)',  'mariam',  '06','Website',  'Mazda CX-5 GT 2023',                 'WARM',         58,'sales',    12,  9),
   (9000007,'Salem Example (demo)',   'salem',   '07','Facebook', 'Land Rover Range Rover Vogue 2021',  'WARM',         63,'manager',null,  5),
   (9000008,'Amina Example (demo)',   'amina',   '08','WhatsApp', 'Toyota Camry GLE 2023',              'WARM',         55,'sales',    41,  6),
   (9000009,'Karim Example (demo)',   'karim',   '09','Website',  'Toyota RAV4 XLE 2023',               'WARM',         61,'sales',    18,  3),
   (9000010,'Layla Example (demo)',   'layla',   '10','WhatsApp', 'Chevrolet Tahoe LT 2022',            'HOT',          84,'manager',  95, 11),
   (9000011,'Tariq Example (demo)',   'tariq',   '11','WhatsApp', 'Honda CR-V EX 2023',                 'WARM',         52,'sales',     5,  4),
   (9000012,'Sara Example (demo)',    'sara',    '12','Website',  'Hyundai Elantra Smart 2024',         'WARM',         49,'sales',     2,  8),
   (9000013,'Rashid Example (demo)',  'rashid',  '13','WhatsApp', 'Jeep Grand Cherokee Limited 2022',   'WARM',         57,'manager',   6, 14),
   (9000014,'Huda Example (demo)',    'huda',    '14','Facebook', 'Nissan Sunny SV 2024',               'DISQUALIFIED', 12, null,    null, 26),
   (9000015,'Majid Example (demo)',   'majid',   '15','WhatsApp', null,                                 'DISQUALIFIED',  8, null,    null, 33),
   (9000016,'Reem Example (demo)',    'reem',    '16','Website',  'Kia Seltos EX 2023',                 'DISQUALIFIED', 15, null,    null, 41),
   (9000017,'Zayed Example (demo)',   'zayed',   '17','WhatsApp', null,                                 'DISQUALIFIED',  6, null,    null, 47),
   (9000018,'Aisha Example (demo)',   'aisha',   '18','Instagram','Toyota Corolla 1.6 SE 2023',         'DISQUALIFIED', 19, null,    null, 52),
   (9000019,'Nabil Example (demo)',   'nabil',   '19','WhatsApp', null,                                 'DISQUALIFIED',  9, null,    null, 58),
   (9000020,'Dalia Example (demo)',   'dalia',   '20','Website',  'Audi Q5 45 TFSI 2022',               'DISQUALIFIED', 22, null,    null, 63),
   (9000021,'Hamad Example (demo)',   'hamad',   '21','WhatsApp', 'Mercedes-Benz C200 AMG Line 2022',   'LOST',         68,'sales',    22, 55),
   (9000022,'Salma Example (demo)',   'salma',   '22','Website',  'Lexus ES 300h 2022',                 'LOST',         64,'manager',  15, 61),
   (9000023,'Waleed Example (demo)',  'waleed',  '23','WhatsApp', 'Toyota Hilux Adventure 2023',        'LOST',         59,'sales',    31, 68),
   (9000024,'Fatima Example (demo)',  'fatima',  '24','Facebook', 'Volkswagen Teramont SEL 2022',       'LOST',         53,'sales',    11, 74)
  ) as s(id, name, localpart, tail, source, vehicle, status, score, owner, rt, age_days)
  cross join lateral (select s.localpart || '.example@northwind.demo.invalid' as email,
                             '+9715000000' || s.tail                       as phone) e;

-- ────────────────────────────────────────────────────────────────────────────
-- 7 · THE CONVERSATIONS
--     `external_message_id` is left NULL on every row, because that is what
--     NEXUS actually writes today. Filling it in would demonstrate a
--     capability the product does not have.
-- ────────────────────────────────────────────────────────────────────────────
insert into public.communication_logs (tenant_id, lead_email, channel, direction, message, sent_by, created_at)
select 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', m.addr, m.channel, m.direction, m.body, m.sent_by,
       now() - make_interval(hours => m.hours_ago)
  from (values
   -- the two that bought
   ('faisal.example@northwind.demo.invalid','whatsapp','inbound', 'Is the Prado still available?',                                        'customer',        1080),
   ('faisal.example@northwind.demo.invalid','whatsapp','outbound','Yes — the Prado TXL is on the floor. Would Thursday morning suit you?', 'Omar Example (demo)',1076),
   ('faisal.example@northwind.demo.invalid','whatsapp','inbound', 'Thursday works. See you then.',                                         'customer',        1070),
   ('noura.example@northwind.demo.invalid','email','inbound',   'Interested in the Kicks — what is the best price?',                       'customer',         912),
   ('noura.example@northwind.demo.invalid','email','outbound',  'Sending you the figures now.',                                            'Rita Example (demo)',903),
   -- L3 Yusuf: replied eight days ago and nobody has answered
   ('yusuf.example@northwind.demo.invalid','whatsapp','inbound', 'Looking at the Patrol LE. Can you do a trade-in on my current car?',     'customer',         504),
   ('yusuf.example@northwind.demo.invalid','whatsapp','outbound','We can look at a trade-in. What is the car and the mileage?',            'Rita Example (demo)',500),
   ('yusuf.example@northwind.demo.invalid','whatsapp','inbound', '2019 Pajero, 96,000 km. What would you give me for it?',                 'customer',         192),
   -- L4 Hessa: one enquiry, eleven days ago, nobody owns it
   ('hessa.example@northwind.demo.invalid','email','inbound',    'Do you have the X5 in white? Ready to buy this month.',                  'customer',         264),
   -- L5 Bilal: we spoke last, five days ago, past the stale threshold
   ('bilal.example@northwind.demo.invalid','whatsapp','inbound', 'What is the price on the Fortuner VXR?',                                 'customer',         480),
   ('bilal.example@northwind.demo.invalid','whatsapp','outbound','AED 158,000. Happy to arrange a viewing.',                               'Rita Example (demo)',476),
   ('bilal.example@northwind.demo.invalid','whatsapp','inbound', 'Let me speak to my wife and come back to you.',                          'customer',         146),
   ('bilal.example@northwind.demo.invalid','whatsapp','outbound','Of course — shall I hold it until the weekend?',                         'Rita Example (demo)',122),
   -- L6 Mariam: we spoke last, thirty hours ago
   ('mariam.example@northwind.demo.invalid','email','inbound',   'Is the CX-5 still on the lot?',                                          'customer',          74),
   ('mariam.example@northwind.demo.invalid','email','outbound',  'It is. Would you like to book a test drive?',                            'Rita Example (demo)', 30),
   -- L8..L13: live conversations, we answered inside the threshold
   ('amina.example@northwind.demo.invalid','whatsapp','inbound', 'Can I see the Camry on Saturday?',                                       'customer',           9),
   ('amina.example@northwind.demo.invalid','whatsapp','outbound','Saturday is fine. 11am?',                                                'Rita Example (demo)',  6),
   ('karim.example@northwind.demo.invalid','email','inbound',    'What is the service history on the RAV4?',                               'customer',           8),
   ('karim.example@northwind.demo.invalid','email','outbound',   'Full agency history. I will send the book.',                             'Rita Example (demo)',  5),
   ('layla.example@northwind.demo.invalid','whatsapp','inbound', 'Still thinking about the Tahoe.',                                        'customer',          10),
   ('layla.example@northwind.demo.invalid','whatsapp','outbound','No rush — it is here when you are ready.',                               'Omar Example (demo)',  7),
   ('tariq.example@northwind.demo.invalid','whatsapp','inbound', 'Does the CR-V come with a warranty?',                                    'customer',           7),
   ('tariq.example@northwind.demo.invalid','whatsapp','outbound','Six months, and we can extend it.',                                      'Rita Example (demo)',  4),
   ('sara.example@northwind.demo.invalid','email','inbound',     'Can you hold the Elantra until Friday?',                                 'customer',           6),
   ('sara.example@northwind.demo.invalid','email','outbound',    'Held until Friday 6pm.',                                                 'Rita Example (demo)',  3),
   ('rashid.example@northwind.demo.invalid','whatsapp','inbound','Do you take bank finance on the Grand Cherokee?',                        'customer',           5),
   ('rashid.example@northwind.demo.invalid','whatsapp','outbound','We work with most of the banks. Let us talk it through.',               'Omar Example (demo)',  2),
   -- two of the closed enquiries had conversations before they closed
   ('hamad.example@northwind.demo.invalid','whatsapp','inbound', 'Is the C200 negotiable?',                                                'customer',        1320),
   ('hamad.example@northwind.demo.invalid','whatsapp','outbound','There is a little room. Come and see it.',                               'Rita Example (demo)',1316),
   ('salma.example@northwind.demo.invalid','email','inbound',    'What is the mileage on the ES 300h?',                                    'customer',        1464),
   ('salma.example@northwind.demo.invalid','email','outbound',   '41,000 km, one owner.',                                                  'Omar Example (demo)',1460),
   -- three WhatsApp threads that resolve to nobody at all. Real dealerships
   -- have these; NEXUS refuses to call them customers.
   ('971500000091@c.us','whatsapp','inbound','Hi, price?',                                                                                 'customer',          52),
   ('971500000091@c.us','whatsapp','inbound','Hello?',                                                                                     'customer',          49),
   ('971500000092@c.us','whatsapp','inbound','Do you buy cars as well?',                                                                   'customer',          31),
   ('971500000092@c.us','whatsapp','inbound','I have a 2018 Sonata',                                                                       'customer',          30),
   ('971500000093@c.us','whatsapp','inbound','Salam, is the showroom open Friday?',                                                        'customer',          19),
   ('971500000093@c.us','whatsapp','inbound','?',                                                                                          'customer',          17)
  ) as m(addr, channel, direction, body, sent_by, hours_ago);

insert into public.whatsapp_contacts (tenant_id, chat_id, phone, push_name, lead_email, first_seen, last_seen, message_count)
values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','971500000091@c.us','971500000091','WhatsApp contact 91 (demo, unidentified)', null, now() - interval '52 hours', now() - interval '49 hours', 2),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','971500000092@c.us','971500000092','WhatsApp contact 92 (demo, unidentified)', null, now() - interval '31 hours', now() - interval '30 hours', 2),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','971500000093@c.us','971500000093','WhatsApp contact 93 (demo, unidentified)', null, now() - interval '19 hours', now() - interval '17 hours', 2);

-- ────────────────────────────────────────────────────────────────────────────
-- 8 · THE TWO SALES. Confirmed revenue, and NEXUS is credited with none of it.
-- ────────────────────────────────────────────────────────────────────────────
insert into public.purchase_history
  (id, tenant_id, customer_name, email, phone, vehicle, purchase_date, amount_aed, deal_id, lead_id, created_at)
values
 ('dddddddd-9501-4ddd-8ddd-dddddddddddd','dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'Faisal Example (demo)','faisal.example@northwind.demo.invalid','+971500000001',
  'Toyota Prado TXL 2022', ((now() at time zone 'Asia/Dubai')::date - 12), 199000,
  'demo:9000001|prado', 9000001, now() - interval '12 days'),
 ('dddddddd-9502-4ddd-8ddd-dddddddddddd','dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'Noura Example (demo)','noura.example@northwind.demo.invalid','+971500000002',
  'Nissan Kicks S 2023', ((now() at time zone 'Asia/Dubai')::date - 5), 55000,
  'demo:9000002|kicks', 9000002, now() - interval '5 days');

-- ────────────────────────────────────────────────────────────────────────────
-- 9 · THE MARKET, such as it is.
--     Nine competitor listings, not one of which meets the match quality this
--     dealership accepts (exact or strong, no older than 14 days). The engine
--     will grade every unit UNKNOWN and refuse to name a price. That refusal
--     is the demo, not a hole in it.
-- ────────────────────────────────────────────────────────────────────────────
insert into public.competitors
  (tenant_id, competitor, model, price_aed, our_price_aed, price_diff_aed, ai_recommendation,
   scraped_at, listing_title, source_host, source_kind, offer_condition, match_quality, match_note)
select 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', c.competitor, c.model, c.price, c.ours,
       c.price - c.ours, c.rec, now() - make_interval(days => c.days_ago),
       c.model || ' — listing (demo)', 'listings.example.invalid', 'marketplace',
       'used', c.q, c.note
  from (values
   ('Example Motors LLC (demo)',   'Nissan Patrol LE 2022',            251000, 262000, 3,
    'weak','Model name matches; trim, mileage and condition do not appear on the page.',
    'NO CONCLUSION: nothing on the page ties this price to our unit.'),
   ('Sample Auto Trading (demo)',  'BMW X5 xDrive40i 2022',            219000, 224000, 2,
    'model_only','Only the model name was captured. No trim, no year confirmation, no mileage.',
    'NO CONCLUSION: nothing on the page ties this price to our unit.'),
   ('Placeholder Cars FZE (demo)', 'Toyota Fortuner VXR 2023',         161000, 158000, 4,
    'weak','Model matches; the listing is a dealer page with no VIN and no mileage.',
    'NO CONCLUSION: nothing on the page ties this price to our unit.'),
   ('Example Motors LLC (demo)',   'Toyota Camry GLE 2023',             91000,  94500, 6,
    null,'The scraper recorded no match quality at all for this row.',
    'NO CONCLUSION: nothing on the page ties this price to our unit.'),
   ('Sample Auto Trading (demo)',  'Mitsubishi Pajero GLS 2022',       118000, 121000, 5,
    'weak','Model matches; condition unknown.',
    'NO CONCLUSION: nothing on the page ties this price to our unit.'),
   ('Placeholder Cars FZE (demo)', 'Lexus ES 300h 2022',               172000, 166000, 8,
    'model_only','Manufacturer model page, not a specific car.',
    'NO CONCLUSION: nothing on the page ties this price to our unit.'),
   ('Example Motors LLC (demo)',   'Toyota Land Cruiser VXR 2022',     272000, 279000, 25,
    'strong','Same trim and a comparable mileage band — but captured 25 days ago.',
    'NO CONCLUSION: the only comparable for this model is older than the 14-day freshness window.'),
   ('Sample Auto Trading (demo)',  'Land Rover Range Rover Vogue 2021',344000, 352000, 9,
    'weak','Model matches; service history and condition not stated.',
    'NO CONCLUSION: nothing on the page ties this price to our unit.'),
   ('Example Motors LLC (demo)',   'Kia Sportage GT-Line 2023',         80500,  82500, 7,
    'model_only','Only the model name was captured.',
    'NO CONCLUSION: nothing on the page ties this price to our unit.')
  ) as c(competitor, model, price, ours, days_ago, q, note, rec);

-- ────────────────────────────────────────────────────────────────────────────
-- 10 · THE ACTION LANE — five records, five different shapes of stuck.
--      Every engine_* column is copied from the engine's OWN output for that
--      unit, so nothing here is a hand-written finding. `engine_days_in_stock`
--      is wound back to the day the action was raised, because that is the
--      snapshot the record froze.
-- ────────────────────────────────────────────────────────────────────────────
insert into public.inventory_actions
  (id, tenant_id, unit_id, recommendation,
   engine_reason, engine_confidence, engine_confidence_basis,
   engine_impact_aed, engine_impact_kind, engine_impact_basis,
   engine_overall_risk, engine_days_in_stock, engine_gross_margin_aed,
   engine_owner_role, engine_evidence, engine_computed_at,
   status, proposed_at, proposed_by_staff_id, proposed_source,
   decided_at, decided_by_staff_id, decided_by_auth_id, decided_by_authority,
   decision_reason_code, decision_note, defer_until,
   assigned_to_staff_id, assigned_role, assigned_at,
   executed_at, executed_by_staff_id, execution_note, execution_failure,
   outcome_state)
select a.id::uuid, v.tenant_id, v.id, v.recommendation,
       v.reason, v.confidence, v.confidence_basis,
       v.impact_aed, v.impact_kind, v.impact_basis,
       v.overall_risk, v.days_in_stock - a.raised_days_ago, v.gross_margin_aed,
       v.suggested_owner_role, v.evidence, now() - make_interval(days => a.raised_days_ago),
       a.status,
       now() - make_interval(days => a.raised_days_ago),
       a.proposed_by::uuid, 'HUMAN_FROM_ENGINE_QUEUE',
       case when a.decided_days_ago is null then null else now() - make_interval(days => a.decided_days_ago) end,
       a.decided_by::uuid, a.decided_auth::uuid, a.authority,
       a.reason_code, a.note,
       case when a.defer_days_ago is null then null
            else ((now() at time zone 'Asia/Dubai')::date - a.defer_days_ago) end,
       null,
       a.assigned_role,
       case when a.assigned_role is null then null else now() - make_interval(days => coalesce(a.decided_days_ago, a.raised_days_ago)) end,
       case when a.executed_days_ago is null then null else now() - make_interval(days => a.executed_days_ago) end,
       a.executed_by::uuid, a.exec_note, a.exec_failure,
       'NONE_YET'
  from (values
   -- APPROVED six days ago, nothing recorded as done since. The largest
   -- exposure on the lot, and the leak is the gap between the decision and
   -- the act.
   ('dddddddd-ac01-4ddd-8ddd-dddddddddddd','DEMO-2104','APPROVED', 6, 5, 'TENANT_OWNER',
    'dddddddd-0002-4ddd-8ddd-dddddddddddd','dddddddd-0001-4ddd-8ddd-dddddddddddd','dddddddd-a001-4ddd-8ddd-dddddddddddd',
    null, null, null, 'Sales Manager', null, null, null, null),
   -- Attempted and it did not happen — with a reason a person can act on.
   ('dddddddd-ac02-4ddd-8ddd-dddddddddddd','DEMO-2107','EXECUTION_FAILED', 9, 8, 'TENANT_OWNER',
    'dddddddd-0002-4ddd-8ddd-dddddddddddd','dddddddd-0001-4ddd-8ddd-dddddddddddd','dddddddd-a001-4ddd-8ddd-dddddddddddd',
    null, null, null, 'Sales Manager', 2, 'dddddddd-0002-4ddd-8ddd-dddddddddddd',
    'Tried to drop the asking price on the portal.',
    'The marketplace feed rejected the price change: the listing is locked until the next nightly sync.'),
   -- A person read the engine, disagreed, and recorded why. This is NOT a
   -- leak and Today''s Money Leaks says so out loud.
   ('dddddddd-ac03-4ddd-8ddd-dddddddddddd','DEMO-2112','REJECTED', 7, 7, 'TENANT_OWNER',
    'dddddddd-0002-4ddd-8ddd-dddddddddddd','dddddddd-0001-4ddd-8ddd-dddddddddddd','dddddddd-a001-4ddd-8ddd-dddddddddddd',
    'PRICE_IS_CORRECT',
    'Priced at the floor already. The margin is thin because we paid too much at auction, not because the price is wrong.',
    null, null, null, null, null, null),
   -- Raised three days ago and nobody has said yes or no. THIS is the one the
   -- demo approves live.
   ('dddddddd-ac04-4ddd-8ddd-dddddddddddd','DEMO-2115','PROPOSED', 3, null, null,
    'dddddddd-0002-4ddd-8ddd-dddddddddddd', null, null,
    null, null, null, null, null, null, null, null),
   -- Deferred with a date on it, and the date has passed.
   ('dddddddd-ac05-4ddd-8ddd-dddddddddddd','DEMO-2101','DEFERRED', 21, 20, 'TENANT_OWNER',
    'dddddddd-0002-4ddd-8ddd-dddddddddddd','dddddddd-0001-4ddd-8ddd-dddddddddddd','dddddddd-a001-4ddd-8ddd-dddddddddddd',
    'WAITING_ON_MARKET',
    'Held until the auction results for this model come in.',
    4, null, null, null, null, null)
  ) as a(id, unit_id, status, raised_days_ago, decided_days_ago, authority,
         proposed_by, decided_by, decided_auth,
         reason_code, note, defer_days_ago, assigned_role,
         executed_days_ago, executed_by, exec_note, exec_failure)
  join public.v_inventory_profit_sentinel v
    on v.tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' and v.id = a.unit_id;

-- ────────────────────────────────────────────────────────────────────────────
-- 11 · THE AUDIT TRAIL behind those five records.
--      audit_log rows are written directly rather than through
--      action_write_audit() because a seed has to control `logged_at`; the
--      summary is written in the same shape that function produces, so the
--      timeline renders identically to a real one.
-- ────────────────────────────────────────────────────────────────────────────
insert into public.audit_log (id, tenant_id, workflow, status, summary, logged_at)
select e.audit_id::uuid, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
       'Inventory Action Center', e.audit_status,
       'Inventory action ' || e.action_id || ' · unit ' || e.unit_id || ' · ' || e.rec || ' · ' || e.summary,
       now() - make_interval(days => e.days_ago)
  from (values
   ('dddddddd-e001-4ddd-8ddd-dddddddddddd','dddddddd-ac01-4ddd-8ddd-dddddddddddd','DEMO-2104','MANAGER_REVIEW','SUCCESS', 6,'Proposed from the engine by Omar Example (demo). Exposure at proposal: AED 47,000 (MARGIN_EXPOSED). Awaiting a decision.'),
   ('dddddddd-e002-4ddd-8ddd-dddddddddddd','dddddddd-ac01-4ddd-8ddd-dddddddddddd','DEMO-2104','MANAGER_REVIEW','SUCCESS', 5,'APPROVED by Dana Example (demo), acting as TENANT_OWNER. Assigned to the Sales Manager role and to nobody by name.'),
   ('dddddddd-e003-4ddd-8ddd-dddddddddddd','dddddddd-ac02-4ddd-8ddd-dddddddddddd','DEMO-2107','REPRICE','SUCCESS', 9,'Proposed from the engine by Omar Example (demo). Exposure at proposal: AED 30,000 (MARGIN_EXPOSED). Awaiting a decision.'),
   ('dddddddd-e004-4ddd-8ddd-dddddddddddd','dddddddd-ac02-4ddd-8ddd-dddddddddddd','DEMO-2107','REPRICE','SUCCESS', 8,'APPROVED by Dana Example (demo), acting as TENANT_OWNER.'),
   ('dddddddd-e005-4ddd-8ddd-dddddddddddd','dddddddd-ac02-4ddd-8ddd-dddddddddddd','DEMO-2107','REPRICE','FAILED',   2,'Execution recorded as NOT carried out by Omar Example (demo): the marketplace feed rejected the price change.'),
   ('dddddddd-e006-4ddd-8ddd-dddddddddddd','dddddddd-ac03-4ddd-8ddd-dddddddddddd','DEMO-2112','INSPECT','SUCCESS',  7,'Proposed from the engine by Omar Example (demo). Exposure at proposal: AED 3,500 (MARGIN_EXPOSED). Awaiting a decision.'),
   ('dddddddd-e007-4ddd-8ddd-dddddddddddd','dddddddd-ac03-4ddd-8ddd-dddddddddddd','DEMO-2112','INSPECT','SUCCESS',  7,'REJECTED by Dana Example (demo), acting as TENANT_OWNER. Reason PRICE_IS_CORRECT — the decision records that the engine was wrong.'),
   ('dddddddd-e008-4ddd-8ddd-dddddddddddd','dddddddd-ac04-4ddd-8ddd-dddddddddddd','DEMO-2115','REPRICE','SUCCESS',  3,'Proposed from the engine by Omar Example (demo). Exposure at proposal: AED 17,000 (MARGIN_EXPOSED). Awaiting a decision.'),
   ('dddddddd-e009-4ddd-8ddd-dddddddddddd','dddddddd-ac05-4ddd-8ddd-dddddddddddd','DEMO-2101','WHOLESALE','SUCCESS',21,'Proposed from the engine by Omar Example (demo). Exposure at proposal: AED 11,000 (MARGIN_EXPOSED). Awaiting a decision.'),
   ('dddddddd-e010-4ddd-8ddd-dddddddddddd','dddddddd-ac05-4ddd-8ddd-dddddddddddd','DEMO-2101','WHOLESALE','SUCCESS',20,'DEFERRED by Dana Example (demo), acting as TENANT_OWNER, until the auction results arrive. Reason WAITING_ON_MARKET.')
  ) as e(audit_id, action_id, unit_id, rec, audit_status, days_ago, summary);

insert into public.inventory_action_events
  (tenant_id, action_id, at, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
select 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', e.action_id::uuid,
       now() - make_interval(days => e.days_ago), e.event,
       e.staff::uuid, e.auth_uid::uuid, e.authority, e.detail, e.audit_id::uuid
  from (values
   ('dddddddd-ac01-4ddd-8ddd-dddddddddddd', 6,'PROPOSED','dddddddd-0002-4ddd-8ddd-dddddddddddd','dddddddd-a002-4ddd-8ddd-dddddddddddd',null,'Raised from the engine queue.','dddddddd-e001-4ddd-8ddd-dddddddddddd'),
   ('dddddddd-ac01-4ddd-8ddd-dddddddddddd', 5,'APPROVED','dddddddd-0001-4ddd-8ddd-dddddddddddd','dddddddd-a001-4ddd-8ddd-dddddddddddd','TENANT_OWNER','Approved and assigned to the Sales Manager role.','dddddddd-e002-4ddd-8ddd-dddddddddddd'),
   ('dddddddd-ac02-4ddd-8ddd-dddddddddddd', 9,'PROPOSED','dddddddd-0002-4ddd-8ddd-dddddddddddd','dddddddd-a002-4ddd-8ddd-dddddddddddd',null,'Raised from the engine queue.','dddddddd-e003-4ddd-8ddd-dddddddddddd'),
   ('dddddddd-ac02-4ddd-8ddd-dddddddddddd', 8,'APPROVED','dddddddd-0001-4ddd-8ddd-dddddddddddd','dddddddd-a001-4ddd-8ddd-dddddddddddd','TENANT_OWNER','Approved for a price move.','dddddddd-e004-4ddd-8ddd-dddddddddddd'),
   ('dddddddd-ac02-4ddd-8ddd-dddddddddddd', 2,'EXECUTION_FAILED','dddddddd-0002-4ddd-8ddd-dddddddddddd','dddddddd-a002-4ddd-8ddd-dddddddddddd',null,'The marketplace feed rejected the price change: the listing is locked until the next nightly sync.','dddddddd-e005-4ddd-8ddd-dddddddddddd'),
   ('dddddddd-ac03-4ddd-8ddd-dddddddddddd', 7,'PROPOSED','dddddddd-0002-4ddd-8ddd-dddddddddddd','dddddddd-a002-4ddd-8ddd-dddddddddddd',null,'Raised from the engine queue.','dddddddd-e006-4ddd-8ddd-dddddddddddd'),
   ('dddddddd-ac03-4ddd-8ddd-dddddddddddd', 7,'REJECTED','dddddddd-0001-4ddd-8ddd-dddddddddddd','dddddddd-a001-4ddd-8ddd-dddddddddddd','TENANT_OWNER','Rejected: PRICE_IS_CORRECT.','dddddddd-e007-4ddd-8ddd-dddddddddddd'),
   ('dddddddd-ac04-4ddd-8ddd-dddddddddddd', 3,'PROPOSED','dddddddd-0002-4ddd-8ddd-dddddddddddd','dddddddd-a002-4ddd-8ddd-dddddddddddd',null,'Raised from the engine queue.','dddddddd-e008-4ddd-8ddd-dddddddddddd'),
   ('dddddddd-ac05-4ddd-8ddd-dddddddddddd',21,'PROPOSED','dddddddd-0002-4ddd-8ddd-dddddddddddd','dddddddd-a002-4ddd-8ddd-dddddddddddd',null,'Raised from the engine queue.','dddddddd-e009-4ddd-8ddd-dddddddddddd'),
   ('dddddddd-ac05-4ddd-8ddd-dddddddddddd',20,'DEFERRED','dddddddd-0001-4ddd-8ddd-dddddddddddd','dddddddd-a001-4ddd-8ddd-dddddddddddd','TENANT_OWNER','Deferred pending auction results.','dddddddd-e010-4ddd-8ddd-dddddddddddd')
  ) as e(action_id, days_ago, event, staff, auth_uid, authority, detail, audit_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 12 · WHAT WAS WRITTEN
-- ────────────────────────────────────────────────────────────────────────────
select 'seeded' as result, t, n from (
  select 'tenants' t, count(*) n from public.tenants where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  union all select 'users',                    count(*) from public.users                   where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  union all select 'tenant_members',           count(*) from public.tenant_members          where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  union all select 'inventory',                count(*) from public.inventory               where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  union all select 'leads',                    count(*) from public.leads                   where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  union all select 'communication_logs',       count(*) from public.communication_logs      where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  union all select 'whatsapp_contacts',        count(*) from public.whatsapp_contacts       where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  union all select 'competitors',              count(*) from public.competitors             where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  union all select 'purchase_history',         count(*) from public.purchase_history        where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  union all select 'inventory_actions',        count(*) from public.inventory_actions       where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  union all select 'inventory_action_events',  count(*) from public.inventory_action_events where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  union all select 'audit_log',                count(*) from public.audit_log               where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
) x order by t;

commit;
