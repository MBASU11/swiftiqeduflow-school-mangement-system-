-- Apply Storage permissions consistently with school_records role permissions.
-- Private document objects are school-scoped and available only to roles allowed
-- to access the documents collection. Upload/change/delete requires write access.

drop policy if exists school_documents_read_approved on storage.objects;
create policy school_documents_read_approved on storage.objects
for select to authenticated
using (
  bucket_id = 'school-documents'
  and (storage.foldername(name))[1] in (
    select id::text from public.schools
    where id in (select public.current_school_ids()) and status = 'approved'
  )
  and public.role_collection_access((select public.member_role()), 'documents') <> 'none'
);

drop policy if exists school_documents_insert_approved on storage.objects;
create policy school_documents_insert_approved on storage.objects
for insert to authenticated
with check (
  bucket_id = 'school-documents'
  and (storage.foldername(name))[1] in (
    select id::text from public.schools
    where id in (select public.current_school_ids()) and status = 'approved'
  )
  and public.role_collection_access((select public.member_role()), 'documents') = 'write'
);

drop policy if exists school_documents_update_approved on storage.objects;
create policy school_documents_update_approved on storage.objects
for update to authenticated
using (
  bucket_id = 'school-documents'
  and (storage.foldername(name))[1] in (
    select id::text from public.schools
    where id in (select public.current_school_ids()) and status = 'approved'
  )
  and public.role_collection_access((select public.member_role()), 'documents') = 'write'
)
with check (
  bucket_id = 'school-documents'
  and (storage.foldername(name))[1] in (
    select id::text from public.schools
    where id in (select public.current_school_ids()) and status = 'approved'
  )
  and public.role_collection_access((select public.member_role()), 'documents') = 'write'
);

drop policy if exists school_documents_delete_approved on storage.objects;
create policy school_documents_delete_approved on storage.objects
for delete to authenticated
using (
  bucket_id = 'school-documents'
  and (storage.foldername(name))[1] in (
    select id::text from public.schools
    where id in (select public.current_school_ids()) and status = 'approved'
  )
  and public.role_collection_access((select public.member_role()), 'documents') = 'write'
);
