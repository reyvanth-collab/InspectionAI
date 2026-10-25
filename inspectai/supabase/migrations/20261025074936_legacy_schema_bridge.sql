-- Dependency bridge for installations older than the checked-in release migrations.
-- Run before release_integrity; additive and safe on freshly bootstrapped schemas.
ALTER TABLE public.wi_checklist_items
 ADD COLUMN IF NOT EXISTS field_type text NOT NULL DEFAULT 'pass_fail',
 ADD COLUMN IF NOT EXISTS placeholder text,
 ADD COLUMN IF NOT EXISTS options_json text,
 ADD COLUMN IF NOT EXISTS unit text,
 ADD COLUMN IF NOT EXISTS min_value numeric,
 ADD COLUMN IF NOT EXISTS max_value numeric,
 ADD COLUMN IF NOT EXISTS conditional_json text,
 ADD COLUMN IF NOT EXISTS source_page integer,
 ADD COLUMN IF NOT EXISTS source_text text,
 ADD COLUMN IF NOT EXISTS ai_confidence numeric,
 ADD COLUMN IF NOT EXISTS ai_warnings text[];
ALTER TABLE public.inspection_records ADD COLUMN IF NOT EXISTS signature_data_url text;
ALTER TABLE public.inspection_findings
 ADD COLUMN IF NOT EXISTS ai_validation_status text,
 ADD COLUMN IF NOT EXISTS ai_validation_confidence numeric,
 ADD COLUMN IF NOT EXISTS ai_validation_reason text,
 ADD COLUMN IF NOT EXISTS ai_validation_recommended_result text,
 ADD COLUMN IF NOT EXISTS ai_validation_evidence jsonb;
CREATE TABLE IF NOT EXISTS public.moms_checklist_steps (
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
ALTER TABLE public.moms_checklist_steps ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_moms_tenant_wi        ON public.moms_checklist_steps(tenant_id, wi_number);
CREATE INDEX IF NOT EXISTS idx_moms_work_order       ON public.moms_checklist_steps(tenant_id, work_order_id);
CREATE INDEX IF NOT EXISTS idx_moms_inspected_at     ON public.moms_checklist_steps(tenant_id, inspected_at);
CREATE INDEX IF NOT EXISTS idx_moms_category         ON public.moms_checklist_steps(tenant_id, category);
