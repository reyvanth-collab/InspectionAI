-- ============================================================
-- InspectAI — Complete Supabase Schema v1.0
-- Multi-tenant with Row Level Security
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE public.user_role       AS ENUM ('admin', 'approver', 'inspector', 'viewer');
CREATE TYPE public.wi_status       AS ENUM ('draft', 'pending_approval', 'active', 'expiring', 'expired', 'superseded');
CREATE TYPE public.wo_status       AS ENUM ('open', 'in_progress', 'complete', 'cancelled');
CREATE TYPE public.wo_priority     AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE public.finding_result  AS ENUM ('pass', 'fail', 'na');
CREATE TYPE public.step_status     AS ENUM ('wait', 'active', 'done', 'rejected');
CREATE TYPE public.notif_severity  AS ENUM ('info', 'warning', 'critical', 'success');
CREATE TYPE public.ticket_status   AS ENUM ('open', 'in_progress', 'resolved', 'closed');
CREATE TYPE public.ticket_priority AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE public.esc_channel     AS ENUM ('email', 'teams', 'slack', 'sms');
CREATE TYPE public.integration_type AS ENUM ('maximo', 'sap_pm', 'teams', 'slack', 'email', 'power_bi', 'webhook');


-- ============================================================
-- TABLES
-- ============================================================

-- ── 1. tenants ──────────────────────────────────────────────
CREATE TABLE public.tenants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  slug           text NOT NULL UNIQUE,           -- e.g. "smrt"
  domain         text,                           -- custom domain
  logo_url       text,
  primary_color  text DEFAULT '#4f8ef7',
  plan           text NOT NULL DEFAULT 'enterprise',
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── 1a. job_queue ────────────────────────────────────────────
-- Durable queue for work that should not block API requests.
CREATE TABLE public.job_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id       uuid,
  job_type      text NOT NULL CHECK (job_type IN ('ai_analysis', 'report_generation', 'moms_import', 'notification')),
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 3,
  available_at  timestamptz NOT NULL DEFAULT now(),
  locked_at     timestamptz,
  completed_at  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenants IS 'Top-level organisations. Every other table is scoped to a tenant.';


-- ── 2. users ────────────────────────────────────────────────
-- Extends Supabase auth.users with InspectAI-specific fields.
CREATE TABLE public.users (
  id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_id       text NOT NULL,
  name           text NOT NULL,
  email          text NOT NULL,
  role           public.user_role NOT NULL DEFAULT 'viewer',
  department     text,
  avatar_url     text,
  active         boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, staff_id),
  UNIQUE (tenant_id, email)
);

COMMENT ON TABLE public.users IS 'InspectAI user profiles, linked 1-to-1 with auth.users.';


-- ── 3. work_instructions ────────────────────────────────────
CREATE TABLE public.work_instructions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  wi_number       text NOT NULL,                 -- e.g. "WI-EL-042"
  title           text NOT NULL,
  description     text,
  category        text,                          -- Electrical, Mechanical, Fire Prot…
  revision        text NOT NULL DEFAULT 'Rev 1',
  status          public.wi_status NOT NULL DEFAULT 'draft',
  owner_id        uuid REFERENCES public.users(id),
  effective_date  date,
  expiry_date     date,
  pdf_url         text,
  created_by      uuid REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, wi_number, revision)
);

COMMENT ON TABLE public.work_instructions IS 'Versioned inspection procedure documents.';


-- ── 4. wi_checklist_items ───────────────────────────────────
-- Template checklist items belonging to a work instruction.
CREATE TABLE public.wi_checklist_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  work_instruction_id uuid NOT NULL REFERENCES public.work_instructions(id) ON DELETE CASCADE,
  item_no             text NOT NULL,             -- "1.1", "1.2" etc.
  description         text NOT NULL,
  acceptance_criteria text,
  category            text,
  required            boolean NOT NULL DEFAULT true,
  field_type          text NOT NULL DEFAULT 'pass_fail',
  placeholder         text,
  options_json        text,
  unit                text,
  min_value           numeric,
  max_value           numeric,
  conditional_json    text,
  source_page         integer,
  source_text         text,
  ai_confidence       numeric,
  ai_warnings         text[],
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.wi_checklist_items IS 'Template checklist items within a work instruction.';


