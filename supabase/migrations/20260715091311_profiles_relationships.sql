-- Fixes a PostgREST embedding failure: "Could not find a relationship between
-- 'organization_members' and 'user_id' in the schema cache", surfaced live on the
-- Jobs/Candidates detail pages and the activity feed.
--
-- organization_members.user_id and activities.created_by have only ever referenced
-- auth.users(id) -- never public.profiles(id) -- since the very first migration.
-- auth.users is not in PostgREST's exposed schema (see supabase/config.toml), and
-- PostgREST does not chain relationships through a third table, so every
-- profiles:user_id(...) / profiles:created_by(...) embed in the frontend
-- (listTeamMembers, getJobDetail, listTasks, listPlacements, listActivities, and
-- execute-import's requiredMember) was structurally unresolvable from day one. It
-- simply never got exercised against a real schema cache until now.
--
-- This is safe to add: profiles.id always mirrors auth.users.id via the
-- handle_new_user() trigger, so every existing user_id/created_by value already
-- has a matching profiles row (verified with a left-join orphan check before
-- applying this to production -- zero orphans found).

alter table public.organization_members
  add constraint organization_members_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.activities
  add constraint activities_created_by_profiles_fkey
  foreign key (created_by) references public.profiles(id);
