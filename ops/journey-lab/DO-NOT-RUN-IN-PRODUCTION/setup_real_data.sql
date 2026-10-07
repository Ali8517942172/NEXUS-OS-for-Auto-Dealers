-- ============================================================
-- PRODUCTION DESTRUCTIVE — FORBIDDEN
-- ============================================================
-- This file contains `drop table ... cascade` on leads and inventory with no
-- project guard and no tenant predicate. DDL is not stopped by the NX900/NX950
-- delete guards — a trigger cannot refuse a DROP.
-- It is kept only as historical evidence of what was once run.
-- DO NOT EXECUTE. DO NOT PASTE INTO A SQL EDITOR.
-- Production is dsvuoovivysszdoiorch (Tenant A). Staging is wwspuxrbiyagnrnzgate.
-- ============================================================
-- ===== ENABLE EXTENSIONS =====
create extension if not exists vector;

-- ===== LEADS TABLE =====
drop table if exists leads cascade;
create table leads (
  id serial primary key,
  name text not null,
  email text,
  phone text,
  source text,
  vehicle_interest text,
  budget_aed integer,
  status text,
  ai_score integer,
  assigned_to text,
  response_time_minutes integer,
  created_at timestamptz default now()
);

insert into leads (name, email, phone, source, vehicle_interest, budget_aed, status, ai_score, assigned_to, response_time_minutes, created_at) values
('Mohammed Al Rashid', 'mohammed.rashid@gmail.com', '+971501234567', 'Website Form', 'Toyota Land Cruiser 2024', 290000, 'HOT', 92, 'Mohammed A.', 4, now() - interval '2 hours'),
('Sarah Chen', 'sarah.chen88@gmail.com', '+971559876543', 'WhatsApp', 'Lexus LX 600 2024', 510000, 'HOT', 88, 'Sarah K.', 6, now() - interval '5 hours'),
('Ahmed Al Maktoum', 'ahmed.maktoum@outlook.com', '+971521112233', 'Dubizzle', 'Nissan Patrol V8 2024', 300000, 'HOT', 85, 'Mohammed A.', 12, now() - interval '1 day'),
('Fatima Hassan', 'fatima.h@yahoo.com', '+971505556677', 'Instagram Ad', 'Lexus LX 600 2024', 495000, 'WARM', 74, 'Sarah K.', 45, now() - interval '1 day'),
('Ali Hassan', 'ali.hassan@gmail.com', '+971525550001', 'Facebook Lead Ad', 'Nissan Patrol 2024', 200000, 'COLD', 38, null, 187, now() - interval '3 days'),
('Rashid Al Nuaimi', 'rashid.nuaimi@gmail.com', '+971544445566', 'Walk-in', 'Porsche Cayenne S 2023', 380000, 'HOT', 90, 'Khalid R.', 8, now() - interval '6 hours'),
('Sara Al Ali', 'sara.alali@gmail.com', '+971556667788', 'Google Ads', 'BMW X5 2024', 340000, 'WARM', 68, 'Sarah K.', 65, now() - interval '2 days'),
('Yousef Ibrahim', 'yousef.ib@hotmail.com', '+971502223344', 'Website Form', 'Toyota Land Cruiser 2024', 285000, 'COLD', 41, null, 210, now() - interval '4 days'),
('Layla Mansour', 'layla.mansour@gmail.com', '+971569998877', 'WhatsApp', 'Range Rover Sport 2024', 420000, 'HOT', 87, 'Khalid R.', 5, now() - interval '3 hours'),
('Omar Al Farsi', 'omar.farsi@gmail.com', '+971533334455', 'Dubizzle', 'Nissan Patrol V8 2024', 310000, 'WARM', 70, 'Mohammed A.', 52, now() - interval '2 days'),
('Noura Al Shamsi', 'noura.shamsi@outlook.com', '+971541237890', 'Instagram Ad', 'Porsche Cayenne S 2023', 375000, 'COLD', 35, null, 240, now() - interval '5 days'),
('Khalid Al Zaabi', 'khalid.zaabi@gmail.com', '+971567891234', 'Referral', 'Lexus LX 600 2024', 505000, 'HOT', 95, 'Sarah K.', 3, now() - interval '1 hour'),
('Mariam Al Kaabi', 'mariam.kaabi@gmail.com', '+971529998811', 'Website Form', 'BMW X5 2024', 335000, 'WARM', 66, 'Khalid R.', 58, now() - interval '3 days'),
('Hamdan Al Suwaidi', 'hamdan.suwaidi@gmail.com', '+971558887766', 'Walk-in', 'Range Rover Sport 2024', 415000, 'HOT', 91, 'Mohammed A.', 7, now() - interval '4 hours'),
('Aisha Al Mheiri', 'aisha.mheiri@gmail.com', '+971512223334', 'Google Ads', 'Toyota Land Cruiser 2024', 295000, 'COLD', 44, null, 198, now() - interval '6 days');

