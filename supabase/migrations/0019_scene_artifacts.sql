-- Phase 29: immutable, owner-only 3D scene artifacts (manifest + GLB) bound to an accepted revision.
-- Scenes visualize architecture; no row here changes a revision, the current revision, BIM or any analysis.
-- Additive only: no historical migration, row or identity is rewritten. Mirrors 0018.
create table public.project_revision_scene_artifacts (
 id uuid primary key default gen_random_uuid(),
 project_revision_id uuid not null references public.project_revisions(id),
 acceptance_qa_id uuid not null,
 manifest_version text not null check (manifest_version = 'scene-manifest-v1'),
 compiler_version text not null check (compiler_version = 'scene-compiler-v1'),
 validator_version text not null check (validator_version = 'scene-validator-v1'),
 model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
 input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
 scene_hash text not null check (scene_hash ~ '^[a-f0-9]{64}$'),
 binary_sha256 text not null check (binary_sha256 ~ '^[a-f0-9]{64}$'),
 binary_bytes integer not null check (binary_bytes between 32 and 16777216),
 storage_locator text not null check (storage_locator = 'postgres-bytea'),
 -- A row exists only once its bytes exist and their hash was verified in the same transaction.
 status text not null check (status = 'READY'),
 object_count integer not null check (object_count between 1 and 2048),
 triangle_count integer not null check (triangle_count between 1 and 200000),
 validation_json jsonb not null,
 manifest_json jsonb not null check (octet_length(manifest_json::text) <= 2097152),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (project_revision_id, acceptance_qa_id) references public.project_revision_qa_runs(revision_id,id),
 unique (project_revision_id,input_hash),
 check ((jsonb_typeof(manifest_json) = 'object' and manifest_json->>'version' = manifest_version and manifest_json->>'compilerVersion' = compiler_version
   and manifest_json->'source'->>'revisionId' = project_revision_id::text and manifest_json->'source'->>'modelHash' = model_hash
   and manifest_json->>'inputHash' = input_hash and manifest_json->'binary'->>'sha256' = binary_sha256 and (manifest_json->'binary'->>'bytes')::integer = binary_bytes
   and (manifest_json->'statistics'->>'objects')::integer = object_count and (manifest_json->'statistics'->>'triangles')::integer = triangle_count
   and validation_json->>'status' = 'VALID' and validation_json->>'validatorVersion' = validator_version and (validation_json->>'checks')::integer > 0
   and manifest_json->'claims' = jsonb_build_object('photorealism','NOT_CLAIMED','structuralCompliance','NOT_CLAIMED','fireCodeCompliance','NOT_CLAIMED',
     'egress','NOT_CLAIMED','accessibility','NOT_CLAIMED','materialPerformance','NOT_CLAIMED','constructionReadiness','NOT_CLAIMED')
   and not jsonb_path_exists(manifest_json,'$.overlays[*] ? (@.status != "NOT_EVALUATED")')
   and not jsonb_path_exists(manifest_json,'$.materials[*] ? (@.provenance != "VISUAL_PLACEHOLDER")')) is true)
);
-- GLB bytes: reachable only through scene_read (no policy, no grant); never a public or raw storage URL.
create table public.project_revision_scene_blobs (
 artifact_id uuid primary key references public.project_revision_scene_artifacts(id),
 glb bytea not null check (octet_length(glb) between 32 and 16777216 and substring(glb from 1 for 4) = '\x676c5446'::bytea)
);
create index scene_revision_created_idx on public.project_revision_scene_artifacts(project_revision_id,created_at desc,id desc);
create index scene_acceptance_qa_idx on public.project_revision_scene_artifacts(acceptance_qa_id);
alter table public.project_revision_scene_artifacts enable row level security;
alter table public.project_revision_scene_blobs enable row level security;
revoke all on public.project_revision_scene_artifacts from public,anon,authenticated,service_role;
revoke all on public.project_revision_scene_blobs from public,anon,authenticated,service_role;
grant select on public.project_revision_scene_artifacts to authenticated,service_role;
create policy scene_owner_read on public.project_revision_scene_artifacts for select to authenticated using (
 exists (select 1 from public.project_revisions r join public.projects p on p.id=r.project_id
 where r.id=project_revision_id and p.owner_id=(select auth.uid()))
);
create trigger scene_artifact_immutable before update or delete on public.project_revision_scene_artifacts
 for each row execute function project_private.immutable_revision();
