begin;

-- The Imports page is correct and necessary for the Vincere migration, and wrong as permanent UI.
-- Its rollback button deletes committed records and anything edited since -- a genuinely dangerous
-- control to leave in a nav for years to serve one week of work.
--
-- This flag gates the Admin tile, not the route: the page keeps working for re-migration and
-- correction runs, which are real, it just stops being a standing hazard once the migration is
-- signed off. Deliberately distinct from document_migration_completed, which tracks whether legacy
-- documents were moved into storage -- a different question with a different answer.
alter table public.organization_settings
  add column if not exists migration_complete boolean not null default false;

comment on column public.organization_settings.migration_complete is
  'Set once the initial data migration is signed off. Hides the Imports tile from Admin; the route stays reachable for correction runs.';

commit;