-- ===== INVENTORY TABLE =====
drop table if exists inventory cascade;
create table inventory (
  id text primary key,
  model text not null,
  vin text,
  status text,
  days_in_stock integer,
  price_aed integer,
  cost_aed integer,
  gross_margin integer,
  holding_cost_accrued integer,
  net_margin integer,
  recommended_commission integer,
  vat_amount integer,
  aging_alert text,
  ai_recommendation text
);

insert into inventory (id, model, vin, status, days_in_stock, price_aed, cost_aed, gross_margin, holding_cost_accrued, net_margin, recommended_commission, vat_amount, aging_alert, ai_recommendation) values
('VH-001', 'Toyota Land Cruiser 2024', 'JTMHV05J584123456', 'Available', 83, 290000, 250000, 40000, 4150, 35850, 1793, 14500, 'WARNING', 'Approaching 90-day threshold. Consider targeted WhatsApp campaign.'),
('VH-002', 'Lexus LX 600 2024', 'JTJAM7FX4N4123456', 'Reserved', 12, 510000, 430000, 80000, 600, 79400, 3970, 25500, 'HEALTHY', 'High-margin vehicle. Priority delivery to retain customer.'),
('VH-003', 'Porsche Cayenne S 2023', 'WP1ZZZ9YZPDA12345', 'Available', 147, 380000, 310000, 70000, 7350, 62650, 3133, 19000, 'CRITICAL', 'Reduce price by AED 17,000 or launch clearance campaign immediately.'),
('VH-004', 'Nissan Patrol V8 2024', 'JN1TANY62Z0123456', 'Available', 156, 300000, 245000, 55000, 7800, 47200, 2360, 15000, 'CRITICAL', 'Dead stock risk. Bundle with finance offer or auction to trade.'),
('VH-005', 'Range Rover Sport 2024', 'SALWA2AE4PA123456', 'Available', 34, 420000, 355000, 65000, 1700, 63300, 3165, 21000, 'HEALTHY', 'Within normal aging window. No action needed.'),
('VH-006', 'BMW X5 2024', 'WBAJA9C05LC123456', 'Available', 121, 335000, 280000, 55000, 6050, 48950, 2448, 16750, 'CRITICAL', 'Exceeded 120-day threshold. Immediate price review required.'),
('VH-007', 'Mercedes GLE 450 2024', 'W1N1671X0PA123456', 'Sold', 45, 360000, 300000, 60000, 2250, 57750, 2888, 18000, 'HEALTHY', 'Sold — awaiting delivery handover.'),
('VH-008', 'Toyota Fortuner 2024', 'MHFXX8GD5P0123456', 'Available', 97, 175000, 148000, 27000, 4850, 22150, 1108, 8750, 'WARNING', 'Approaching aging threshold. Promote via Dubizzle listing refresh.'),
('VH-009', 'Lexus GX 550 2024', 'JTJHY7AX0P4123456', 'Available', 19, 385000, 325000, 60000, 950, 59050, 2953, 19250, 'HEALTHY', 'Recently stocked. High demand model, monitor only.'),
('VH-010', 'Nissan Patrol Nismo 2023', 'JN1TBNY62Z0198765', 'Available', 189, 340000, 275000, 65000, 9450, 55550, 2778, 17000, 'CRITICAL', 'Over 180 days — recommend auction or wholesale to clear holding costs.'),
('VH-011', 'Porsche Macan 2024', 'WP1AA2A50PLB12345', 'Reserved', 8, 265000, 220000, 45000, 400, 44600, 2230, 13250, 'HEALTHY', 'Reserved — finalize finance approval to close.'),
('VH-012', 'Toyota Land Cruiser GR Sport 2024', 'JTMHV05J584199887', 'Available', 61, 335000, 285000, 50000, 3050, 46950, 2348, 16750, 'HEALTHY', 'Within normal window. Feature in weekend promo.');

