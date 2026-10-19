-- Audit B INT-B-014 and INT-B-013 for B44 (0030). Forward-only: 0030 is on the integrated line, so it is not edited again.
-- (1) Idempotency-Key receipts for comment and review posts and member removal: a retried comment was stored twice, counted against the
--     200-comment cap, and could never be deleted (comments and reviews are immutable). The receipt is read after the per-project lock, so
--     concurrent retries with one key store one row.
-- (2) The workspace says when its revision list (newest 100) is truncated. Members (20), comments (200) and reviews (100) are capped at
--     exactly the read limits by collaboration_write, so they cannot be truncated.
-- Behaviour without an Idempotency-Key is unchanged. collaboration_write gains a trailing p_context argument (default null); the old
-- four-argument function is dropped so a call by name resolves to exactly one function.

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
 '/api/projects/:projectId/references/:referenceId',
 '/api/projects/:projectId/jobs',
 '/api/projects/:projectId/brief/versions',
 '/api/projects/:projectId/collaboration/members/:userId',
 '/api/projects/:projectId/collaboration/revisions/:revisionId/comments',
 '/api/projects/:projectId/collaboration/revisions/:revisionId/reviews'));

create or replace function public.collaboration_read(p_action text, p_project_id uuid, p_revision_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); role text; p public.projects; r public.project_revisions; parent public.project_revisions; op public.project_revision_operations;
begin
 if uid is null then raise insufficient_privilege; end if;
 role := project_private.project_role(p_project_id, uid);
 if role is null then raise exception using errcode = 'P1201', message = 'Project not found'; end if;
 select * into p from public.projects where id = p_project_id;
 if p_action = 'workspace' then
   return jsonb_build_object('project', jsonb_build_object('id', p.id, 'title', p.title, 'status', p.status, 'currentRevisionId', p.current_revision_id),
     'role', role,
     'members', coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id, 'role', m.role, 'addedBy', m.added_by, 'createdAt', m.created_at, 'updatedAt', m.updated_at)
       order by m.created_at, m.user_id) from public.project_members m where m.project_id = p.id and m.removed_at is null), '[]'::jsonb),
     'revisions', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'revisionNumber', x.revision_number, 'parentRevisionId', x.parent_revision_id,
       'sourceMode', x.source_mode, 'createdBy', x.created_by, 'createdAt', x.created_at) order by x.revision_number desc)
       from (select * from public.project_revisions where project_id = p.id order by revision_number desc limit 100) x), '[]'::jsonb),
     'revisionsTruncated', exists (select 1 from public.project_revisions where project_id = p.id order by revision_number desc offset 100));
 elsif p_action = 'revision' then
   select * into r from public.project_revisions where project_id = p_project_id and id = p_revision_id;
   if not found then raise exception using errcode = 'P1205', message = 'Revision not found'; end if;
   select * into parent from public.project_revisions where project_id = p_project_id and id = r.parent_revision_id;
   select * into op from public.project_revision_operations where project_id = p_project_id and committed_revision_id = r.id;
   return jsonb_build_object('role', role,
     'revision', jsonb_build_object('id', r.id, 'revisionNumber', r.revision_number, 'parentRevisionId', r.parent_revision_id, 'sourceMode', r.source_mode,
       'generatorVersion', r.generator_version, 'createdBy', r.created_by, 'createdAt', r.created_at, 'model', r.model_json),
     'parentModel', case when parent.id is null then null else parent.model_json end,
     'operation', case when op.id is null then null else jsonb_build_object('operationId', op.id, 'kind', op.kind, 'createdBy', op.created_by, 'approvedBy', op.approved_by,
       'request', op.request_json, 'createdAt', op.created_at,
       'events', coalesce((select jsonb_agg(jsonb_build_object('eventType', e.event_type, 'actor', e.actor, 'createdAt', e.created_at) order by e.created_at, e.id)
         from public.project_revision_operation_events e where e.operation_id = op.id), '[]'::jsonb)) end,
     'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'authorId', c.author_id, 'authorRole', c.author_role, 'kind', c.kind, 'body', c.body,
       'elementIds', to_jsonb(c.element_ids), 'parentId', c.parent_id, 'createdAt', c.created_at) order by c.created_at, c.id)
       from (select * from public.project_revision_comments where revision_id = r.id order by created_at, id limit 200) c), '[]'::jsonb),
     'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'reviewerId', v.reviewer_id, 'reviewerRole', v.reviewer_role, 'decision', v.decision, 'note', v.note,
       'modelHash', v.model_hash, 'createdAt', v.created_at) order by v.created_at, v.id)
       from (select * from public.project_revision_reviews where revision_id = r.id order by created_at, id limit 100) v), '[]'::jsonb));
 end if;
 raise invalid_parameter_value;
