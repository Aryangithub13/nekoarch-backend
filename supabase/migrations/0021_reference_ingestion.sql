-- Phase 31: secure reference ingestion, private reference blobs, lifecycle and signed download links.
-- Additive only: no historical table, constraint, row or function is modified except the idempotency operation whitelist,
-- which is re-created as a superset (same pattern as 0010/0014–0020). References never change a revision or any engine input.
create table public.project_references (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 uploaded_by uuid not null,
 bound_revision_id uuid,
 status text not null check (status in ('ACTIVE','ARCHIVED','DELETED')),
 purpose text not null check (purpose in ('SITE_PHOTO','SITE_PLAN','SKETCH','INSPIRATION','DOCUMENT','OTHER')),
 display_name text check (char_length(display_name) between 1 and 120),
 note text check (char_length(note) between 1 and 500),
 media_type text not null check (media_type in ('image/png','image/jpeg','image/webp','application/pdf')),
 original_sha256 text not null check (original_sha256 ~ '^[a-f0-9]{64}$'),
 original_bytes integer not null check (original_bytes between 1 and 10485760),
 stored_sha256 text not null check (stored_sha256 ~ '^[a-f0-9]{64}$'),
 stored_bytes integer not null check (stored_bytes between 1 and 10485760),
 storage_locator text not null check (storage_locator = 'postgres-bytea'),
 inspector_version text not null check (inspector_version = 'reference-inspector-v1'),
 provenance_json jsonb not null check (octet_length(provenance_json::text) <= 65536),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 deleted_at timestamptz,
 foreign key (project_id, bound_revision_id) references public.project_revisions(project_id, id),
 check ((status = 'DELETED') = (deleted_at is not null)),
 -- The signed provenance must describe exactly this row: hashes, sizes, type, an ACCEPTED verdict and the fixed non-claims.
 check ((provenance_json->>'sourceKind' = 'USER_UPLOAD' and provenance_json->>'uploadedBy' = uploaded_by::text
   and provenance_json->'original'->>'sha256' = original_sha256 and (provenance_json->'original'->>'bytes')::integer = original_bytes
   and provenance_json->'stored'->>'sha256' = stored_sha256 and (provenance_json->'stored'->>'bytes')::integer = stored_bytes
   and provenance_json->'inspection'->>'inspectorVersion' = inspector_version and provenance_json->'inspection'->>'verdict' = 'ACCEPTED'
   and provenance_json->'inspection'->>'detectedMediaType' = media_type and provenance_json->'inspection'->>'declaredMediaType' = media_type
   and provenance_json->'inspection'->'malwareScan' = jsonb_build_object('status','NOT_PERFORMED','reason','NO_SCANNER_CONFIGURED')
   and provenance_json->'inspection'->'claims' = jsonb_build_object('malwareFree','NOT_CLAIMED','contentAccuracy','NOT_CLAIMED','drawingScale','NOT_CLAIMED',
     'siteConditions','NOT_CLAIMED','ownershipOrLicence','NOT_CLAIMED')) is true)
);
create unique index project_references_live_content_idx on public.project_references(project_id, stored_sha256) where status <> 'DELETED';
create index project_references_project_created_idx on public.project_references(project_id, created_at desc, id desc);
create index project_references_revision_idx on public.project_references(bound_revision_id) where bound_revision_id is not null;
-- Bytes: reachable only through reference_read / reference_download (no policy, no grant); never a public or raw storage URL.
create table public.project_reference_blobs (
 reference_id uuid primary key references public.project_references(id),
 bytes bytea not null check (octet_length(bytes) between 1 and 10485760)
);
create table public.project_reference_events (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 reference_id uuid references public.project_references(id),
 actor uuid,
 event_type text not null check (event_type in ('UPLOADED','DEDUPLICATED','REJECTED','ARCHIVED','RESTORED','DELETED','DOWNLOAD_LINK_ISSUED','METADATA_UPDATED')),
 detail jsonb not null check (octet_length(detail::text) <= 4096),
 created_at timestamptz not null default clock_timestamp(),
 check ((event_type = 'REJECTED') = (reference_id is null))
);
create index project_reference_events_reference_idx on public.project_reference_events(reference_id, created_at desc);
create index project_reference_events_attempts_idx on public.project_reference_events(project_id, created_at) where event_type in ('UPLOADED','DEDUPLICATED','REJECTED');

