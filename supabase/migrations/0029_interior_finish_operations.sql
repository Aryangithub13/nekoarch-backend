-- B39 Interior (owner decision D-12, 2026-10-14): a Phase 30 operation kind for finish data on V2 spaces.
-- Additive: the kind check becomes a superset, one immutable helper is added, and revision_operation_write is replaced with the same body plus
-- INTERIOR_FINISH_MODIFY branches. Every existing row, constraint, status, transition, grant and APPEARANCE_MODIFY/RESTORE path is unchanged.
-- The finish-only lock is enforced here, not trusted from the API: the candidate and the committed model must hash as previewed, and exactly as the
-- base once every space's `finishes` is removed. A base carrying an appearance variant is refused (its compiled scene is bound to the exact model).
alter table public.project_revision_operations drop constraint project_revision_operations_kind_check;
alter table public.project_revision_operations add constraint project_revision_operations_kind_check
 check (kind in ('APPEARANCE_MODIFY','RESTORE','INTERIOR_FINISH_MODIFY'));

-- The model without any space finish: what an interior finish change may not alter. Order-insensitive (revision_model_hash canonicalises).
create function project_private.strip_space_finishes(model jsonb) returns jsonb language sql immutable strict set search_path = '' as $$
 select case when jsonb_typeof(model->'spaces') = 'array'
   then jsonb_set(model,'{spaces}',coalesce((select jsonb_agg(s - 'finishes') from jsonb_array_elements(model->'spaces') s),'[]'::jsonb))
   else model end
$$;
revoke all on function project_private.strip_space_finishes(jsonb) from public, anon, authenticated;

create or replace function public.revision_operation_write(p_action text, p_input jsonb, p_context jsonb default null, p_envelope text default null, p_signature text default null) returns jsonb
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
     and (pre->>'status' <> 'AWAITING_CONSENT' or pre->>'kind' <> 'APPEARANCE_MODIFY' or pre->>'appearanceHash' = project_private.cost_hash(pre->'appearance'))
     and (pre->>'status' <> 'AWAITING_CONSENT' or pre->>'kind' <> 'INTERIOR_FINISH_MODIFY' or (
       pre->'interior'->>'geometryModelHash' = project_private.revision_model_hash(project_private.strip_space_finishes(base.model_json))
       and pre->'interior'->>'candidateModelHash' ~ '^[a-f0-9]{64}$' and pre->'interior'->>'candidateModelHash' <> project_private.revision_model_hash(base.model_json)
       and not exists (select 1 from public.project_revision_appearances x where x.revision_id = base.id)))) is not true then
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
     elsif o.kind = 'INTERIOR_FINISH_MODIFY' then
       -- B39 Interior (0029): no compiled artifact. The candidate model must be the previewed one, and identical to the base once every space's finishes
       -- are removed; the evidence is re-derived here from stored rows and the payload model, never taken from the payload.
       pre := o.preflight_json; man := p_input->'model';
       if (jsonb_typeof(man) = 'object' and project_private.revision_model_hash(man) = pre->'interior'->>'candidateModelHash'
         and project_private.revision_model_hash(project_private.strip_space_finishes(man)) = project_private.revision_model_hash(project_private.strip_space_finishes(base.model_json))
         and pre->'interior'->>'geometryModelHash' = project_private.revision_model_hash(project_private.strip_space_finishes(base.model_json))
         and project_private.revision_model_hash(man) <> project_private.revision_model_hash(base.model_json)
         and not exists (select 1 from public.project_revision_appearances x where x.revision_id = base.id)) is not true then
         raise exception using errcode = 'P3008', message = 'Candidate is not the previewed finish-only change of the base'; end if;
       val := jsonb_build_object('status','VALID','validatorVersion','revision-interior-validator-v1','checks',3,
         'baseModelHash',project_private.revision_model_hash(base.model_json),'candidateModelHash',pre->'interior'->>'candidateModelHash',
         'geometryModelHash',pre->'interior'->>'geometryModelHash','finishOnly',true);
       if p_input->>'candidateHash' <> project_private.cost_hash(val) then raise exception using errcode = 'P3008', message = 'Candidate artifact is not bound to this operation'; end if;
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
     -- Semantic model lock: the committed geometry must be exactly the base (appearance) or the restore source. An interior commit (0029) must be the
     -- previewed candidate, and the base once every space's finishes are removed; the base must still carry no appearance variant.
     if o.kind = 'INTERIOR_FINISH_MODIFY' then
       if (p_input->'commit'->>'projectId' = p.id::text and p_input->'commit'->>'baseRevisionId' = o.base_revision_id::text
         and project_private.revision_model_hash(p_input->'commit'->'model') = o.preflight_json->'interior'->>'candidateModelHash'
         and project_private.revision_model_hash(project_private.strip_space_finishes(p_input->'commit'->'model'))
           = project_private.revision_model_hash(project_private.strip_space_finishes(base.model_json))
         and o.validation_json->>'validatorVersion' = 'revision-interior-validator-v1'
         and not exists (select 1 from public.project_revision_appearances x where x.revision_id = base.id)) is not true then
         raise exception using errcode = 'P3007', message = 'The commit violates the operation preservation lock'; end if;
     elsif (p_input->'commit'->>'projectId' = p.id::text and p_input->'commit'->>'baseRevisionId' = o.base_revision_id::text
       and project_private.revision_model_hash(p_input->'commit'->'model') = project_private.revision_model_hash(src.model_json)) is not true then
       raise exception using errcode = 'P3007', message = 'The commit violates the operation preservation lock'; end if;
     commit_result := public.project_write('revision',p_input->'commit',null,p_input->>'commitEnvelope',p_input->>'commitSignature');
     new_revision := (commit_result->'revision'->>'id')::uuid;
     if o.kind = 'INTERIOR_FINISH_MODIFY' then
       null; -- the base has no appearance variant (checked above), so there is nothing to carry
     elsif o.kind = 'APPEARANCE_MODIFY' then
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