-- ── 5. wi_revision_history ──────────────────────────────────
CREATE TABLE public.wi_revision_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  work_instruction_id uuid NOT NULL REFERENCES public.work_instructions(id) ON DELETE CASCADE,
  revision            text NOT NULL,
  change_summary      text,
  approved_by         uuid REFERENCES public.users(id),
  effective_date      date,
  created_at          timestamptz NOT NULL DEFAULT now()
);


-- ── days_remaining view ─────────────────────────────────────
-- Computes days_remaining dynamically (CURRENT_DATE cannot be used
-- in a stored generated column because it is not immutable).
CREATE OR REPLACE VIEW public.work_instructions_view AS
  SELECT *,
    CASE
      WHEN expiry_date IS NOT NULL THEN (expiry_date - CURRENT_DATE)::integer
      ELSE NULL
    END AS days_remaining
  FROM public.work_instructions;


-- ── 6. work_orders ──────────────────────────────────────────
CREATE TABLE public.work_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  wo_number           text NOT NULL,             -- "WO-2401"
  work_instruction_id uuid REFERENCES public.work_instructions(id),
  asset_name          text NOT NULL,
  asset_id            text,                      -- External asset ID (Maximo / SAP)
  location            text,
  type                text,                      -- Preventive, Corrective, Statutory
  priority            public.wo_priority NOT NULL DEFAULT 'medium',
  status              public.wo_status NOT NULL DEFAULT 'open',
  assigned_to         uuid REFERENCES public.users(id),
  due_date            date,
  completed_at        timestamptz,
  external_wo_ref     text,                      -- Maximo / SAP reference
  notes               text,
  created_by          uuid REFERENCES public.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, wo_number)
);

COMMENT ON TABLE public.work_orders IS 'Work orders that drive inspection execution.';


-- ── 6a. assets ───────────────────────────────────────────────
-- Canonical asset register used by work orders and inspections.
CREATE TABLE public.assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  asset_number  text NOT NULL,
  name          text NOT NULL,
  category      text,
  location      text,
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'maintenance', 'retired')),
  criticality   text NOT NULL DEFAULT 'medium'
                CHECK (criticality IN ('low', 'medium', 'high', 'critical')),
  manufacturer  text,
  model         text,
  serial_number text,
  install_date  date,
  next_pm_date  date,
  notes         text,
  created_by    uuid REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, asset_number)
);

COMMENT ON TABLE public.assets IS 'Tenant-scoped canonical asset register.';

ALTER TABLE public.work_orders
  ADD COLUMN asset_record_id uuid REFERENCES public.assets(id) ON DELETE SET NULL;


-- ── 7. inspection_records ───────────────────────────────────
-- One record per inspection execution of a work order.
CREATE TABLE public.inspection_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  work_order_id   uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  inspector_id    uuid NOT NULL REFERENCES public.users(id),
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  total_items     integer NOT NULL DEFAULT 0,
  passed_items    integer NOT NULL DEFAULT 0,
  failed_items    integer NOT NULL DEFAULT 0,
  na_items        integer NOT NULL DEFAULT 0,
  overall_result  public.finding_result,
  signed_by       uuid REFERENCES public.users(id),
  signed_at       timestamptz,
  signature_hash  text,                          -- SHA-256 of signed payload
  signature_data_url text,
  device_info     jsonb,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inspection_records IS 'One row per inspection execution run.';


-- ── 8. inspection_findings ──────────────────────────────────
-- Per-item results within an inspection.
CREATE TABLE public.inspection_findings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  inspection_record_id uuid NOT NULL REFERENCES public.inspection_records(id) ON DELETE CASCADE,
  checklist_item_id    uuid NOT NULL REFERENCES public.wi_checklist_items(id),
  result               public.finding_result,
  notes                text,
  photo_urls           text[],
  -- AI-generated fields (Claude)
  ai_root_cause        text,
  ai_failure_class     text,
  ai_failure_code      text,
  ai_recommended_action text,
  ai_validation_status text,
  ai_validation_confidence numeric,
  ai_validation_reason text,
  ai_validation_recommended_result text,
  ai_validation_evidence jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inspection_record_id, checklist_item_id)
);

