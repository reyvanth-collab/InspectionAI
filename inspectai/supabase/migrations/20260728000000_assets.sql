-- Asset register migration for databases already provisioned from schema.sql.
CREATE TABLE IF NOT EXISTS public.job_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  job_type      text NOT NULL,
  status        text NOT NULL DEFAULT 'queued',
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
CREATE INDEX IF NOT EXISTS idx_job_queue_claim
  ON public.job_queue(status, available_at, created_at);
ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.assets (
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

CREATE INDEX IF NOT EXISTS idx_assets_tenant_status
  ON public.assets(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_tenant_criticality
  ON public.assets(tenant_id, criticality);
CREATE INDEX IF NOT EXISTS idx_assets_tenant_next_pm
  ON public.assets(tenant_id, next_pm_date);

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS asset_record_id uuid REFERENCES public.assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wo_asset_record
  ON public.work_orders(tenant_id, asset_record_id);

DROP TRIGGER IF EXISTS trg_assets_updated_at ON public.assets;
CREATE TRIGGER trg_assets_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Existing installations may predate the tenant helper functions.
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

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assets: all roles see own tenant" ON public.assets;
CREATE POLICY "assets: all roles see own tenant"
  ON public.assets FOR SELECT
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "assets: admin/approver can insert" ON public.assets;
CREATE POLICY "assets: admin/approver can insert"
  ON public.assets FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver')
  );

DROP POLICY IF EXISTS "assets: admin/approver can update" ON public.assets;
CREATE POLICY "assets: admin/approver can update"
  ON public.assets FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver')
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "assets: admin only delete" ON public.assets;
CREATE POLICY "assets: admin only delete"
  ON public.assets FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    AND public.current_user_role() = 'admin'
  );

-- Existing installations may also predate work-order RLS.
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wo: all roles select" ON public.work_orders;
CREATE POLICY "wo: all roles select"
  ON public.work_orders FOR SELECT
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS "wo: admin/approver insert" ON public.work_orders;
CREATE POLICY "wo: admin/approver insert"
  ON public.work_orders FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver')
  );
DROP POLICY IF EXISTS "wo: admin/approver/inspector update" ON public.work_orders;
CREATE POLICY "wo: admin/approver/inspector update"
  ON public.work_orders FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    AND public.current_user_role() IN ('admin', 'approver', 'inspector')
  )
  WITH CHECK (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS "wo: admin only delete" ON public.work_orders;
CREATE POLICY "wo: admin only delete"
  ON public.work_orders FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    AND public.current_user_role() = 'admin'
  );
