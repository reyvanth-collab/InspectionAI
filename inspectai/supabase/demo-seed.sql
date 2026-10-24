-- ============================================================
-- NOTE: Auth users must be created first via Supabase Dashboard
-- (Authentication → Users → Invite user), then their auth.users
-- UUIDs substituted below. Placeholder UUIDs are provided so
-- the foreign-key constraints are satisfied; replace them after
-- creating real auth accounts.
-- ============================================================

-- Fixed UUIDs for seed data (replace with real auth.users IDs)
-- admin    → 'aaaaaaaa-0001-0001-0001-000000000001'
-- approver → 'aaaaaaaa-0001-0001-0001-000000000002'
-- inspector1 → 'aaaaaaaa-0001-0001-0001-000000000003'
-- inspector2 → 'aaaaaaaa-0001-0001-0001-000000000004'
-- viewer   → 'aaaaaaaa-0001-0001-0001-000000000005'

-- ── Tenant ──────────────────────────────────────────────────
INSERT INTO public.tenants (id, name, slug, domain, primary_color, plan)
VALUES (
  'bbbbbbbb-0001-0001-0001-000000000001',
  'SMRT Corporation',
  'smrt',
  'inspectai.smrt.com.sg',
  '#4f8ef7',
  'enterprise'
);

-- ── Auth users (run ONLY in Supabase SQL editor with service role) ──
-- These insert minimal auth.users rows so public.users FKs resolve.
-- In production: create users via the Auth dashboard or API instead.

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, aud, role
) VALUES
(
  'aaaaaaaa-0001-0001-0001-000000000001',
  'admin@smrt.com.sg',
  crypt('Admin@1234', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"Ahmad Rashid"}',
  now(), now(), 'authenticated', 'authenticated'
),
(
  'aaaaaaaa-0001-0001-0001-000000000002',
  'sarah.lee@smrt.com.sg',
  crypt('Approver@1234', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"Sarah Lee"}',
  now(), now(), 'authenticated', 'authenticated'
),
(
  'aaaaaaaa-0001-0001-0001-000000000003',
  'james.tan@smrt.com.sg',
  crypt('Inspector@1234', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"James Tan"}',
  now(), now(), 'authenticated', 'authenticated'
),
(
  'aaaaaaaa-0001-0001-0001-000000000004',
  'raj.kumar@smrt.com.sg',
  crypt('Inspector@1234', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"Raj Kumar"}',
  now(), now(), 'authenticated', 'authenticated'
),
(
  'aaaaaaaa-0001-0001-0001-000000000005',
  'viewer@smrt.com.sg',
  crypt('Viewer@1234', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"Viewer User"}',
  now(), now(), 'authenticated', 'authenticated'
);

-- ── Users (public profile) ───────────────────────────────────
INSERT INTO public.users (id, tenant_id, staff_id, name, email, role, department)
VALUES
(
  'aaaaaaaa-0001-0001-0001-000000000001',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'ADM001', 'Ahmad Rashid', 'admin@smrt.com.sg', 'admin', 'Engineering'
),
(
  'aaaaaaaa-0001-0001-0001-000000000002',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'APR001', 'Sarah Lee', 'sarah.lee@smrt.com.sg', 'approver', 'Quality Assurance'
),
(
  'aaaaaaaa-0001-0001-0001-000000000003',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'INS001', 'James Tan', 'james.tan@smrt.com.sg', 'inspector', 'Maintenance'
),
(
  'aaaaaaaa-0001-0001-0001-000000000004',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'INS002', 'Raj Kumar', 'raj.kumar@smrt.com.sg', 'inspector', 'Maintenance'
),
(
  'aaaaaaaa-0001-0001-0001-000000000005',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'VWR001', 'Viewer User', 'viewer@smrt.com.sg', 'viewer', 'Operations'
);

-- ── Work Instructions ────────────────────────────────────────
INSERT INTO public.work_instructions
  (id, tenant_id, wi_number, title, category, revision, status, owner_id, effective_date, expiry_date, created_by)