-- ===== COMPETITOR INTELLIGENCE TABLE =====
drop table if exists competitors cascade;
create table competitors (
  id serial primary key,
  competitor text not null,
  model text,
  price_aed integer,
  our_price_aed integer,
  price_diff_aed integer,
  ai_recommendation text,
  scraped_at timestamptz default now()
);

insert into competitors (competitor, model, price_aed, our_price_aed, price_diff_aed, ai_recommendation, scraped_at) values
('Al Futtaim Toyota', 'Toyota Land Cruiser 2024', 285000, 290000, -5000, 'Al Futtaim dropped price by AED 5,000. Match or emphasize free warranty extension to justify premium.', now() - interval '1 day'),
('Arabian Automobiles (Nissan)', 'Nissan Patrol V8 2024', 305000, 300000, 5000, 'We are AED 5,000 cheaper — highlight in ad copy this week.', now() - interval '1 day'),
('Al Futtaim Lexus', 'Lexus LX 600 2024', 520000, 510000, 10000, 'We remain competitive. No action needed.', now() - interval '2 days'),
('Gargash Enterprises (Mercedes)', 'Mercedes GLE 450 2024', 355000, 360000, -5000, 'Gargash undercutting by AED 5,000. Consider accessory bundle instead of price cut.', now() - interval '2 days'),
('AGMC (BMW)', 'BMW X5 2024', 330000, 335000, -5000, 'AGMC pricing AED 5,000 lower. Our unit has 121 days aging — prioritize matching this price.', now() - interval '1 day'),
('Al Futtaim Toyota', 'Toyota Fortuner 2024', 178000, 175000, 3000, 'We are cheaper by AED 3,000 — good position, no change needed.', now() - interval '3 days'),
('Arabian Automobiles (Nissan)', 'Nissan Patrol Nismo 2023', 328000, 340000, -12000, 'Competitor 12K cheaper on same model year — this unit is 189 days aged, urgent price match recommended.', now() - interval '1 day'),
('Premier Motors (Porsche)', 'Porsche Cayenne S 2023', 365000, 380000, -15000, 'Premier Motors pricing 15K below ours on aging 147-day unit. High priority price action.', now() - interval '12 hours'),
('Al Futtaim Lexus', 'Lexus GX 550 2024', 390000, 385000, 5000, 'We are competitively priced. Monitor only.', now() - interval '3 days'),
('Al Nabooda Automobiles (Land Rover)', 'Range Rover Sport 2024', 425000, 420000, 5000, 'We remain AED 5,000 cheaper — good competitive position.', now() - interval '2 days'),
('Premier Motors (Porsche)', 'Porsche Macan 2024', 270000, 265000, 5000, 'Competitively priced, reserved unit — no action needed.', now() - interval '4 days'),
('Al Futtaim Toyota', 'Toyota Land Cruiser GR Sport 2024', 342000, 335000, 7000, 'We are cheaper by AED 7,000 — leverage in marketing for this model.', now() - interval '2 days');

-- ===== RAG KNOWLEDGE BASE TABLE =====
drop table if exists rag_documents cascade;
create table rag_documents (
  id serial primary key,
  doc_title text not null,
  section text,
  content text not null,
  source_file text,
  page_number integer,
  search_vector tsvector generated always as (to_tsvector('english', coalesce(content,''))) stored
);