create trigger scene_blob_immutable before update or delete on public.project_revision_scene_blobs
 for each row execute function project_private.immutable_revision();

create function project_private.scene_summary(a public.project_revision_scene_artifacts) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',a.id,'projectRevisionId',a.project_revision_id,'acceptanceQaId',a.acceptance_qa_id,'manifestVersion',a.manifest_version,
 'compilerVersion',a.compiler_version,'validatorVersion',a.validator_version,'modelHash',a.model_hash,'inputHash',a.input_hash,'sceneHash',a.scene_hash,
 'binarySha256',a.binary_sha256,'binaryBytes',a.binary_bytes,'storageLocator',a.storage_locator,'status',a.status,'objectCount',a.object_count,
 'triangleCount',a.triangle_count,'createdAt',a.created_at)
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
 '/api/projects/:projectId/revisions/:revisionId/scene/artifacts'));

create function public.scene_write(p_input jsonb,p_glb_base64 text,p_context jsonb default null,p_envelope text default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
 uid uuid := auth.uid(); op text := '/api/projects/:projectId/revisions/:revisionId/scene/artifacts';
 secret text; envelope jsonb; r public.project_revisions; q public.project_revision_qa_runs; a public.project_revision_scene_artifacts;
 receipt public.idempotency_records; man jsonb := p_input->'manifest'; val jsonb := p_input->'validation'; glb bytea; result jsonb; kind text;
begin
 if uid is null then raise insufficient_privilege; end if;
 select k.secret into secret from project_private.commit_key k where singleton;
 if p_envelope is null or p_signature is null or
 p_signature <> encode(extensions.hmac(convert_to(p_envelope,'UTF8'),decode(secret,'hex'),'sha256'),'hex') then raise insufficient_privilege; end if;
 envelope := p_envelope::jsonb;
 if (envelope->>'userId'=uid::text and envelope->>'operation'=op and envelope->'input'=p_input
 and envelope->'context'=coalesce(p_context,'null'::jsonb)
 and (envelope->>'expiresAt')::bigint between extract(epoch from clock_timestamp())::bigint and extract(epoch from clock_timestamp())::bigint+600) is not true then raise insufficient_privilege; end if;
 -- Ownership is checked even for a receipt replay.
 if not exists(select 1 from public.projects where id=(p_input->>'projectId')::uuid and owner_id=uid) then
 raise exception using errcode='P1201',message='Project not found'; end if;
 select * into r from public.project_revisions where id=(p_input->>'projectRevisionId')::uuid and project_id=(p_input->>'projectId')::uuid;
 if not found then raise exception using errcode='P1205',message='Revision not found'; end if;
 select * into q from public.project_revision_qa_runs where id=r.acceptance_qa_id and revision_id=r.id;
 if (q.status in ('PASS','PASS_WITH_WARNINGS') and q.report_json->>'inputStatus'='SCHEMA_VALID'
 and q.report_json->'summary'->>'errors'='0' and p_input->>'acceptanceQaId'=q.id::text) is not true then
 raise exception using errcode='P2902',message='Revision not accepted'; end if;
 if p_context is not null then
   if (p_context->>'operation'=op and p_context->>'keyHash' ~ '^[a-f0-9]{64}$' and p_context->>'fingerprint' ~ '^[a-f0-9]{64}$') is not true then raise invalid_parameter_value; end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text || ':' || op || ':' || (p_context->>'keyHash'),0));
   select * into receipt from public.idempotency_records where user_id=uid and operation=op and key_hash=p_context->>'keyHash';
   if found and receipt.expires_at>now() then
     if receipt.fingerprint<>p_context->>'fingerprint' then raise exception using errcode='P8001',message='Idempotency conflict'; end if;
     return receipt.response;
   end if;
   delete from public.idempotency_records where user_id=uid and operation=op and key_hash=p_context->>'keyHash';
 end if;
 -- Binding is recomputed from the stored revision, never trusted from the payload. The manifest carries only integers, strings and booleans,
 -- so inputHash and sceneHash recompute byte-identically in SQL (design §8); the bytes must hash to the signed manifest.
 begin glb := decode(p_glb_base64,'base64'); exception when others then raise exception using errcode='P2903',message='Scene binary is not base64'; end;
 if (jsonb_typeof(man)='object' and jsonb_typeof(val)='object'
 and man->'source'->>'projectId'=r.project_id::text and man->'source'->>'revisionId'=r.id::text
 and man->'source'->>'modelHash'=project_private.cost_hash(jsonb_build_object('identityVersion','generation-freshness-v1','model',project_private.canonical_building(r.model_json)))
 and (r.generation_identity is null or man->'source'->>'modelHash'=r.generation_identity->>'modelHash')
 and man->'source'->'generatorVersion' is not distinct from coalesce(to_jsonb(r.generator_version),'null'::jsonb)
 and man->'source'->'parameterHash' = case when r.model_json ? 'parametricArchitecture' then to_jsonb(project_private.cost_hash(r.model_json->'parametricArchitecture')) else 'null'::jsonb end
 and man->>'inputHash'=project_private.cost_hash(jsonb_build_object('compilerVersion',man->'compilerVersion','manifestVersion',man->'version','source',man->'source'))
 and p_input->>'sceneHash'=project_private.cost_hash(man - 'binary')
 and octet_length(glb)=(man->'binary'->>'bytes')::integer and octet_length(glb) between 32 and 16777216
 and substring(glb from 1 for 4)='\x676c5446'::bytea and encode(pg_catalog.sha256(glb),'hex')=man->'binary'->>'sha256'
 and val->>'status'='VALID') is not true then
 raise exception using errcode='P2903',message='Scene artifact is not bound to this revision'; end if;
 -- Coverage: every modeled architectural entity appears exactly once (no silently skipped element).
 foreach kind in array array['level','space','wall','opening','slab','stair'] loop
   if (select count(*) from jsonb_array_elements(man->'coverage') c where c->>'entityType'=kind)
      <> jsonb_array_length(coalesce(r.model_json->(case kind when 'space' then 'spaces' when 'level' then 'levels' when 'wall' then 'walls'
        when 'opening' then 'openings' when 'slab' then 'slabs' else 'stairs' end),'[]'::jsonb)) then
     raise exception using errcode='P2903',message='Scene coverage does not match the revision'; end if;
 end loop;
 -- Concurrent identical requests converge on one immutable artifact.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('scene:' || r.id::text || ':' || (man->>'inputHash'),0));
 select * into a from public.project_revision_scene_artifacts where project_revision_id=r.id and input_hash=man->>'inputHash';
 if found then
   if a.scene_hash<>p_input->>'sceneHash' or a.binary_sha256<>man->'binary'->>'sha256' then
     raise exception using errcode='P2903',message='Nondeterministic scene for an identical input'; end if;
 else
   insert into public.project_revision_scene_artifacts(project_revision_id,acceptance_qa_id,manifest_version,compiler_version,validator_version,model_hash,input_hash,
     scene_hash,binary_sha256,binary_bytes,storage_locator,status,object_count,triangle_count,validation_json,manifest_json)
   values(r.id,q.id,man->>'version',man->>'compilerVersion',val->>'validatorVersion',man->'source'->>'modelHash',man->>'inputHash',p_input->>'sceneHash',
     man->'binary'->>'sha256',(man->'binary'->>'bytes')::integer,'postgres-bytea','READY',(man->'statistics'->>'objects')::integer,
     (man->'statistics'->>'triangles')::integer,val,man)
   returning * into a;
   insert into public.project_revision_scene_blobs(artifact_id,glb) values(a.id,glb);
 end if;
 result := project_private.scene_summary(a) || jsonb_build_object('manifest',a.manifest_json);
 if p_context is not null then
   insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response)
   values(uid,op,p_context->>'keyHash',p_context->>'fingerprint',result);
 end if;
 return result;