VALUES
(
  'cccccccc-0001-0001-0001-000000000001',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'WI-EL-042', 'Pump Station Electrical Inspection',
  'Electrical', 'Rev 4', 'active',
  'aaaaaaaa-0001-0001-0001-000000000002',
  '2025-01-15', '2027-01-14',
  'aaaaaaaa-0001-0001-0001-000000000001'
),
(
  'cccccccc-0001-0001-0001-000000000002',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'WI-ME-018', 'HVAC Preventive Maintenance Check',
  'Mechanical', 'Rev 2', 'expiring',
  'aaaaaaaa-0001-0001-0001-000000000002',
  '2024-06-01', '2026-05-01',
  'aaaaaaaa-0001-0001-0001-000000000001'
),
(
  'cccccccc-0001-0001-0001-000000000003',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'WI-FP-031', 'Fire Protection System Inspection',
  'Fire Protection', 'Rev 6', 'active',
  'aaaaaaaa-0001-0001-0001-000000000002',
  '2025-03-10', '2027-03-09',
  'aaaaaaaa-0001-0001-0001-000000000001'
),
(
  'cccccccc-0001-0001-0001-000000000004',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'WI-EL-067', 'Emergency Generator Inspection',
  'Electrical', 'Rev 2', 'expiring',
  'aaaaaaaa-0001-0001-0001-000000000002',
  '2024-04-01', '2026-04-15',
  'aaaaaaaa-0001-0001-0001-000000000001'
),
(
  'cccccccc-0001-0001-0001-000000000005',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'WI-EL-055', 'Lift Motor Preventive Inspection',
  'Electrical', 'Rev 1', 'draft',
  'aaaaaaaa-0001-0001-0001-000000000002',
  NULL, NULL,
  'aaaaaaaa-0001-0001-0001-000000000001'
);

-- ── WI Checklist Items ───────────────────────────────────────
-- WI-EL-042: Pump Station Electrical Inspection
INSERT INTO public.wi_checklist_items
  (tenant_id, work_instruction_id, item_no, description, acceptance_criteria, category, sort_order)
VALUES
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000001',
  '1.1', 'Inspect main switchboard for physical damage',
  'No visible cracks, burn marks, or corrosion. All terminals tight.',
  'Visual', 10
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000001',
  '1.2', 'Verify earth leakage circuit breaker (ELCB) operation',
  'ELCB trips within 30ms at 30mA test current.',
  'Functional', 20
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000001',
  '1.3', 'Check insulation resistance of supply cables',
  'IR reading ≥ 1 MΩ at 500V DC for each phase.',
  'Measurement', 30
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000001',
  '1.4', 'Verify pump motor running current against nameplate',
  'Running current within ±10% of nameplate FLA.',
  'Measurement', 40
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000001',
  '1.5', 'Inspect cable tray and conduit condition',
  'No physical damage, all cable clamps secure, conduit seals intact.',
  'Visual', 50
),
-- WI-FP-031: Fire Protection System Inspection
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000001',
  '2.1', 'Test fire alarm panel for fault conditions',
  'No active faults on panel. All zone indicators functional.',
  'Functional', 60
);

INSERT INTO public.wi_checklist_items
  (tenant_id, work_instruction_id, item_no, description, acceptance_criteria, category, sort_order)
VALUES
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000003',
  '1.1', 'Inspect sprinkler heads for obstruction',
  'All sprinkler heads unobstructed, no paint or corrosion.',
  'Visual', 10
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000003',
  '1.2', 'Test fire pump auto-start on pressure drop',
  'Fire pump starts automatically when header pressure drops below 5 bar.',
  'Functional', 20
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000003',
  '1.3', 'Verify hydrant hose reel condition',
  'Hose reel uncoils fully, no leaks, valve operates freely.',
  'Functional', 30
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000003',
  '1.4', 'Check fire damper operation',
  'All fire dampers close within 5 seconds on smoke detection signal.',
  'Functional', 40
);

-- ── WI Revision History ──────────────────────────────────────
INSERT INTO public.wi_revision_history
  (tenant_id, work_instruction_id, revision, change_summary, approved_by, effective_date)
VALUES
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000001',
  'Rev 3', 'Added IR testing requirements per SS638 update.',
  'aaaaaaaa-0001-0001-0001-000000000002',
  '2023-07-01'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000001',
  'Rev 4', 'Updated ELCB trip threshold to 30ms per BCA circular.',
  'aaaaaaaa-0001-0001-0001-000000000002',
  '2025-01-15'
);

-- ── Work Orders ──────────────────────────────────────────────
INSERT INTO public.work_orders
  (id, tenant_id, wo_number, work_instruction_id, asset_name, asset_id, location,
   type, priority, status, assigned_to, due_date, created_by)
