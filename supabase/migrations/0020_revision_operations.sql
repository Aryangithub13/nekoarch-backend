-- Phase 30: selective revision operations, candidate appearance artifacts, revision appearance layers and audit.
-- Additive only: no historical table, constraint, row or function is modified. Accepted revisions are still created exclusively
-- through public.project_write (called inside revision_operation_write), so its CAS, QA gate and audit apply unchanged.
create table public.project_revision_operations (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 created_by uuid not null,
 base_revision_id uuid not null,
 kind text check (kind in ('APPEARANCE_MODIFY','RESTORE')),
 status text not null check (status in ('AWAITING_CONSENT','NEEDS_CLARIFICATION','UNSUPPORTED','BLOCKED_BY_LOCK','CANDIDATE_READY','COMMITTED','REJECTED',
   'CANCELLED','FAILED','VALIDATION_FAILED','STALE_BASE','EXPIRED')),
 operation_version text not null check (operation_version = 'revision-operation-v1'),
 request_json jsonb not null check (octet_length(request_json::text) <= 16384),
 preflight_json jsonb not null check (octet_length(preflight_json::text) <= 262144),
 preflight_hash text not null check (preflight_hash ~ '^[a-f0-9]{64}$'),
 appearance_json jsonb,
 appearance_hash text check (appearance_hash ~ '^[a-f0-9]{64}$'),
 restore_source_revision_id uuid,
 candidate_hash text check (candidate_hash ~ '^[a-f0-9]{64}$'),
 validation_json jsonb check (validation_json is null or octet_length(validation_json::text) <= 65536),
 failure_json jsonb check (failure_json is null or octet_length(failure_json::text) <= 4096),
 committed_revision_id uuid unique references public.project_revisions(id),
 approved_by uuid,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 foreign key (project_id, base_revision_id) references public.project_revisions(project_id, id),
 foreign key (project_id, restore_source_revision_id) references public.project_revisions(project_id, id),
 check (expires_at > created_at),
 check (status in ('NEEDS_CLARIFICATION','UNSUPPORTED','BLOCKED_BY_LOCK') or kind is not null),
 check (kind is distinct from 'APPEARANCE_MODIFY' or status in ('NEEDS_CLARIFICATION','UNSUPPORTED','BLOCKED_BY_LOCK') or (appearance_json is not null and appearance_hash is not null)),
 check (kind is distinct from 'RESTORE' or status in ('NEEDS_CLARIFICATION','UNSUPPORTED','BLOCKED_BY_LOCK') or restore_source_revision_id is not null),
 check (status not in ('CANDIDATE_READY','COMMITTED') or (candidate_hash is not null and validation_json->>'status' = 'VALID')),
 check ((status = 'COMMITTED') = (committed_revision_id is not null)),
 check ((status = 'COMMITTED') = (approved_by is not null))
);
create index revision_operations_project_created_idx on public.project_revision_operations(project_id, created_at desc, id desc);
create index revision_operations_base_idx on public.project_revision_operations(base_revision_id);
create index revision_operations_active_idx on public.project_revision_operations(project_id, expires_at) where status in ('AWAITING_CONSENT','CANDIDATE_READY');

