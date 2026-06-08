-- ==========================================
-- DEFINITIVE FIX — Run this in Supabase SQL Editor
-- Grants all required privileges to all roles
-- ==========================================

-- Grant full access to service_role (admin API)
GRANT ALL ON public.user_roles TO service_role;
GRANT ALL ON public.events TO service_role;
GRANT ALL ON public.tickets TO service_role;

-- Grant access to authenticated users (logged-in users)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets TO authenticated;

-- Also disable RLS to avoid any policy conflicts
ALTER TABLE public.user_roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets DISABLE ROW LEVEL SECURITY;