alter table public.project_references enable row level security;
alter table public.project_reference_blobs enable row level security;
alter table public.project_reference_events enable row level security;
revoke all on public.project_references, public.project_reference_blobs, public.project_reference_events from public, anon, authenticated, service_role;
grant select on public.project_references, public.project_reference_events to authenticated, service_role;
create policy references_owner_read on public.project_references for select to authenticated using (
 exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy reference_events_owner_read on public.project_reference_events for select to authenticated using (
 exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

-- Lifecycle invariants live in the database: identity never changes, DELETED is terminal, only the design §6 transitions exist.
create function project_private.reference_guard() returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op = 'DELETE' then raise exception using errcode = '23514', message = 'References are retained as tombstones'; end if;
 if (new.id, new.project_id, new.uploaded_by, new.bound_revision_id, new.media_type, new.original_sha256, new.original_bytes, new.stored_sha256,
     new.stored_bytes, new.storage_locator, new.inspector_version, new.provenance_json, new.created_at)
   is distinct from (old.id, old.project_id, old.uploaded_by, old.bound_revision_id, old.media_type, old.original_sha256, old.original_bytes, old.stored_sha256,
     old.stored_bytes, old.storage_locator, old.inspector_version, old.provenance_json, old.created_at) then
   raise exception using errcode = '23514', message = 'Reference identity is immutable'; end if;
 if old.status = 'DELETED' then raise exception using errcode = 'P3106', message = 'Deleted references are immutable'; end if;
 if not (new.status = old.status or (old.status = 'ACTIVE' and new.status in ('ARCHIVED','DELETED')) or (old.status = 'ARCHIVED' and new.status in ('ACTIVE','DELETED'))) then
   raise exception using errcode = 'P3106', message = 'Invalid reference transition'; end if;
 new.deleted_at := case when new.status = 'DELETED' then clock_timestamp() end;
 new.updated_at := clock_timestamp();
 return new;
end;
$$;
create trigger reference_guard before update or delete on public.project_references for each row execute function project_private.reference_guard();
create function project_private.reference_blob_guard() returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op = 'UPDATE' then raise exception using errcode = '23514', message = 'Reference bytes are immutable'; end if;
 if not exists (select 1 from public.project_references where id = old.reference_id and status = 'DELETED') then
   raise exception using errcode = '23514', message = 'Reference bytes are removed only by deleting the reference'; end if;
 return old;
end;
$$;
create trigger reference_blob_guard before update or delete on public.project_reference_blobs for each row execute function project_private.reference_blob_guard();
create trigger reference_event_immutable before update or delete on public.project_reference_events for each row execute function project_private.immutable_revision();

create function project_private.reference_summary(r public.project_references) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',r.id,'projectId',r.project_id,'status',r.status,'purpose',r.purpose,'displayName',r.display_name,'note',r.note,
 'mediaType',r.media_type,'originalSha256',r.original_sha256,'originalBytes',r.original_bytes,'storedSha256',r.stored_sha256,'storedBytes',r.stored_bytes,
 'storageLocator',r.storage_locator,'inspectorVersion',r.inspector_version,'boundRevisionId',r.bound_revision_id,'uploadedBy',r.uploaded_by,
 'createdAt',r.created_at,'updatedAt',r.updated_at,'deletedAt',r.deleted_at)
$$;
create function project_private.reference_detail(r public.project_references) returns jsonb language sql stable set search_path = '' as $$
 select project_private.reference_summary(r) || jsonb_build_object('provenance',r.provenance_json,
   'events',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id desc) from (
     select jsonb_build_object('id',e.id,'eventType',e.event_type,'actor',e.actor,'detail',e.detail,'createdAt',e.created_at) item,e.created_at,e.id
     from public.project_reference_events e where e.reference_id = r.id order by e.created_at desc,e.id desc limit 50) x),'[]'::jsonb),
   'projectCurrentRevisionId',(select p.current_revision_id from public.projects p where p.id = r.project_id))
