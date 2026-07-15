-- White-label organization logos are public brand assets. Only users with
-- organization.manage can create, replace, or delete files under their org ID.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('organization-assets','organization-assets',true,2097152,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists organization_assets_owner_insert on storage.objects;
drop policy if exists organization_assets_owner_update on storage.objects;
drop policy if exists organization_assets_owner_delete on storage.objects;

create policy organization_assets_owner_insert on storage.objects for insert to authenticated
with check(bucket_id='organization-assets' and public.has_permission((storage.foldername(name))[1]::uuid,'organization.manage'));

create policy organization_assets_owner_update on storage.objects for update to authenticated
using(bucket_id='organization-assets' and public.has_permission((storage.foldername(name))[1]::uuid,'organization.manage'))
with check(bucket_id='organization-assets' and public.has_permission((storage.foldername(name))[1]::uuid,'organization.manage'));

create policy organization_assets_owner_delete on storage.objects for delete to authenticated
using(bucket_id='organization-assets' and public.has_permission((storage.foldername(name))[1]::uuid,'organization.manage'));
