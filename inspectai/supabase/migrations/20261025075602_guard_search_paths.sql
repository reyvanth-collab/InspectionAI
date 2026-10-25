-- These trigger functions reference application objects with schema qualifiers.
-- Pin resolution so sessions cannot redirect function lookup through search_path.
ALTER FUNCTION public.guard_instruction_items() SET search_path = '';
ALTER FUNCTION public.guard_instruction_revision() SET search_path = '';
ALTER FUNCTION public.guard_finding() SET search_path = '';
ALTER FUNCTION public.guard_signed_record() SET search_path = '';
ALTER FUNCTION public.guard_work_order() SET search_path = '';
ALTER FUNCTION public.audit_business_change() SET search_path = '';
