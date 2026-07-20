-- Move the stored brand accent off the retired green.
--
-- organization_settings.primary_color is NOT NULL with a hardcoded default, so "no custom brand
-- colour" is not expressible as null -- every organization carries a literal hex whether or not
-- anyone chose it. That default was '#287A72', a green from the previous palette, which meant the
-- app shell injected green over the new blue tokens for orgs that had never opened the branding
-- editor, and every newly created organization would have inherited it too.
--
-- Two changes, both narrow:
--   1. The column default becomes the new accent, so new organizations start on the palette.
--   2. Existing rows still holding the OLD default are moved to the new one. Rows holding anything
--      else are left alone -- those are colours an agency actually chose, and this migration has no
--      business overwriting them.
--
-- AppShell treats a value equal to DEFAULT_ACCENT as "not customised" and skips its inline override,
-- which is what lets the theme-aware light/dark accents in tokens.css apply. Keep this hex and
-- shared/lib/branding.ts DEFAULT_ACCENT in step; nothing enforces that automatically.

alter table public.organization_settings
  alter column primary_color set default '#1d5a94';

update public.organization_settings
  set primary_color = '#1d5a94', updated_at = now()
  where lower(primary_color) = '#287a72';