COMMENT ON TABLE public.inspection_findings IS 'Per-item pass/fail results with optional AI analysis.';


-- ── 9. approval_records ─────────────────────────────────────
CREATE TABLE public.approval_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  work_instruction_id uuid NOT NULL REFERENCES public.work_instructions(id) ON DELETE CASCADE,
  submitted_by        uuid NOT NULL REFERENCES public.users(id),
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  current_step        integer NOT NULL DEFAULT 1,
  final_status        public.step_status NOT NULL DEFAULT 'active',
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);


-- ── 10. approval_steps ──────────────────────────────────────
CREATE TABLE public.approval_steps (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  approval_record_id uuid NOT NULL REFERENCES public.approval_records(id) ON DELETE CASCADE,
  step_number        integer NOT NULL,
  label              text NOT NULL,              -- "Technical Check", "Reviewer", "Admin Sign-off"
  approver_id        uuid REFERENCES public.users(id),
  status             public.step_status NOT NULL DEFAULT 'wait',
  comment            text,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);


-- ── 11. audit_logs ──────────────────────────────────────────
-- Immutable — RLS prevents UPDATE and DELETE.
CREATE TABLE public.audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES public.users(id),
  action      text NOT NULL,                     -- "inspection.complete", "wi.approve" etc.
  entity_type text,                              -- "work_order", "work_instruction" etc.
  entity_id   uuid,
  severity    text NOT NULL DEFAULT 'info',      -- info | warning | critical
  detail      jsonb,
  ip_address  inet,
  user_agent  text,
  hash        text,                              -- SHA-256 of (prev_hash || payload)
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_logs IS 'Append-only tamper-evident audit trail.';


-- ── 12. notifications ───────────────────────────────────────
CREATE TABLE public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES public.users(id), -- NULL = broadcast to all tenant users
  title       text NOT NULL,
  message     text NOT NULL,
  severity    public.notif_severity NOT NULL DEFAULT 'info',
  entity_type text,
  entity_id   uuid,
  read        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);


-- ── 13. escalation_rules ────────────────────────────────────
CREATE TABLE public.escalation_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name             text NOT NULL,
  trigger_event    text NOT NULL,                -- "defect_found", "safety_critical", "wi_expiring"
  trigger_condition jsonb,                       -- {"priority": "high"} etc.
  active           boolean NOT NULL DEFAULT true,
  steps            jsonb NOT NULL DEFAULT '[]',  -- [{delay_hours, recipients, channels}]
  created_by       uuid REFERENCES public.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);


-- ── 14. escalations ─────────────────────────────────────────
-- Active escalation instances triggered by rules.
CREATE TABLE public.escalations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rule_id          uuid NOT NULL REFERENCES public.escalation_rules(id),
  entity_type      text NOT NULL,
  entity_id        uuid NOT NULL,
  current_step     integer NOT NULL DEFAULT 1,
  suppressed_until timestamptz,
  resolved_at      timestamptz,
  resolved_by      uuid REFERENCES public.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);


-- ── 15. support_tickets ─────────────────────────────────────
CREATE TABLE public.support_tickets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by   uuid NOT NULL REFERENCES public.users(id),
  title        text NOT NULL,
  category     text NOT NULL,                    -- "Technical", "Billing", "Feature Request"
  priority     public.ticket_priority NOT NULL DEFAULT 'medium',
  status       public.ticket_status NOT NULL DEFAULT 'open',
  sla_hours    integer NOT NULL DEFAULT 24,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);


-- ── 16. support_ticket_messages ─────────────────────────────
CREATE TABLE public.support_ticket_messages (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.users(id),   -- NULL = system/bot
  body      text NOT NULL,
  is_agent  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- ── 17. integration_configs ─────────────────────────────────
CREATE TABLE public.integration_configs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type             public.integration_type NOT NULL,
  name             text NOT NULL,
  enabled          boolean NOT NULL DEFAULT false,
  config           jsonb NOT NULL DEFAULT '{}',  -- URLs, credentials (encrypt at app level)
  field_mappings   jsonb NOT NULL DEFAULT '{}',
  last_tested_at   timestamptz,
  last_test_ok     boolean,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, type)
);