end;
$$;

create function public.scene_read(p_action text,p_project_id uuid,p_revision_id uuid,p_artifact_id uuid default null,p_limit integer default 20,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.project_revision_scene_artifacts; p public.projects; items jsonb; next_cursor jsonb; total integer; revision_number integer; bytes bytea;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into p from public.projects where id=p_project_id and owner_id=auth.uid();
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 select r.revision_number into revision_number from public.project_revisions r where r.id=p_revision_id and r.project_id=p_project_id;
 if not found then raise exception using errcode='P1205',message='Revision not found'; end if;
 if p_action in ('get','glb') then
   select * into a from public.project_revision_scene_artifacts where id=p_artifact_id and project_revision_id=p_revision_id and status='READY';
   if not found then raise exception using errcode='P2901',message='Scene artifact not found'; end if;
   if p_action='get' then
     return project_private.scene_summary(a) || jsonb_build_object('manifest',a.manifest_json,'projectCurrentRevisionId',p.current_revision_id);
   end if;
   select b.glb into bytes from public.project_revision_scene_blobs b where b.artifact_id=a.id;
   if not found or encode(pg_catalog.sha256(bytes),'hex')<>a.binary_sha256 then raise exception using errcode='P2903',message='Scene binary integrity failure'; end if;
   return project_private.scene_summary(a) || jsonb_build_object('glbBase64',encode(bytes,'base64'),'projectCurrentRevisionId',p.current_revision_id);
 elsif p_action='list' then
   if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value; end if;
   with page as (select * from public.project_revision_scene_artifacts where project_revision_id=p_revision_id
     and (p_cursor is null or (created_at,id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
     order by created_at desc,id desc limit p_limit+1),
   shown as (select * from page order by created_at desc,id desc limit p_limit)
   select (select count(*) from page),coalesce(jsonb_agg(project_private.scene_summary(shown) order by created_at desc,id desc),'[]'::jsonb),
   (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) into total,items,next_cursor from shown;
   return jsonb_build_object('items',items,'nextCursor',case when total>p_limit then next_cursor else null end,'projectCurrentRevisionId',p.current_revision_id);
 elsif p_action='status' then
   return jsonb_build_object('projectCurrentRevisionId',p.current_revision_id,'revisionNumber',revision_number,
     'artifacts',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id desc) from (
       select project_private.scene_summary(s) item,s.created_at,s.id from public.project_revision_scene_artifacts s
       where s.project_revision_id=p_revision_id order by s.created_at desc,s.id desc limit 20) x),'[]'::jsonb),
     'otherRevisionArtifacts',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id desc) from (
       select project_private.scene_summary(s) || jsonb_build_object('revisionNumber',r.revision_number) item,s.created_at,s.id
       from public.project_revision_scene_artifacts s join public.project_revisions r on r.id=s.project_revision_id
       where r.project_id=p_project_id and r.id<>p_revision_id order by s.created_at desc,s.id desc limit 20) x),'[]'::jsonb));
 end if;
 raise invalid_parameter_value;
end;
$$;
revoke all on function public.scene_write(jsonb,text,jsonb,text,text),public.scene_read(text,uuid,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.scene_write(jsonb,text,jsonb,text,text),public.scene_read(text,uuid,uuid,uuid,integer,jsonb) to authenticated;
revoke all on all functions in schema project_private from public,anon,authenticated;