create table public.project_revision_candidate_artifacts (
 id uuid primary key default gen_random_uuid(),
 operation_id uuid not null unique references public.project_revision_operations(id),
 manifest_version text not null check (manifest_version = 'appearance-scene-manifest-v1'),
 compiler_version text not null check (compiler_version = 'appearance-compiler-v1'),
 validator_version text not null check (validator_version = 'revision-appearance-validator-v1'),
 model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
 appearance_hash text not null check (appearance_hash ~ '^[a-f0-9]{64}$'),
 binary_sha256 text not null check (binary_sha256 ~ '^[a-f0-9]{64}$'),
 binary_bytes integer not null check (binary_bytes between 32 and 16777216),
 manifest_json jsonb not null check (octet_length(manifest_json::text) <= 2621440),
 validation_json jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 check ((manifest_json->>'version' = manifest_version and manifest_json->>'compilerVersion' = compiler_version
   and manifest_json->'source'->>'modelHash' = model_hash and manifest_json->>'appearanceHash' = appearance_hash
   and manifest_json->'binary'->>'sha256' = binary_sha256 and (manifest_json->'binary'->>'bytes')::integer = binary_bytes
   and validation_json->>'status' = 'VALID' and validation_json->>'validatorVersion' = validator_version
   and (validation_json->'geometryLock'->>'identical')::boolean
   and validation_json->'geometryLock'->>'baseBinSha256' = manifest_json->'baseScene'->>'binChunkSha256'
   and validation_json->'geometryLock'->>'candidateBinSha256' = manifest_json->'baseScene'->>'binChunkSha256') is true)
);
create table public.project_revision_candidate_blobs (
 artifact_id uuid primary key references public.project_revision_candidate_artifacts(id) on delete cascade,
 glb bytea not null check (octet_length(glb) between 32 and 16777216 and substring(glb from 1 for 4) = '\x676c5446'::bytea)
);
create table public.project_revision_appearances (
 revision_id uuid primary key,
 project_id uuid not null,
 appearance_version text not null check (appearance_version = 'appearance-v1'),
 appearance_json jsonb not null check (appearance_json->>'version' = appearance_version and octet_length(appearance_json::text) <= 16384),
 appearance_hash text not null check (appearance_hash ~ '^[a-f0-9]{64}$'),
 model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
 operation_id uuid not null references public.project_revision_operations(id),
 artifact_id uuid not null references public.project_revision_candidate_artifacts(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (project_id, revision_id) references public.project_revisions(project_id, id)
);
create table public.project_revision_operation_events (
 id uuid primary key default gen_random_uuid(),
 operation_id uuid not null references public.project_revision_operations(id),
 project_id uuid not null references public.projects(id) on delete cascade,
 actor uuid,
 event_type text not null check (event_type in ('PREFLIGHT','CANDIDATE_READY','EXECUTION_FAILED','STALE_BASE','COMMITTED','REJECTED','CANCELLED','EXPIRED','PURGED')),
 detail jsonb not null check (octet_length(detail::text) <= 4096),
 created_at timestamptz not null default clock_timestamp()
);
create index revision_events_operation_idx on public.project_revision_operation_events(operation_id, created_at);

-- Lifecycle invariants live in the database: identity columns never change, only listed transitions are possible,
-- and committed artifacts/appearances are immutable.
-- Idempotency receipts for the consequential Phase 30 commands (same pattern as 0010/0014–0019).
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
 '/api/projects/:projectId/revision-operations/:operationId/cancel'));

create function project_private.revision_operation_guard() returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op = 'DELETE' then raise exception using errcode = '23514', message = 'Revision operations are retained'; end if;
 if (new.id, new.project_id, new.created_by, new.base_revision_id, new.kind, new.operation_version, new.request_json, new.preflight_json, new.preflight_hash,
     new.appearance_json, new.appearance_hash, new.restore_source_revision_id, new.created_at, new.expires_at)
   is distinct from (old.id, old.project_id, old.created_by, old.base_revision_id, old.kind, old.operation_version, old.request_json, old.preflight_json, old.preflight_hash,
     old.appearance_json, old.appearance_hash, old.restore_source_revision_id, old.created_at, old.expires_at) then
   raise exception using errcode = '23514', message = 'Revision operation identity is immutable'; end if;
 if not ((old.status = 'AWAITING_CONSENT' and new.status in ('CANDIDATE_READY','FAILED','VALIDATION_FAILED','STALE_BASE','CANCELLED','EXPIRED'))
   or (old.status = 'CANDIDATE_READY' and new.status in ('COMMITTED','REJECTED','CANCELLED','STALE_BASE','EXPIRED'))) then
   raise exception using errcode = 'P3002', message = 'Invalid revision operation transition'; end if;
 if old.status = 'CANDIDATE_READY' and (new.candidate_hash is distinct from old.candidate_hash or new.validation_json is distinct from old.validation_json) then
   raise exception using errcode = '23514', message = 'Candidate evidence is immutable'; end if;
 new.updated_at := clock_timestamp();
 return new;
end;
$$;
create trigger revision_operation_guard before update or delete on public.project_revision_operations for each row execute function project_private.revision_operation_guard();
create function project_private.revision_candidate_purgeable(op_id uuid) returns void language plpgsql set search_path = '' as $$
begin
 if exists (select 1 from public.project_revision_operations where id = op_id and status in ('AWAITING_CONSENT','CANDIDATE_READY','COMMITTED')) then
   raise exception using errcode = '23514', message = 'Only abandoned candidates can be purged'; end if;
end;
$$;
create function project_private.revision_candidate_guard() returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op = 'UPDATE' then raise exception using errcode = '23514', message = 'Candidate artifacts are immutable'; end if;
 perform project_private.revision_candidate_purgeable(old.operation_id);
 return old;
