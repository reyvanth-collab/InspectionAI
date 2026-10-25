ALTER TABLE public.wi_checklist_items
  ADD COLUMN IF NOT EXISTS layout_json text;