end;
$$;

drop function public.collaboration_write(text, jsonb, text, text);
create function public.collaboration_write(p_action text, p_input jsonb, p_envelope text, p_signature text, p_context jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); pid uuid := (p_input->>'projectId')::uuid; role text; m public.project_members; c public.project_revision_comments;
 v public.project_revision_reviews; r public.project_revisions; ids text[]; parent public.project_revision_comments; receipt public.idempotency_records; result jsonb;
 -- The route each action signs for; member removal, comments and reviews also keep Idempotency-Key receipts under it.
 route text := case p_action when 'member_upsert' then '/api/projects/:projectId/collaboration/members'
   when 'member_remove' then '/api/projects/:projectId/collaboration/members/:userId'
   when 'comment' then '/api/projects/:projectId/collaboration/revisions/:revisionId/comments'
   when 'review' then '/api/projects/:projectId/collaboration/revisions/:revisionId/reviews' end;
begin
 if uid is null then raise insufficient_privilege; end if;
 if route is null or (p_context is not null and p_action = 'member_upsert') then raise invalid_parameter_value; end if;
 role := project_private.project_role(pid, uid);
 if role is null then raise exception using errcode = 'P1201', message = 'Project not found'; end if;
 -- Serialize collaboration writes per project, so the member, comment and review caps below hold under concurrency (count then insert),
 -- and so concurrent retries with one Idempotency-Key find the first one's receipt.
 -- A transaction-scoped advisory lock, not FOR UPDATE on projects, which would also block other writers' foreign-key checks.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collaboration:' || pid::text, 0));
 perform project_private.verify_envelope(route, p_input, p_context, p_envelope, p_signature);
 if p_context is not null then
   if (p_context->>'operation' = route and p_context->>'keyHash' ~ '^[a-f0-9]{64}$' and p_context->>'fingerprint' ~ '^[a-f0-9]{64}$') is not true then raise invalid_parameter_value; end if;
   select * into receipt from public.idempotency_records where user_id = uid and operation = route and key_hash = p_context->>'keyHash';
   if found and receipt.expires_at > now() then
     if receipt.fingerprint <> p_context->>'fingerprint' then raise exception using errcode = 'P8001', message = 'Idempotency conflict'; end if;
     return receipt.response;
   end if;
   delete from public.idempotency_records where user_id = uid and operation = route and key_hash = p_context->>'keyHash';
 end if;
 if p_action = 'member_upsert' then
   if role <> 'owner' then raise exception using errcode = 'P4401', message = 'Only the project owner manages members'; end if;
   if p_input->>'role' not in ('editor','reviewer','viewer') then raise invalid_parameter_value; end if;
   if (p_input->>'userId')::uuid = uid or not exists (select 1 from auth.users where id = (p_input->>'userId')::uuid) then
     raise exception using errcode = 'P4402', message = 'The member must be an existing user other than the owner'; end if;
   if (select count(*) from public.project_members where project_id = pid and removed_at is null and user_id <> (p_input->>'userId')::uuid) >= 20 then
     raise exception using errcode = 'P4405', message = 'A project has at most 20 members'; end if;
   insert into public.project_members(project_id, user_id, role, added_by) values (pid, (p_input->>'userId')::uuid, p_input->>'role', uid)
   on conflict (project_id, user_id) do update set role = excluded.role, added_by = excluded.added_by, updated_at = clock_timestamp(), removed_at = null
   returning * into m;
   result := jsonb_build_object('userId', m.user_id, 'role', m.role, 'addedBy', m.added_by, 'createdAt', m.created_at, 'updatedAt', m.updated_at);
 elsif p_action = 'member_remove' then
   if role <> 'owner' then raise exception using errcode = 'P4401', message = 'Only the project owner manages members'; end if;
   update public.project_members set removed_at = clock_timestamp(), updated_at = clock_timestamp()
   where project_id = pid and user_id = (p_input->>'userId')::uuid and removed_at is null returning * into m;
   if not found then raise exception using errcode = 'P4403', message = 'Member not found'; end if;
   result := jsonb_build_object('userId', m.user_id, 'removed', true);
 elsif p_action = 'comment' then
   if role = 'viewer' then raise exception using errcode = 'P4401', message = 'Viewers cannot comment'; end if;
   select * into r from public.project_revisions where project_id = pid and id = (p_input->>'revisionId')::uuid;
   if not found then raise exception using errcode = 'P1205', message = 'Revision not found'; end if;
   select coalesce(array_agg(x), '{}') into ids from jsonb_array_elements_text(coalesce(p_input->'elementIds', '[]'::jsonb)) x;
   -- Anchors are checked against the stored model of this revision: a comment never names an element that does not exist in it.
   if not (ids <@ project_private.model_element_ids(r.model_json)) then
     raise exception using errcode = 'P4404', message = 'A referenced element does not exist in this revision'; end if;
   if p_input->>'parentId' is not null then
     select * into parent from public.project_revision_comments where id = (p_input->>'parentId')::uuid and revision_id = r.id;
     if not found or parent.parent_id is not null then raise exception using errcode = 'P4406', message = 'Replies attach to a top-level comment of the same revision'; end if;
   end if;
   if (select count(*) from public.project_revision_comments where revision_id = r.id) >= 200 then
     raise exception using errcode = 'P4405', message = 'A revision has at most 200 comments'; end if;
   insert into public.project_revision_comments(project_id, revision_id, author_id, author_role, kind, body, element_ids, parent_id)
   values (pid, r.id, uid, role, p_input->>'kind', p_input->>'body', ids, (p_input->>'parentId')::uuid) returning * into c;
   result := jsonb_build_object('id', c.id, 'authorId', c.author_id, 'authorRole', c.author_role, 'kind', c.kind, 'body', c.body, 'elementIds', to_jsonb(c.element_ids),
     'parentId', c.parent_id, 'createdAt', c.created_at);
 else
   if role not in ('owner','reviewer') then raise exception using errcode = 'P4401', message = 'Only the owner or a reviewer records a review'; end if;
   select * into r from public.project_revisions where project_id = pid and id = (p_input->>'revisionId')::uuid;
   if not found then raise exception using errcode = 'P1205', message = 'Revision not found'; end if;
   if (select count(*) from public.project_revision_reviews where revision_id = r.id) >= 100 then
     raise exception using errcode = 'P4405', message = 'A revision has at most 100 reviews'; end if;
   -- The model hash is computed by the server from this stored, immutable revision and carried in the signed envelope.
   insert into public.project_revision_reviews(project_id, revision_id, reviewer_id, reviewer_role, decision, note, model_hash)
   values (pid, r.id, uid, role, p_input->>'decision', coalesce(p_input->>'note', ''), p_input->>'modelHash') returning * into v;
   result := jsonb_build_object('id', v.id, 'reviewerId', v.reviewer_id, 'reviewerRole', v.reviewer_role, 'decision', v.decision, 'note', v.note, 'modelHash', v.model_hash,
     'createdAt', v.created_at);
 end if;
 if p_context is not null then
   insert into public.idempotency_records(user_id, operation, key_hash, fingerprint, response) values (uid, route, p_context->>'keyHash', p_context->>'fingerprint', result);
 end if;
 return result;
end;
$$;

revoke all on function public.collaboration_write(text, jsonb, text, text, jsonb) from public, anon;
grant execute on function public.collaboration_write(text, jsonb, text, text, jsonb) to authenticated;

create or replace function public.schema_version() returns integer language sql stable set search_path = '' as $$ select 33 $$;
revoke all on all functions in schema project_private from public, anon, authenticated;