end;
$$;
create function project_private.revision_blob_guard() returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op = 'UPDATE' then raise exception using errcode = '23514', message = 'Candidate artifacts are immutable'; end if;
 perform project_private.revision_candidate_purgeable((select operation_id from public.project_revision_candidate_artifacts where id = old.artifact_id));
 return old;
end;
$$;
create trigger candidate_artifact_guard before update or delete on public.project_revision_candidate_artifacts for each row execute function project_private.revision_candidate_guard();
create trigger candidate_blob_guard before update or delete on public.project_revision_candidate_blobs for each row execute function project_private.revision_blob_guard();
create trigger appearance_immutable before update or delete on public.project_revision_appearances for each row execute function project_private.immutable_revision();
create trigger revision_event_immutable before update or delete on public.project_revision_operation_events for each row execute function project_private.immutable_revision();

alter table public.project_revision_operations enable row level security;
alter table public.project_revision_candidate_artifacts enable row level security;
alter table public.project_revision_candidate_blobs enable row level security;
alter table public.project_revision_appearances enable row level security;
alter table public.project_revision_operation_events enable row level security;
revoke all on public.project_revision_operations, public.project_revision_candidate_artifacts, public.project_revision_candidate_blobs,
 public.project_revision_appearances, public.project_revision_operation_events from public, anon, authenticated, service_role;
grant select on public.project_revision_operations, public.project_revision_candidate_artifacts, public.project_revision_appearances,
 public.project_revision_operation_events to authenticated, service_role;
create policy revision_operation_owner_read on public.project_revision_operations for select to authenticated using (
 exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy candidate_artifact_owner_read on public.project_revision_candidate_artifacts for select to authenticated using (
 exists (select 1 from public.project_revision_operations o join public.projects p on p.id = o.project_id where o.id = operation_id and p.owner_id = (select auth.uid())));
create policy appearance_owner_read on public.project_revision_appearances for select to authenticated using (
 exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy revision_event_owner_read on public.project_revision_operation_events for select to authenticated using (
 exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));

create function project_private.revision_model_hash(model jsonb) returns text language sql immutable strict set search_path = '' as $$
 select project_private.cost_hash(jsonb_build_object('identityVersion','generation-freshness-v1','model',project_private.canonical_building(model)))
$$;
create function project_private.revision_effective_status(o public.project_revision_operations) returns text language sql stable set search_path = '' as $$
 select case when o.status in ('AWAITING_CONSENT','CANDIDATE_READY') and o.expires_at <= clock_timestamp() then 'EXPIRED' else o.status end
$$;
create function project_private.revision_operation_summary(o public.project_revision_operations) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',o.id,'projectId',o.project_id,'baseRevisionId',o.base_revision_id,'kind',o.kind,'status',project_private.revision_effective_status(o),
   'operationVersion',o.operation_version,'preflightHash',o.preflight_hash,'appearanceHash',o.appearance_hash,'restoreSourceRevisionId',o.restore_source_revision_id,
   'candidateHash',o.candidate_hash,'committedRevisionId',o.committed_revision_id,'createdAt',o.created_at,'updatedAt',o.updated_at,'expiresAt',o.expires_at)
$$;
create function project_private.revision_candidate_summary(a public.project_revision_candidate_artifacts) returns jsonb language sql stable set search_path = '' as $$
 select case when a.id is null then null else jsonb_build_object('id',a.id,'operationId',a.operation_id,'manifestVersion',a.manifest_version,'compilerVersion',a.compiler_version,
   'validatorVersion',a.validator_version,'modelHash',a.model_hash,'appearanceHash',a.appearance_hash,'binarySha256',a.binary_sha256,'binaryBytes',a.binary_bytes,'createdAt',a.created_at) end
$$;
create function project_private.revision_operation_detail(o public.project_revision_operations) returns jsonb language sql stable set search_path = '' as $$
 select project_private.revision_operation_summary(o) || jsonb_build_object('request',o.request_json,'preflight',o.preflight_json,'validation',o.validation_json,'failure',o.failure_json,
   'approvedBy',o.approved_by,'candidate',(select project_private.revision_candidate_summary(a) from public.project_revision_candidate_artifacts a where a.operation_id = o.id))
