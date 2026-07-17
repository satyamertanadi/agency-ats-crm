-- Every base table in this schema is locked down by RLS policies (see the "RLS: all base tables
-- denied until an explicit member policy applies" block in the initial migration), which is the
-- real access gate here -- no migration in this project has ever explicitly GRANTed table-level DML
-- to anon/authenticated. On Supabase's hosted platform, new projects get these grants automatically
-- as part of the platform's own project bootstrap (outside of tracked migrations), so staging and
-- production have always had them silently. A fresh local Postgres brought up via `supabase start` +
-- `supabase db reset` -- exactly what CI's database job does -- does not reliably replicate that
-- bootstrap, so every direct (non-RPC) table query from the RLS test suite fails there with
-- "permission denied for table ..." before RLS even gets a chance to evaluate. Granting explicitly
-- makes the schema self-contained instead of depending on undocumented, environment-specific platform
-- state, and is a no-op everywhere these grants already exist.
grant usage on schema public to anon, authenticated, service_role;
grant all privileges on all tables in schema public to anon, authenticated, service_role;
grant all privileges on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