COMMENT ON TABLE public.integration_configs IS 'Per-tenant external integration settings. Encrypt secrets before storing in config.';


-- ── 18. inspection_schemas ──────────────────────────────────
-- The form/schema builder output.
CREATE TABLE public.inspection_schemas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  schema_json jsonb NOT NULL DEFAULT '{}',       -- JSON Schema / form definition
  version     integer NOT NULL DEFAULT 1,
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 19. moms_checklist_steps
-- Imported historical MOMS checklist step data.
CREATE TABLE public.moms_checklist_steps (
  id               bigserial PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  moms_id          bigint,
  work_order_id    text,
  template_id      text,
  template_name    text,
  wi_number        text,
  wr_number        text,
  wi_title         text,
  station          text,
  equipment_id     text,
  section_name     text,
  sub_section_no   text,
  sub_section_name text,
  sub_item_no      text,
  sub_item_name    text,
  step_no          text,
  step_desc        text,
  col_header       text,
  ctrl_type        text,
  category         text,
  result           text,
  remark           text,
  is_filled        boolean DEFAULT false,
  has_nok          boolean DEFAULT false,
  filled_by        text,
  inspected_at     timestamptz,
  imported_at      timestamptz DEFAULT now()
);


-- ============================================================
-- INDEXES
-- ============================================================

-- users
CREATE INDEX idx_users_tenant          ON public.users(tenant_id);
CREATE INDEX idx_users_role            ON public.users(tenant_id, role);
CREATE INDEX idx_job_queue_claim       ON public.job_queue(status, available_at, created_at);

-- work_instructions
CREATE INDEX idx_wi_tenant             ON public.work_instructions(tenant_id);
CREATE INDEX idx_wi_status             ON public.work_instructions(tenant_id, status);
CREATE INDEX idx_wi_expiry             ON public.work_instructions(expiry_date) WHERE expiry_date IS NOT NULL;

-- wi_checklist_items
CREATE INDEX idx_wci_wi                ON public.wi_checklist_items(work_instruction_id);

-- work_orders
CREATE INDEX idx_wo_tenant             ON public.work_orders(tenant_id);
CREATE INDEX idx_wo_status             ON public.work_orders(tenant_id, status);
CREATE INDEX idx_wo_assigned           ON public.work_orders(assigned_to);
CREATE INDEX idx_wo_due                ON public.work_orders(due_date);
CREATE INDEX idx_wo_asset_record       ON public.work_orders(tenant_id, asset_record_id);
CREATE INDEX idx_assets_tenant_status  ON public.assets(tenant_id, status);
CREATE INDEX idx_assets_tenant_criticality ON public.assets(tenant_id, criticality);
CREATE INDEX idx_assets_tenant_next_pm ON public.assets(tenant_id, next_pm_date);

-- inspection_records
CREATE INDEX idx_ir_tenant             ON public.inspection_records(tenant_id);
CREATE INDEX idx_ir_wo                 ON public.inspection_records(work_order_id);
CREATE INDEX idx_ir_inspector          ON public.inspection_records(inspector_id);

-- inspection_findings
CREATE INDEX idx_if_record             ON public.inspection_findings(inspection_record_id);
CREATE INDEX idx_if_result             ON public.inspection_findings(result);

-- approval_records
CREATE INDEX idx_ar_tenant             ON public.approval_records(tenant_id);
CREATE INDEX idx_ar_wi                 ON public.approval_records(work_instruction_id);

-- audit_logs
CREATE INDEX idx_al_tenant             ON public.audit_logs(tenant_id);
CREATE INDEX idx_al_user               ON public.audit_logs(user_id);
CREATE INDEX idx_al_entity             ON public.audit_logs(entity_type, entity_id);
CREATE INDEX idx_al_created            ON public.audit_logs(created_at DESC);

-- notifications
CREATE INDEX idx_notif_tenant_user     ON public.notifications(tenant_id, user_id);
CREATE INDEX idx_notif_unread          ON public.notifications(tenant_id, user_id) WHERE read = false;