$$;
create function project_private.revision_event(o public.project_revision_operations, kind text, actor uuid, detail jsonb) returns void language sql set search_path = '' as $$
 insert into public.project_revision_operation_events(operation_id,project_id,actor,event_type,detail) values(o.id,o.project_id,actor,kind,detail)
$$;

create function public.revision_operation_write(p_action text, p_input jsonb, p_context jsonb default null, p_envelope text default null, p_signature text default null) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
 uid uuid := auth.uid(); root text := '/api/projects/:projectId/revision-operations'; op text; secret text; envelope jsonb;
 receipt public.idempotency_records; p public.projects; base public.project_revisions; src public.project_revisions; o public.project_revision_operations;
 a public.project_revision_candidate_artifacts; ap public.project_revision_appearances; result jsonb; man jsonb; val jsonb; pre jsonb; glb bytea; commit_result jsonb; new_revision uuid;
begin
 if uid is null then raise insufficient_privilege; end if;
 op := case p_action when 'preflight' then root when 'candidate' then root || '/:operationId/execute' when 'fail' then root || '/:operationId/execute'
   when 'approve' then root || '/:operationId/approve' when 'reject' then root || '/:operationId/reject' when 'cancel' then root || '/:operationId/cancel' end;
 if op is null then raise invalid_parameter_value; end if;
 select k.secret into secret from project_private.commit_key k where singleton;
 if p_envelope is null or p_signature is null or p_signature <> encode(extensions.hmac(convert_to(p_envelope,'UTF8'),decode(secret,'hex'),'sha256'),'hex') then raise insufficient_privilege; end if;
 envelope := p_envelope::jsonb;
 if (envelope->>'userId' = uid::text and envelope->>'operation' = op and envelope->'input' = p_input and envelope->'context' = coalesce(p_context,'null'::jsonb)
   and (envelope->>'expiresAt')::bigint between extract(epoch from clock_timestamp())::bigint and extract(epoch from clock_timestamp())::bigint + 600) is not true then raise insufficient_privilege; end if;
 -- Ownership first, even for receipt replays; the project row lock orders preflight and approve against each other.
 select * into p from public.projects where id = (p_input->>'projectId')::uuid and owner_id = uid for update;
 if not found then raise exception using errcode = 'P1201', message = 'Project not found'; end if;
 if p_context is not null then
   if (p_context->>'operation' = op and p_context->>'keyHash' ~ '^[a-f0-9]{64}$' and p_context->>'fingerprint' ~ '^[a-f0-9]{64}$') is not true then raise invalid_parameter_value; end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text || ':' || op || ':' || (p_context->>'keyHash'),0));
   select * into receipt from public.idempotency_records where user_id = uid and operation = op and key_hash = p_context->>'keyHash';
   if found and receipt.expires_at > now() then
     if receipt.fingerprint <> p_context->>'fingerprint' then raise exception using errcode = 'P8001', message = 'Idempotency conflict'; end if;
     return receipt.response;
   end if;
   delete from public.idempotency_records where user_id = uid and operation = op and key_hash = p_context->>'keyHash';
 end if;

 if p_action = 'preflight' then
   pre := p_input->'preflight';
   select * into base from public.project_revisions where id = (p_input->>'baseRevisionId')::uuid and project_id = p.id;
   if not found then raise exception using errcode = 'P1205', message = 'Revision not found'; end if;
   if p.current_revision_id is distinct from base.id then raise exception using errcode = 'P1202', message = 'Revision conflict'; end if;
   if p.status = 'ARCHIVED' then raise exception using errcode = 'P1203', message = 'Project archived'; end if;
   if (jsonb_typeof(pre) = 'object' and pre->>'operationVersion' = 'revision-operation-v1' and pre->'base'->>'projectId' = p.id::text and pre->'base'->>'revisionId' = base.id::text
     and pre->'base'->>'modelHash' = project_private.revision_model_hash(base.model_json)
     and pre->'base'->'appearanceHash' is not distinct from coalesce((select to_jsonb(x.appearance_hash) from public.project_revision_appearances x where x.revision_id = base.id),'null'::jsonb)
     and pre->>'status' in ('AWAITING_CONSENT','NEEDS_CLARIFICATION','UNSUPPORTED','BLOCKED_BY_LOCK')
     and p_input->>'preflightHash' = project_private.cost_hash(pre)
     and (pre->>'status' <> 'AWAITING_CONSENT' or pre->>'kind' <> 'APPEARANCE_MODIFY' or pre->>'appearanceHash' = project_private.cost_hash(pre->'appearance'))) is not true then
     raise exception using errcode = 'P3008', message = 'Preflight is not bound to the base revision'; end if;
   if pre->>'status' = 'AWAITING_CONSENT' and pre->>'kind' = 'RESTORE' then
     select * into src from public.project_revisions where id = (pre->'restore'->>'sourceRevisionId')::uuid and project_id = p.id;
     if not found or pre->'restore'->>'modelHash' <> project_private.revision_model_hash(src.model_json) then
       raise exception using errcode = 'P3008', message = 'Restore source is not bound to this project'; end if;
   end if;
   if (select count(*) from public.project_revision_operations x where x.project_id = p.id and x.status in ('AWAITING_CONSENT','CANDIDATE_READY') and x.expires_at > clock_timestamp()) >= 5
     or (select count(*) from public.project_revision_operations x where x.project_id = p.id and x.created_at > clock_timestamp() - interval '1 hour') >= 60 then
     raise exception using errcode = 'P3006', message = 'Revision operation limit exceeded'; end if;
   insert into public.project_revision_operations(project_id,created_by,base_revision_id,kind,status,operation_version,request_json,preflight_json,preflight_hash,
     appearance_json,appearance_hash,restore_source_revision_id,expires_at)
   values(p.id,uid,base.id,pre->>'kind',pre->>'status','revision-operation-v1',p_input->'request',pre,p_input->>'preflightHash',
     case when pre->>'status' = 'AWAITING_CONSENT' and pre->>'kind' = 'APPEARANCE_MODIFY' then pre->'appearance' end,
     case when pre->>'status' = 'AWAITING_CONSENT' and pre->>'kind' = 'APPEARANCE_MODIFY' then pre->>'appearanceHash' end,
     case when pre->>'status' = 'AWAITING_CONSENT' and pre->>'kind' = 'RESTORE' then (pre->'restore'->>'sourceRevisionId')::uuid end,
     clock_timestamp() + interval '24 hours') returning * into o;
   perform project_private.revision_event(o,'PREFLIGHT',uid,jsonb_build_object('status',o.status,'kind',o.kind));
   result := project_private.revision_operation_detail(o);
 else
   select * into o from public.project_revision_operations where id = (p_input->>'operationId')::uuid and project_id = p.id for update;
   if not found then raise exception using errcode = 'P3001', message = 'Revision operation not found'; end if;
   if o.status in ('AWAITING_CONSENT','CANDIDATE_READY') and o.expires_at <= clock_timestamp() then
     update public.project_revision_operations set status = 'EXPIRED' where id = o.id returning * into o;
     perform project_private.revision_event(o,'EXPIRED',uid,'{}');
     return jsonb_build_object('conflict','EXPIRED','operation',project_private.revision_operation_detail(o));
   end if;
   if p_action in ('candidate','fail','approve') and p_input->>'preflightHash' is distinct from o.preflight_hash then
     raise exception using errcode = 'P3005', message = 'The consent does not match the stored preflight'; end if;
   if p_action = 'candidate' then
     if o.status = 'CANDIDATE_READY' and o.candidate_hash = p_input->>'candidateHash' then return project_private.revision_operation_detail(o); end if;
     if o.status <> 'AWAITING_CONSENT' then raise exception using errcode = 'P3002', message = 'Invalid revision operation transition'; end if;
     if p.current_revision_id is distinct from o.base_revision_id then
       update public.project_revision_operations set status = 'STALE_BASE' where id = o.id returning * into o;
       perform project_private.revision_event(o,'STALE_BASE',uid,jsonb_build_object('currentRevisionId',p.current_revision_id));
       return jsonb_build_object('conflict','STALE_BASE','operation',project_private.revision_operation_detail(o));
     end if;
     select * into base from public.project_revisions where id = o.base_revision_id;
     if o.kind = 'APPEARANCE_MODIFY' then
       man := p_input->'manifest'; val := p_input->'validation';
       begin glb := decode(p_input->>'glbBase64','base64'); exception when others then raise exception using errcode = 'P3008', message = 'Candidate binary is not base64'; end;
       if (jsonb_typeof(man) = 'object' and jsonb_typeof(val) = 'object' and man->'source'->>'projectId' = p.id::text and man->'source'->>'revisionId' = base.id::text
         and man->'source'->>'modelHash' = project_private.revision_model_hash(base.model_json)
         and man->'source'->'generatorVersion' is not distinct from coalesce(to_jsonb(base.generator_version),'null'::jsonb)
         and man->'appearance' = o.appearance_json and man->>'appearanceHash' = o.appearance_hash
         and man->'scene'->'source' = man->'source' and man->'scene'->'binary'->>'sha256' = man->'baseScene'->>'glbSha256'
         and octet_length(glb) = (man->'binary'->>'bytes')::integer and encode(pg_catalog.sha256(glb),'hex') = man->'binary'->>'sha256'
         and p_input->>'candidateHash' = project_private.cost_hash(man)
         and val->>'status' = 'VALID' and val->>'validatorVersion' = 'revision-appearance-validator-v1' and (val->'geometryLock'->>'identical')::boolean) is not true then
         raise exception using errcode = 'P3008', message = 'Candidate artifact is not bound to this operation'; end if;
       insert into public.project_revision_candidate_artifacts(operation_id,manifest_version,compiler_version,validator_version,model_hash,appearance_hash,binary_sha256,binary_bytes,manifest_json,validation_json)
       values(o.id,man->>'version',man->>'compilerVersion',val->>'validatorVersion',man->'source'->>'modelHash',man->>'appearanceHash',man->'binary'->>'sha256',
         (man->'binary'->>'bytes')::integer,man,val) returning * into a;
       insert into public.project_revision_candidate_blobs(artifact_id,glb) values(a.id,glb);
     else
       -- Restore: the candidate is the source revision's design state, re-derived here from stored rows (nothing trusted from the payload).
       select * into src from public.project_revisions where id = o.restore_source_revision_id;
       select * into ap from public.project_revision_appearances where revision_id = src.id;
       val := jsonb_build_object('status','VALID','validatorVersion','revision-restore-validator-v1','checks',2,
         'sourceRevisionId',src.id,'sourceModelHash',project_private.revision_model_hash(src.model_json),'sourceAppearanceHash',ap.appearance_hash);
       if p_input->>'candidateHash' <> project_private.cost_hash(val) then raise exception using errcode = 'P3008', message = 'Candidate artifact is not bound to this operation'; end if;
     end if;
     update public.project_revision_operations set status = 'CANDIDATE_READY', candidate_hash = p_input->>'candidateHash', validation_json = val where id = o.id returning * into o;
     perform project_private.revision_event(o,'CANDIDATE_READY',uid,jsonb_build_object('candidateHash',o.candidate_hash));
     result := project_private.revision_operation_detail(o);
   elsif p_action = 'fail' then
     if o.status <> 'AWAITING_CONSENT' or p_input->>'status' not in ('FAILED','VALIDATION_FAILED') then raise exception using errcode = 'P3002', message = 'Invalid revision operation transition'; end if;
     update public.project_revision_operations set status = p_input->>'status', failure_json = p_input->'failure' where id = o.id returning * into o;
     perform project_private.revision_event(o,'EXECUTION_FAILED',uid,coalesce(p_input->'failure','{}'::jsonb));
     result := project_private.revision_operation_detail(o);
   elsif p_action = 'approve' then
     if o.status = 'COMMITTED' then raise exception using errcode = 'P3003', message = 'Revision operation already committed'; end if;
     if o.status <> 'CANDIDATE_READY' then raise exception using errcode = 'P3002', message = 'Invalid revision operation transition'; end if;
     if p_input->>'candidateHash' is distinct from o.candidate_hash then raise exception using errcode = 'P3005', message = 'The approval does not match the reviewed candidate'; end if;
     if p.current_revision_id is distinct from o.base_revision_id then
       update public.project_revision_operations set status = 'STALE_BASE' where id = o.id returning * into o;
       perform project_private.revision_event(o,'STALE_BASE',uid,jsonb_build_object('currentRevisionId',p.current_revision_id));
       return jsonb_build_object('conflict','STALE_BASE','operation',project_private.revision_operation_detail(o));
     end if;
     select * into base from public.project_revisions where id = o.base_revision_id;
     if o.kind = 'RESTORE' then select * into src from public.project_revisions where id = o.restore_source_revision_id; else src := base; end if;
     -- Semantic model lock: the committed geometry must be exactly the base (appearance) or the restore source.
     if (p_input->'commit'->>'projectId' = p.id::text and p_input->'commit'->>'baseRevisionId' = o.base_revision_id::text
       and project_private.revision_model_hash(p_input->'commit'->'model') = project_private.revision_model_hash(src.model_json)) is not true then
       raise exception using errcode = 'P3007', message = 'The commit violates the operation preservation lock'; end if;
     commit_result := public.project_write('revision',p_input->'commit',null,p_input->>'commitEnvelope',p_input->>'commitSignature');
     new_revision := (commit_result->'revision'->>'id')::uuid;
     if o.kind = 'APPEARANCE_MODIFY' then
       select * into a from public.project_revision_candidate_artifacts where operation_id = o.id;
       insert into public.project_revision_appearances(revision_id,project_id,appearance_version,appearance_json,appearance_hash,model_hash,operation_id,artifact_id)
       values(new_revision,p.id,'appearance-v1',o.appearance_json,o.appearance_hash,a.model_hash,o.id,a.id);
     else
       select * into ap from public.project_revision_appearances where revision_id = src.id;
       if found then
         insert into public.project_revision_appearances(revision_id,project_id,appearance_version,appearance_json,appearance_hash,model_hash,operation_id,artifact_id)
         values(new_revision,p.id,ap.appearance_version,ap.appearance_json,ap.appearance_hash,ap.model_hash,o.id,ap.artifact_id);
       end if;
     end if;
     update public.project_revision_operations set status = 'COMMITTED', committed_revision_id = new_revision, approved_by = uid where id = o.id returning * into o;
     perform project_private.revision_event(o,'COMMITTED',uid,jsonb_build_object('baseRevisionId',o.base_revision_id,'committedRevisionId',new_revision,'candidateHash',o.candidate_hash));
     result := jsonb_build_object('operation',project_private.revision_operation_detail(o),'commit',commit_result);
   else
     if not ((p_action = 'reject' and o.status = 'CANDIDATE_READY') or (p_action = 'cancel' and o.status in ('AWAITING_CONSENT','CANDIDATE_READY'))) then
       raise exception using errcode = 'P3002', message = 'Invalid revision operation transition'; end if;
     update public.project_revision_operations set status = case p_action when 'reject' then 'REJECTED' else 'CANCELLED' end where id = o.id returning * into o;
     perform project_private.revision_event(o,o.status,uid,'{}');
     result := project_private.revision_operation_detail(o);
   end if;
 end if;
 if p_context is not null then
   insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response) values(uid,op,p_context->>'keyHash',p_context->>'fingerprint',result);
 end if;
 return result;