VALUES
(
  'dddddddd-0001-0001-0001-000000000001',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'WO-2401', 'cccccccc-0001-0001-0001-000000000001',
  'Pump Station A', 'PSA-001', 'Buona Vista MCC',
  'Preventive', 'high', 'open',
  'aaaaaaaa-0001-0001-0001-000000000003',
  '2026-04-12',
  'aaaaaaaa-0001-0001-0001-000000000001'
),
(
  'dddddddd-0001-0001-0001-000000000002',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'WO-2402', 'cccccccc-0001-0001-0001-000000000002',
  'HVAC Unit 3B', 'HVAC-3B', 'Dhoby Ghaut Level 4',
  'Corrective', 'medium', 'in_progress',
  'aaaaaaaa-0001-0001-0001-000000000004',
  '2026-04-10',
  'aaaaaaaa-0001-0001-0001-000000000001'
),
(
  'dddddddd-0001-0001-0001-000000000003',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'WO-2403', 'cccccccc-0001-0001-0001-000000000003',
  'Fire Damper FD-7', 'FD-007', 'City Hall Stairwell S3',
  'Preventive', 'low', 'complete',
  'aaaaaaaa-0001-0001-0001-000000000003',
  '2026-04-09',
  'aaaaaaaa-0001-0001-0001-000000000001'
),
(
  'dddddddd-0001-0001-0001-000000000004',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'WO-2404', 'cccccccc-0001-0001-0001-000000000004',
  'Emergency Generator G-1', 'GEN-001', 'Raffles Place B2 Plant Room',
  'Preventive', 'high', 'open',
  'aaaaaaaa-0001-0001-0001-000000000003',
  '2026-04-13',
  'aaaaaaaa-0001-0001-0001-000000000001'
),
(
  'dddddddd-0001-0001-0001-000000000005',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'WO-2405', 'cccccccc-0001-0001-0001-000000000001',
  'Pump Station C', 'PSC-001', 'Orchard MCC',
  'Corrective', 'medium', 'open',
  'aaaaaaaa-0001-0001-0001-000000000004',
  '2026-04-15',
  'aaaaaaaa-0001-0001-0001-000000000001'
);

-- ── Approval Records ─────────────────────────────────────────
INSERT INTO public.approval_records
  (id, tenant_id, work_instruction_id, submitted_by, current_step, final_status)
VALUES
(
  'eeeeeeee-0001-0001-0001-000000000001',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000002',
  'aaaaaaaa-0001-0001-0001-000000000001',
  2, 'active'
),
(
  'eeeeeeee-0001-0001-0001-000000000002',
  'bbbbbbbb-0001-0001-0001-000000000001',
  'cccccccc-0001-0001-0001-000000000005',
  'aaaaaaaa-0001-0001-0001-000000000001',
  1, 'active'
);

INSERT INTO public.approval_steps
  (tenant_id, approval_record_id, step_number, label, approver_id, status, comment, completed_at)
VALUES
-- APR for WI-ME-018
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'eeeeeeee-0001-0001-0001-000000000001',
  1, 'Technical Check', 'aaaaaaaa-0001-0001-0001-000000000002',
  'done', 'Checklist items and acceptance criteria verified against SS553.',
  now() - interval '1 day'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'eeeeeeee-0001-0001-0001-000000000001',
  2, 'Reviewer', 'aaaaaaaa-0001-0001-0001-000000000002',
  'active', NULL, NULL
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'eeeeeeee-0001-0001-0001-000000000001',
  3, 'Admin Sign-off', 'aaaaaaaa-0001-0001-0001-000000000001',
  'wait', NULL, NULL
),
-- APR for WI-EL-055
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'eeeeeeee-0001-0001-0001-000000000002',
  1, 'Technical Check', 'aaaaaaaa-0001-0001-0001-000000000002',
  'active', NULL, NULL
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'eeeeeeee-0001-0001-0001-000000000002',
  2, 'Reviewer', 'aaaaaaaa-0001-0001-0001-000000000002',
  'wait', NULL, NULL
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'eeeeeeee-0001-0001-0001-000000000002',
  3, 'Admin Sign-off', 'aaaaaaaa-0001-0001-0001-000000000001',
  'wait', NULL, NULL
);

-- ── Escalation Rules ─────────────────────────────────────────
INSERT INTO public.escalation_rules
  (tenant_id, name, trigger_event, trigger_condition, active, steps, created_by)
VALUES
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'Critical Defect Found',
  'defect_found',
  '{"priority": ["high", "critical"]}',
  true,
  '[
    {"step": 1, "delay_hours": 0,  "recipients": ["supervisor"],    "channels": ["teams", "email"]},
    {"step": 2, "delay_hours": 4,  "recipients": ["dept_head"],     "channels": ["email"]},
    {"step": 3, "delay_hours": 24, "recipients": ["director"],      "channels": ["email", "sms"]}
  ]',
  'aaaaaaaa-0001-0001-0001-000000000001'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'Safety-Critical Finding',
  'safety_critical',
  '{}',
  true,
  '[
    {"step": 1, "delay_hours": 0, "recipients": ["supervisor", "safety_officer"], "channels": ["teams", "email", "sms"]},
    {"step": 2, "delay_hours": 1, "recipients": ["director", "safety_manager"],   "channels": ["email", "sms"]}
  ]',
  'aaaaaaaa-0001-0001-0001-000000000001'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'WI Expiring Soon',
  'wi_expiring',
  '{"days_remaining_lte": 30}',
  true,
  '[
    {"step": 1, "delay_hours": 0, "recipients": ["wi_owner", "approver"], "channels": ["email"]},
    {"step": 2, "delay_hours": 168, "recipients": ["admin"],              "channels": ["email", "teams"]}
  ]',
  'aaaaaaaa-0001-0001-0001-000000000001'
);