$$;
-- Upload attempts (stored, deduplicated or rejected) in the last hour; the project row lock serializes this check.
create function project_private.reference_attempts(p_project_id uuid) returns integer language sql stable set search_path = '' as $$
 select count(*)::integer from public.project_reference_events
 where project_id = p_project_id and event_type in ('UPLOADED','DEDUPLICATED','REJECTED') and created_at > clock_timestamp() - interval '1 hour'
$$;

alter table public.idempotency_records drop constraint idempotency_records_operation_check;
alter table public.idempotency_records add check(operation in (
 '/api/plans','/api/plans/generate','/api/estimates','/api/projects','/api/projects/:projectId/revisions',
 '/api/projects/:projectId/revisions/generate','/api/projects/:projectId/revisions/:revisionId/takeoffs',
 '/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations',
 '/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations/:calculationId/cost-estimates',
 '/api/projects/:projectId/workflows',
 '/api/projects/:projectId/revisions/:revisionId/structural/analyses',
 '/api/projects/:projectId/revisions/:revisionId/environmental/analyses',
 '/api/projects/:projectId/revisions/:revisionId/systems/analyses',
 '/api/projects/:projectId/revisions/:revisionId/knowledge/analyses',
 '/api/projects/:projectId/revisions/:revisionId/optimization/studies',
 '/api/projects/:projectId/revisions/:revisionId/scene/artifacts',
 '/api/projects/:projectId/revision-operations',
 '/api/projects/:projectId/revision-operations/:operationId/execute',
 '/api/projects/:projectId/revision-operations/:operationId/approve',
 '/api/projects/:projectId/revision-operations/:operationId/reject',
 '/api/projects/:projectId/revision-operations/:operationId/cancel',
 '/api/projects/:projectId/references',
 '/api/projects/:projectId/references/:referenceId'));

create function public.reference_write(p_action text,p_input jsonb,p_bytes_base64 text default null,p_context jsonb default null,p_envelope text default null,p_signature text default null)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
 uid uuid := auth.uid(); root text := '/api/projects/:projectId/references'; op text; secret text; envelope jsonb; receipt public.idempotency_records;
 p public.projects; r public.project_references; prov jsonb := p_input->'provenance'; bytes bytea; media text; result jsonb; changes jsonb := p_input->'changes';
 next_status text; previous_status text; touched boolean;