end;
$$;

create function public.revision_operation_read(p_action text, p_project_id uuid, p_operation_id uuid default null, p_revision_id uuid default null,
 p_limit integer default 20, p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); p public.projects; o public.project_revision_operations; a public.project_revision_candidate_artifacts; ap public.project_revision_appearances;
 bytes bytea; items jsonb; total integer; next_cursor jsonb;
begin
 if uid is null then raise insufficient_privilege; end if;
 if p_limit is null or p_limit < 1 or p_limit > 100 then raise invalid_parameter_value; end if;
 select * into p from public.projects where id = p_project_id and owner_id = uid;
 if not found then raise exception using errcode = 'P1201', message = 'Project not found'; end if;
 if p_action = 'list' then
   with page as (select * from public.project_revision_operations where project_id = p.id
     and (p_cursor is null or (created_at,id) < ((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid)) order by created_at desc,id desc limit p_limit+1),
   shown as (select * from page order by created_at desc,id desc limit p_limit)
   select (select count(*) from page),coalesce(jsonb_agg(project_private.revision_operation_summary(shown) order by created_at desc,id desc),'[]'::jsonb),
     (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) into total,items,next_cursor from shown;
   return jsonb_build_object('items',items,'nextCursor',case when total > p_limit then next_cursor else null end);
 end if;
 if p_action in ('appearance','appearance-glb','lineage') then
   if not exists (select 1 from public.project_revisions where id = p_revision_id and project_id = p.id) then raise exception using errcode = 'P1205', message = 'Revision not found'; end if;
   if p_action = 'lineage' then
     select * into o from public.project_revision_operations where committed_revision_id = p_revision_id;
     return jsonb_build_object('operation',case when found then project_private.revision_operation_summary(o) end,
       'modelEquivalentToBase',case when found then (select project_private.revision_model_hash(b.model_json) = project_private.revision_model_hash(c.model_json)
         from public.project_revisions b, public.project_revisions c where b.id = o.base_revision_id and c.id = p_revision_id) end);
   end if;
   select * into ap from public.project_revision_appearances where revision_id = p_revision_id;
   if not found then
     if p_action = 'appearance-glb' then raise exception using errcode = 'P3001', message = 'No appearance artifact for this revision'; end if;
     return jsonb_build_object('revisionId',p_revision_id,'appearance',null,'appearanceHash',null,'modelHash',null,'operationId',null,'artifact',null,'manifest',null);
   end if;
   select * into a from public.project_revision_candidate_artifacts where id = ap.artifact_id;
   if p_action = 'appearance-glb' then
     select glb into bytes from public.project_revision_candidate_blobs where artifact_id = a.id;
     if not found or encode(pg_catalog.sha256(bytes),'hex') <> a.binary_sha256 then raise exception using errcode = 'P3009', message = 'Appearance binary integrity failure'; end if;
     return project_private.revision_candidate_summary(a) || jsonb_build_object('glbBase64',encode(bytes,'base64'));
   end if;
   return jsonb_build_object('revisionId',p_revision_id,'appearance',ap.appearance_json,'appearanceHash',ap.appearance_hash,'modelHash',ap.model_hash,'operationId',ap.operation_id,
     'artifact',project_private.revision_candidate_summary(a),'manifest',a.manifest_json);
 end if;
 select * into o from public.project_revision_operations where id = p_operation_id and project_id = p.id;
 if not found then raise exception using errcode = 'P3001', message = 'Revision operation not found'; end if;
 if p_action = 'get' then return project_private.revision_operation_detail(o); end if;
 if p_action = 'events' then
   return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'eventType',e.event_type,'actor',e.actor,'detail',e.detail,'createdAt',e.created_at) order by e.created_at,e.id)
     from public.project_revision_operation_events e where e.operation_id = o.id),'[]'::jsonb);
 end if;
 select * into a from public.project_revision_candidate_artifacts where operation_id = o.id;
 if not found then raise exception using errcode = 'P3001', message = 'No candidate artifact for this operation'; end if;
 if p_action = 'candidate' then return jsonb_build_object('operation',project_private.revision_operation_summary(o),'artifact',project_private.revision_candidate_summary(a),'manifest',a.manifest_json); end if;
 if p_action = 'candidate-glb' then
   select glb into bytes from public.project_revision_candidate_blobs where artifact_id = a.id;
   if not found then raise exception using errcode = 'P3001', message = 'No candidate artifact for this operation'; end if;
   if encode(pg_catalog.sha256(bytes),'hex') <> a.binary_sha256 then raise exception using errcode = 'P3009', message = 'Candidate binary integrity failure'; end if;
   return jsonb_build_object('operation',project_private.revision_operation_summary(o),'artifact',project_private.revision_candidate_summary(a),'glbBase64',encode(bytes,'base64'));
 end if;
 raise invalid_parameter_value;
