begin;

-- saved_views.columns was written as [] on every save and read by nothing: the column-picker it was
-- reserved for was never built. is_default is the other half of the same half-built feature -- it
-- rendered a star and persisted, but no page applied a default on load. SavedViewBar now applies it
-- on mount, so is_default stays and this goes.
alter table public.saved_views drop column if exists columns;

commit;