-- moms_checklist_steps
CREATE INDEX idx_moms_tenant_wi        ON public.moms_checklist_steps(tenant_id, wi_number);
CREATE INDEX idx_moms_work_order       ON public.moms_checklist_steps(tenant_id, work_order_id);
CREATE INDEX idx_moms_inspected_at     ON public.moms_checklist_steps(tenant_id, inspected_at);
CREATE INDEX idx_moms_category         ON public.moms_checklist_steps(tenant_id, category);

-- support_tickets
CREATE INDEX idx_st_tenant             ON public.support_tickets(tenant_id);
CREATE INDEX idx_st_status             ON public.support_tickets(tenant_id, status);


-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Returns the tenant_id for the currently authenticated user.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT tenant_id
  FROM public.users
  WHERE id = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Returns the role for the currently authenticated user.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role
  FROM public.users
  WHERE id = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Auto-set updated_at trigger function.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ============================================================
-- updated_at TRIGGERS
-- ============================================================

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_wi_updated_at
  BEFORE UPDATE ON public.work_instructions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_wo_updated_at
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_assets_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_ir_updated_at
  BEFORE UPDATE ON public.inspection_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_if_updated_at
  BEFORE UPDATE ON public.inspection_findings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_ar_updated_at
  BEFORE UPDATE ON public.approval_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_er_updated_at
  BEFORE UPDATE ON public.escalation_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_esc_updated_at
  BEFORE UPDATE ON public.escalations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_ticket_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_integration_updated_at
  BEFORE UPDATE ON public.integration_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_schema_updated_at
  BEFORE UPDATE ON public.inspection_schemas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- AUTO-UPDATE wi_status BASED ON expiry_date
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_wi_status()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.work_instructions
  SET status = CASE
    WHEN status IN ('draft', 'pending_approval', 'superseded') THEN status
    WHEN expiry_date IS NULL THEN status
    WHEN CURRENT_DATE > expiry_date THEN 'expired'::public.wi_status
    WHEN (expiry_date - CURRENT_DATE) <= 30 THEN 'expiring'::public.wi_status
    ELSE 'active'::public.wi_status
  END
  WHERE status NOT IN ('draft', 'pending_approval', 'superseded');
$$;

-- Call manually or via pg_cron (if enabled):
-- SELECT cron.schedule('refresh-wi-status', '0 1 * * *', 'SELECT public.refresh_wi_status()');


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- ── tenants ─────────────────────────────────────────────────
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenants: users see own tenant"
  ON public.tenants FOR SELECT
  USING (id = public.current_tenant_id());

-- Only super-admins (direct DB access) manage tenants.

-- ── users ───────────────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: see own tenant"
  ON public.users FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "users: admins can insert"
  ON public.users FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_user_role() = 'admin'
  );

CREATE POLICY "users: admins can update"
  ON public.users FOR UPDATE
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() = 'admin')
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "users: admins can delete"
  ON public.users FOR DELETE
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() = 'admin');

-- ── job_queue ─────────────────────────────────────────────────
-- Internal worker table. No client-facing policies are intentional.
ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;

-- ── work_instructions ────────────────────────────────────────
ALTER TABLE public.work_instructions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wi: all roles see own tenant"
  ON public.work_instructions FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "wi: admin/approver can insert"
  ON public.work_instructions FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver')
  );

CREATE POLICY "wi: admin/approver can update"
  ON public.work_instructions FOR UPDATE
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver'))
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "wi: admin only delete"
  ON public.work_instructions FOR DELETE
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() = 'admin');

-- ── wi_checklist_items ───────────────────────────────────────
ALTER TABLE public.wi_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wci: all roles select"
  ON public.wi_checklist_items FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "wci: admin/approver insert/update/delete"
  ON public.wi_checklist_items FOR ALL
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver'))
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── wi_revision_history ─────────────────────────────────────
ALTER TABLE public.wi_revision_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wi_rev: all roles select"
  ON public.wi_revision_history FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "wi_rev: admin/approver insert"
  ON public.wi_revision_history FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver'));

-- ── work_orders ──────────────────────────────────────────────
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wo: all roles select"
  ON public.work_orders FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "wo: admin/approver insert"
  ON public.work_orders FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver'));

CREATE POLICY "wo: admin/approver/inspector update"
  ON public.work_orders FOR UPDATE
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver', 'inspector'))
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "wo: admin only delete"
  ON public.work_orders FOR DELETE
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() = 'admin');