begin
 if uid is null then raise insufficient_privilege; end if;
 op := case p_action when 'upload' then root when 'reject' then root when 'update' then root || '/:referenceId' when 'delete' then root || '/:referenceId'
   when 'link' then root || '/:referenceId/download-links' end;
 if op is null or p_input->>'action' is distinct from p_action then raise invalid_parameter_value; end if;
 select k.secret into secret from project_private.commit_key k where singleton;
 if p_envelope is null or p_signature is null or
 p_signature <> encode(extensions.hmac(convert_to(p_envelope,'UTF8'),decode(secret,'hex'),'sha256'),'hex') then raise insufficient_privilege; end if;
 envelope := p_envelope::jsonb;
 if (envelope->>'userId'=uid::text and envelope->>'operation'=op and envelope->'input'=p_input
 and envelope->'context'=coalesce(p_context,'null'::jsonb)
 and (envelope->>'expiresAt')::bigint between extract(epoch from clock_timestamp())::bigint and extract(epoch from clock_timestamp())::bigint+600) is not true then raise insufficient_privilege; end if;
 -- Ownership is checked even for a receipt replay; the project row lock serializes limits, dedupe and transitions per project.
 select * into p from public.projects where id=(p_input->>'projectId')::uuid and owner_id=uid for update;
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 if p_context is not null then
   if (p_action in ('upload','delete') and p_context->>'operation'=op and p_context->>'keyHash' ~ '^[a-f0-9]{64}$' and p_context->>'fingerprint' ~ '^[a-f0-9]{64}$') is not true then
     raise invalid_parameter_value; end if;
   select * into receipt from public.idempotency_records where user_id=uid and operation=op and key_hash=p_context->>'keyHash';
   if found and receipt.expires_at>now() then
     if receipt.fingerprint<>p_context->>'fingerprint' then raise exception using errcode='P8001',message='Idempotency conflict'; end if;
     return receipt.response;
   end if;
   delete from public.idempotency_records where user_id=uid and operation=op and key_hash=p_context->>'keyHash';
 end if;

 if p_action in ('upload','reject') then
   if project_private.reference_attempts(p.id) >= 30 then raise exception using errcode='P3104',message='Reference upload rate limit reached'; end if;
 end if;
 if p_action = 'reject' then
   -- Audit only: hash, size and finding codes of the refused file; its bytes are never stored.
   if (p_input->'report'->>'originalSha256' ~ '^[a-f0-9]{64}$' and (p_input->'report'->>'originalBytes')::integer between 0 and 10485760
     and jsonb_typeof(p_input->'report'->'codes')='array' and jsonb_array_length(p_input->'report'->'codes') between 1 and 32) is not true then
     raise invalid_parameter_value; end if;
   insert into public.project_reference_events(project_id,reference_id,actor,event_type,detail) values(p.id,null,uid,'REJECTED',p_input->'report');
   return jsonb_build_object('recorded',true);
 end if;

 if p_action = 'upload' then
   begin bytes := decode(p_bytes_base64,'base64'); exception when others then raise exception using errcode='P3103',message='Reference bytes are not base64'; end;
   media := p_input->>'mediaType';
   -- The bytes are re-hashed here and must be exactly the inspected, signed output; the provenance is bound to this user.
   if (jsonb_typeof(prov)='object' and prov->>'uploadedBy'=uid::text and prov->'inspection'->>'detectedMediaType'=media
     and bytes is not null and octet_length(bytes)=(prov->'stored'->>'bytes')::integer and encode(pg_catalog.sha256(bytes),'hex')=prov->'stored'->>'sha256'
     and case media when 'image/png' then substring(bytes from 1 for 8)='\x89504e470d0a1a0a'::bytea
       when 'image/jpeg' then substring(bytes from 1 for 3)='\xffd8ff'::bytea
       when 'image/webp' then substring(bytes from 1 for 4)='\x52494646'::bytea and substring(bytes from 9 for 4)='\x57454250'::bytea
       when 'application/pdf' then substring(bytes from 1 for 5)='\x255044462d'::bytea else false end) is not true then
     raise exception using errcode='P3103',message='Reference bytes do not match their inspection'; end if;
   if p_input->>'revisionId' is not null and not exists (select 1 from public.project_revisions where id=(p_input->>'revisionId')::uuid and project_id=p.id) then
     raise exception using errcode='P3102',message='Revision not found'; end if;
   select * into r from public.project_references where project_id=p.id and stored_sha256=prov->'stored'->>'sha256' and status<>'DELETED';
   if found then
     insert into public.project_reference_events(project_id,reference_id,actor,event_type,detail)
     values(p.id,r.id,uid,'DEDUPLICATED',jsonb_build_object('originalSha256',prov->'original'->>'sha256'));
     result := project_private.reference_detail(r) || jsonb_build_object('deduplicated',true);
   else
     if (select count(*) from public.project_references where project_id=p.id and status<>'DELETED') >= 50
       or (select coalesce(sum(stored_bytes),0) from public.project_references where project_id=p.id and status<>'DELETED') + octet_length(bytes) > 209715200 then
       raise exception using errcode='P3104',message='Project reference storage limit reached'; end if;
     insert into public.project_references(project_id,uploaded_by,bound_revision_id,status,purpose,display_name,note,media_type,original_sha256,original_bytes,
       stored_sha256,stored_bytes,storage_locator,inspector_version,provenance_json)
     values(p.id,uid,(p_input->>'revisionId')::uuid,'ACTIVE',p_input->>'purpose',p_input->>'displayName',p_input->>'note',media,prov->'original'->>'sha256',
       (prov->'original'->>'bytes')::integer,prov->'stored'->>'sha256',octet_length(bytes),'postgres-bytea',prov->'inspection'->>'inspectorVersion',prov)
     returning * into r;
     insert into public.project_reference_blobs(reference_id,bytes) values(r.id,bytes);
     insert into public.project_reference_events(project_id,reference_id,actor,event_type,detail)
     values(p.id,r.id,uid,'UPLOADED',jsonb_build_object('storedSha256',r.stored_sha256,'storedBytes',r.stored_bytes,'mediaType',r.media_type));
     result := project_private.reference_detail(r) || jsonb_build_object('deduplicated',false);
   end if;
 else
   select * into r from public.project_references where id=(p_input->>'referenceId')::uuid and project_id=p.id for update;
   if not found then raise exception using errcode='P3101',message='Reference not found'; end if;
   if r.status='DELETED' then raise exception using errcode='P3106',message='Deleted references are immutable'; end if;
   if p_action = 'update' then
     if jsonb_typeof(changes) is distinct from 'object' or changes = '{}'::jsonb then raise invalid_parameter_value; end if;
     next_status := coalesce(changes->>'status', r.status);
     touched := (changes ? 'displayName' and changes->>'displayName' is distinct from r.display_name) or (changes ? 'note' and changes->>'note' is distinct from r.note)
       or (changes ? 'purpose' and changes->>'purpose' is distinct from r.purpose);
     previous_status := r.status;
     update public.project_references set status=next_status,
       display_name=case when changes ? 'displayName' then changes->>'displayName' else display_name end,
       note=case when changes ? 'note' then changes->>'note' else note end,
       purpose=coalesce(changes->>'purpose',purpose)
     where id=r.id returning * into r;
     if r.status <> previous_status then
       insert into public.project_reference_events(project_id,reference_id,actor,event_type,detail)
       values(p.id,r.id,uid,case r.status when 'ARCHIVED' then 'ARCHIVED' else 'RESTORED' end,jsonb_build_object('from',previous_status)); end if;
     if touched then
       insert into public.project_reference_events(project_id,reference_id,actor,event_type,detail)
       values(p.id,r.id,uid,'METADATA_UPDATED',jsonb_build_object('fields',(select jsonb_agg(k order by k) from jsonb_object_keys(changes - 'status') k))); end if;
   elsif p_action = 'delete' then
     update public.project_references set status='DELETED' where id=r.id returning * into r;
     delete from public.project_reference_blobs where reference_id=r.id;
     insert into public.project_reference_events(project_id,reference_id,actor,event_type,detail)
     values(p.id,r.id,uid,'DELETED',jsonb_build_object('storedSha256',r.stored_sha256));
   else -- link
     if ((p_input->>'expiresAt')::bigint between extract(epoch from clock_timestamp())::bigint + 59 and extract(epoch from clock_timestamp())::bigint + 901) is not true then
       raise invalid_parameter_value; end if;
     insert into public.project_reference_events(project_id,reference_id,actor,event_type,detail)
     values(p.id,r.id,uid,'DOWNLOAD_LINK_ISSUED',jsonb_build_object('expiresAt',(p_input->>'expiresAt')::bigint));
   end if;
   result := project_private.reference_detail(r);
 end if;
 if p_context is not null then
   insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response) values(uid,op,p_context->>'keyHash',p_context->>'fingerprint',result);
 end if;
 return result;