-- ── Notifications ────────────────────────────────────────────
INSERT INTO public.notifications
  (tenant_id, user_id, title, message, severity, entity_type, entity_id)
VALUES
(
  'bbbbbbbb-0001-0001-0001-000000000001', NULL,
  'WI Expiring in 6 Days — WI-EL-067',
  'Emergency Generator Inspection expires on 2026-04-15. Renewal action required immediately.',
  'critical', 'work_instruction', 'cccccccc-0001-0001-0001-000000000004'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001', NULL,
  'WI Expiring in 22 Days — WI-ME-018',
  'HVAC Preventive Maintenance Check expires on 2026-05-01. Please initiate renewal.',
  'warning', 'work_instruction', 'cccccccc-0001-0001-0001-000000000002'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'aaaaaaaa-0001-0001-0001-000000000002',
  'Approval Required — WI-EL-055 Rev 1',
  'Lift Motor Preventive Inspection is awaiting Technical Check approval.',
  'info', 'approval_record', 'eeeeeeee-0001-0001-0001-000000000002'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'aaaaaaaa-0001-0001-0001-000000000003',
  'New Work Order Assigned — WO-2401',
  'Pump Station A Electrical Inspection assigned to you. Due 2026-04-12.',
  'info', 'work_order', 'dddddddd-0001-0001-0001-000000000001'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'aaaaaaaa-0001-0001-0001-000000000003',
  'New Work Order Assigned — WO-2404',
  'Emergency Generator G-1 Inspection assigned to you. Due 2026-04-13.',
  'warning', 'work_order', 'dddddddd-0001-0001-0001-000000000004'
);

-- ── Integration Configs ──────────────────────────────────────
INSERT INTO public.integration_configs
  (tenant_id, type, name, enabled, config, field_mappings)
VALUES
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'maximo', 'IBM Maximo', false,
  '{"base_url": "", "username": "", "api_key": ""}',
  '{"wo_number": "wonum", "asset_id": "assetnum", "location": "siteid"}'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'teams', 'Microsoft Teams', false,
  '{"webhook_url": ""}',
  '{}'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'email', 'SMTP Email', false,
  '{"host": "smtp.smrt.com.sg", "port": 587, "from": "inspectai@smrt.com.sg"}',
  '{}'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'power_bi', 'Power BI', false,
  '{"workspace_id": "", "dataset_id": "", "client_id": ""}',
  '{}'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'slack', 'Slack', false,
  '{"webhook_url": "", "channel": "#inspectai-alerts"}',
  '{}'
);

-- ── Audit Log seed entries ───────────────────────────────────
INSERT INTO public.audit_logs
  (tenant_id, user_id, action, entity_type, entity_id, severity, detail)
VALUES
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'aaaaaaaa-0001-0001-0001-000000000001',
  'tenant.created', 'tenant', 'bbbbbbbb-0001-0001-0001-000000000001',
  'info', '{"name": "SMRT Corporation"}'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'aaaaaaaa-0001-0001-0001-000000000001',
  'wi.created', 'work_instruction', 'cccccccc-0001-0001-0001-000000000001',
  'info', '{"wi_number": "WI-EL-042", "revision": "Rev 4"}'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'aaaaaaaa-0001-0001-0001-000000000002',
  'wi.approved', 'work_instruction', 'cccccccc-0001-0001-0001-000000000001',
  'info', '{"step": "Technical Check", "revision": "Rev 4"}'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'aaaaaaaa-0001-0001-0001-000000000003',
  'inspection.complete', 'work_order', 'dddddddd-0001-0001-0001-000000000003',
  'info', '{"wo_number": "WO-2403", "passed": 4, "failed": 0}'
),
(
  'bbbbbbbb-0001-0001-0001-000000000001',
  'aaaaaaaa-0001-0001-0001-000000000004',
  'inspection.started', 'work_order', 'dddddddd-0001-0001-0001-000000000002',
  'info', '{"wo_number": "WO-2402"}'
);


-- ============================================================
-- DONE
-- ============================================================
-- Seed credentials (change passwords immediately in production):
--   admin@smrt.com.sg        / Admin@1234      (admin)
--   sarah.lee@smrt.com.sg    / Approver@1234   (approver)
--   james.tan@smrt.com.sg    / Inspector@1234  (inspector)
--   raj.kumar@smrt.com.sg    / Inspector@1234  (inspector)
--   viewer@smrt.com.sg       / Viewer@1234     (viewer)
-- ============================================================