end;
$$;

-- Retention: expire abandoned operations and delete bytes of candidates that can never be committed. Committed artifacts are protected by
-- the guard trigger and by the appearance foreign key. Intended for a scheduled service-role job.
create function public.revision_operation_purge(p_older_than interval default interval '7 days') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare expired integer; purged integer;
begin
 with x as (update public.project_revision_operations set status = 'EXPIRED' where status in ('AWAITING_CONSENT','CANDIDATE_READY') and expires_at <= clock_timestamp() returning *)
 select count(*) into expired from x;
 with doomed as (select a.id from public.project_revision_candidate_artifacts a join public.project_revision_operations o on o.id = a.operation_id
   where o.status in ('REJECTED','CANCELLED','EXPIRED','FAILED','VALIDATION_FAILED','STALE_BASE') and o.updated_at <= clock_timestamp() - p_older_than
     and not exists (select 1 from public.project_revision_appearances x where x.artifact_id = a.id)),
 gone as (delete from public.project_revision_candidate_artifacts where id in (select id from doomed) returning id)
 select count(*) into purged from gone;
 return jsonb_build_object('expired',expired,'purgedArtifacts',purged);
end;
$$;
revoke all on function public.revision_operation_write(text,jsonb,jsonb,text,text) from public;
revoke all on function public.revision_operation_read(text,uuid,uuid,uuid,integer,jsonb) from public;
revoke all on function public.revision_operation_purge(interval) from public, anon, authenticated;
grant execute on function public.revision_operation_write(text,jsonb,jsonb,text,text) to authenticated;
grant execute on function public.revision_operation_read(text,uuid,uuid,uuid,integer,jsonb) to authenticated;
grant execute on function public.revision_operation_purge(interval) to service_role;
revoke all on all functions in schema project_private from public, anon, authenticated;