end;
$$;

create function public.reference_read(p_action text,p_project_id uuid,p_reference_id uuid default null,p_limit integer default 20,p_cursor jsonb default null,p_filter jsonb default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.projects; r public.project_references; items jsonb; next_cursor jsonb; total integer; bytes bytea; f jsonb := coalesce(p_filter,'{}'::jsonb);
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into p from public.projects where id=p_project_id and owner_id=auth.uid();
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 if p_action in ('get','bytes') then
   select * into r from public.project_references where id=p_reference_id and project_id=p.id;
   if not found then raise exception using errcode='P3101',message='Reference not found'; end if;
   if p_action='get' then return project_private.reference_detail(r); end if;
   if r.status='DELETED' then raise exception using errcode='P3101',message='Reference not found'; end if;
   select b.bytes into bytes from public.project_reference_blobs b where b.reference_id=r.id;
   if not found or encode(pg_catalog.sha256(bytes),'hex')<>r.stored_sha256 or octet_length(bytes)<>r.stored_bytes then
     raise exception using errcode='P3105',message='Reference integrity failure'; end if;
   return project_private.reference_summary(r) || jsonb_build_object('bytesBase64',encode(bytes,'base64'),'projectCurrentRevisionId',p.current_revision_id);
 elsif p_action='list' then
   if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value; end if;
   with page as (select * from public.project_references where project_id=p.id
     and (f->>'status' = 'ALL' or status = coalesce(f->>'status','ACTIVE'))
     and (f->>'purpose' is null or purpose = f->>'purpose')
     and (f->>'revisionId' is null or bound_revision_id = (f->>'revisionId')::uuid)
     and (p_cursor is null or (created_at,id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
     order by created_at desc,id desc limit p_limit+1),
   shown as (select * from page order by created_at desc,id desc limit p_limit)
   select (select count(*) from page),coalesce(jsonb_agg(project_private.reference_summary(shown) order by created_at desc,id desc),'[]'::jsonb),
   (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) into total,items,next_cursor from shown;
   return jsonb_build_object('items',items,'nextCursor',case when total>p_limit then next_cursor else null end,'projectCurrentRevisionId',p.current_revision_id);
 elsif p_action='usage' then
   return jsonb_build_object('references',(select count(*) from public.project_references where project_id=p.id and status<>'DELETED'),
     'storedBytes',(select coalesce(sum(stored_bytes),0) from public.project_references where project_id=p.id and status<>'DELETED'),
     'attemptsLastHour',project_private.reference_attempts(p.id));
 end if;
 raise invalid_parameter_value;
end;
$$;

-- Anonymous, token-authorized download. The token is verified here with the commit key, so the API needs no service-role key.
-- Every failure is the same P3107, so a probe learns nothing about which check failed.
create function public.reference_download(p_token text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare secret text; part text; sig text; payload jsonb; r public.project_references; bytes bytea; now_epoch bigint := extract(epoch from clock_timestamp())::bigint;
begin
 -- Same shape as the API's DownloadTokenSchema; PostgreSQL caps regex repetition at 255, so the length is checked separately.
 if p_token is null or length(p_token) not between 81 and 665 or p_token !~ '^[A-Za-z0-9_-]+\.[a-f0-9]{64}$' then
   raise exception using errcode='P3107',message='Invalid download link'; end if;
 part := split_part(p_token,'.',1); sig := split_part(p_token,'.',2);
 select k.secret into secret from project_private.commit_key k where singleton;
 if sig <> encode(extensions.hmac(convert_to(part,'UTF8'),decode(secret,'hex'),'sha256'),'hex') then
   raise exception using errcode='P3107',message='Invalid download link'; end if;
 begin
   payload := convert_from(decode(rpad(translate(part,'-_','+/'),((length(part)+3)/4)*4,'='),'base64'),'UTF8')::jsonb;
 exception when others then raise exception using errcode='P3107',message='Invalid download link'; end;
 if (payload->>'v'='reference-download-v1' and (payload->>'e')::bigint between now_epoch and now_epoch+901) is not true then
   raise exception using errcode='P3107',message='Invalid download link'; end if;
 select ref.* into r from public.project_references ref join public.projects pr on pr.id=ref.project_id
 where ref.id=(payload->>'r')::uuid and ref.project_id=(payload->>'p')::uuid and pr.owner_id=(payload->>'u')::uuid
   and ref.stored_sha256=payload->>'s' and ref.status<>'DELETED';
 if not found then raise exception using errcode='P3107',message='Invalid download link'; end if;
 select b.bytes into bytes from public.project_reference_blobs b where b.reference_id=r.id;
 if not found or encode(pg_catalog.sha256(bytes),'hex')<>r.stored_sha256 then raise exception using errcode='P3105',message='Reference integrity failure'; end if;
 return project_private.reference_summary(r) || jsonb_build_object('bytesBase64',encode(bytes,'base64'));
end;
$$;
revoke all on function public.reference_write(text,jsonb,text,jsonb,text,text),public.reference_read(text,uuid,uuid,integer,jsonb,jsonb),
 public.reference_download(text) from public,anon;
grant execute on function public.reference_write(text,jsonb,text,jsonb,text,text),public.reference_read(text,uuid,uuid,integer,jsonb,jsonb) to authenticated;
grant execute on function public.reference_download(text) to anon,authenticated;
revoke all on all functions in schema project_private from public,anon,authenticated;