-- ── assets ───────────────────────────────────────────────────
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assets: all roles see own tenant"
  ON public.assets FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "assets: admin/approver can insert"
  ON public.assets FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver')
  );

CREATE POLICY "assets: admin/approver can update"
  ON public.assets FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver')
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "assets: admin only delete"
  ON public.assets FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    AND public.current_user_role() = 'admin'
  );

-- ── inspection_records ───────────────────────────────────────
ALTER TABLE public.inspection_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ir: all roles select"
  ON public.inspection_records FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "ir: inspector insert"
  ON public.inspection_records FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'inspector'));

CREATE POLICY "ir: inspector update own record"
  ON public.inspection_records FOR UPDATE
  USING (tenant_id = public.current_tenant_id()
    AND (inspector_id = auth.uid() OR public.current_user_role() = 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── inspection_findings ──────────────────────────────────────
ALTER TABLE public.inspection_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "if: all roles select"
  ON public.inspection_findings FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "if: inspector insert/update"
  ON public.inspection_findings FOR ALL
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'inspector'))
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── approval_records ─────────────────────────────────────────
ALTER TABLE public.approval_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ar: all roles select"
  ON public.approval_records FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "ar: admin/approver manage"
  ON public.approval_records FOR ALL
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver'))
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── approval_steps ───────────────────────────────────────────
ALTER TABLE public.approval_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "as: all roles select"
  ON public.approval_steps FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "as: admin/approver manage"
  ON public.approval_steps FOR ALL
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver'))
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── audit_logs — APPEND ONLY ─────────────────────────────────
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "al: all roles select own tenant"
  ON public.audit_logs FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "al: anyone in tenant can insert"
  ON public.audit_logs FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

-- No UPDATE or DELETE policies = immutable

-- ── notifications ────────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif: user sees own + broadcasts"
  ON public.notifications FOR SELECT
  USING (tenant_id = public.current_tenant_id()
    AND (user_id = auth.uid() OR user_id IS NULL));

CREATE POLICY "notif: admin/system insert"
  ON public.notifications FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver'));

CREATE POLICY "notif: user marks own as read"
  ON public.notifications FOR UPDATE
  USING (tenant_id = public.current_tenant_id()
    AND (user_id = auth.uid() OR public.current_user_role() = 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── escalation_rules ─────────────────────────────────────────
ALTER TABLE public.escalation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "er: all roles select"
  ON public.escalation_rules FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "er: admin manage"
  ON public.escalation_rules FOR ALL
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() = 'admin')
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── escalations ──────────────────────────────────────────────
ALTER TABLE public.escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "esc: all roles select"
  ON public.escalations FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "esc: admin/approver manage"
  ON public.escalations FOR ALL
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver'))
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── support_tickets ──────────────────────────────────────────
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "st: user sees own + admin sees all"
  ON public.support_tickets FOR SELECT
  USING (tenant_id = public.current_tenant_id()
    AND (created_by = auth.uid() OR public.current_user_role() = 'admin'));

CREATE POLICY "st: any user can create"
  ON public.support_tickets FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "st: owner or admin can update"
  ON public.support_tickets FOR UPDATE
  USING (tenant_id = public.current_tenant_id()
    AND (created_by = auth.uid() OR public.current_user_role() = 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── support_ticket_messages ──────────────────────────────────
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stm: ticket members select"
  ON public.support_ticket_messages FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "stm: any user can insert"
  ON public.support_ticket_messages FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── integration_configs ──────────────────────────────────────
ALTER TABLE public.integration_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ic: all roles select"
  ON public.integration_configs FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "ic: admin manage"
  ON public.integration_configs FOR ALL
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() = 'admin')
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── inspection_schemas ───────────────────────────────────────
ALTER TABLE public.inspection_schemas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "is: all roles select"
  ON public.inspection_schemas FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "is: admin/approver manage"
  ON public.inspection_schemas FOR ALL
  USING (tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver'))
  WITH CHECK (tenant_id = public.current_tenant_id());


-- ============================================================
-- SEED DATA — SMRT Corporation (first tenant)