insert into rag_documents (doc_title, section, content, source_file, page_number) values
('Warranty Policy', 'Standard Coverage', 'All new vehicles sold by NEXUS OS come with a standard warranty of 3 years or 100,000 km, whichever comes first. This covers manufacturing defects in engine, transmission, and electrical systems.', 'warranty_policy_v4.2.pdf', 12),
('Warranty Policy', 'Extended Warranty', 'Customers may purchase an Extended Warranty for an additional 2 years beyond the standard coverage. This must be purchased within 30 days of vehicle delivery and is non-transferable.', 'warranty_policy_v4.2.pdf', 13),
('Warranty Policy', 'Powertrain Coverage', 'The powertrain (engine and transmission) is covered separately for 5 years or 150,000 km. This is the longest coverage period offered and applies regardless of standard or extended warranty status.', 'warranty_policy_v4.2.pdf', 14),
('Warranty Policy', 'Hybrid Battery Coverage', 'Hybrid and electric vehicle batteries carry an 8-year or 160,000 km warranty, covering degradation below 70 percent of original capacity.', 'warranty_policy_v4.2.pdf', 15),
('Warranty Policy', 'Warranty Voidance', 'Warranty is void if the vehicle is not serviced at authorized service centers according to the manufacturer-specified intervals, or if aftermarket modifications are made to the engine or suspension.', 'warranty_policy_v4.2.pdf', 16),
('HR Handbook', 'Annual Leave', 'All full-time employees are entitled to 30 calendar days of paid annual leave per year, accrued monthly. Leave requests must be submitted at least 2 weeks in advance for approval.', 'hr_handbook_2026.pdf', 22),
('HR Handbook', 'Sick Leave', 'Employees are entitled to 15 days of paid sick leave per year. A medical certificate is required for absences exceeding 2 consecutive days.', 'hr_handbook_2026.pdf', 23),
('HR Handbook', 'Maternity Leave', 'Female employees are entitled to 60 calendar days of paid maternity leave, in accordance with UAE labour law, plus the option of unpaid extension up to 45 additional days.', 'hr_handbook_2026.pdf', 24),
('Sales Compensation Policy', 'Commission Tiers', 'Sales commission is tiered based on gross margin per deal: margins under AED 10,000 earn 3 percent commission, AED 10,000-25,000 earn 5 percent, AED 25,000-50,000 earn 7 percent, and margins above AED 50,000 earn 10 percent.', 'sales_compensation_policy.pdf', 4),
('Sales Compensation Policy', 'Commission Payment Timing', 'Commissions are calculated and paid within 15 business days of full payment receipt and vehicle handover confirmation in the CRM system.', 'sales_compensation_policy.pdf', 5),
('Sales Compensation Policy', 'Clawback Policy', 'If a deal is cancelled or refunded within 30 days of delivery, any commission already paid on that deal will be deducted from the salesperson next payout cycle.', 'sales_compensation_policy.pdf', 6),
('Trade-In Appraisal SOP', 'Inspection Process', 'Every trade-in vehicle must undergo a physical inspection lasting approximately 30 minutes, covering exterior condition, interior wear, and mechanical function.', 'trade_in_appraisal_sop.pdf', 8),
('Trade-In Appraisal SOP', 'Diagnostic Requirements', 'An OBD diagnostic scan is mandatory for all trade-ins to check for stored fault codes before any offer is made to the customer.', 'trade_in_appraisal_sop.pdf', 9),
('Trade-In Appraisal SOP', 'Market Value Verification', 'Appraisers must check at least 3 independent market value sources, including Dubizzle, YallaMotor, and internal historical sales data, before finalizing a trade-in offer.', 'trade_in_appraisal_sop.pdf', 10),
('Trade-In Appraisal SOP', 'Manager Approval Threshold', 'Any trade-in offer exceeding AED 100,000 requires written approval from the Sales Manager before being presented to the customer.', 'trade_in_appraisal_sop.pdf', 11);
