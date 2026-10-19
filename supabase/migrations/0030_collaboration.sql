-- B44 S1: project members, element-anchored revision comments, revision reviews and the change audit.
-- Additive only: three new tables and two new RPCs. No existing table, policy or function is changed. Membership grants access only through
-- collaboration_read / collaboration_write; every existing owner-only table and route stays owner-only.
create table public.project_members (
 project_id uuid not null references public.projects(id) on delete cascade,
 user_id uuid not null,
 role text not null check (role in ('editor','reviewer','viewer')),
 added_by uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 removed_at timestamptz,
 primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members(user_id) where removed_at is null;
create table public.project_revision_comments (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 revision_id uuid not null,
 author_id uuid not null,
 author_role text not null check (author_role in ('owner','editor','reviewer')),
 kind text not null check (kind in ('COMMENT','CHANGE_REQUEST')),
 body text not null check (char_length(body) between 1 and 2000),
 element_ids text[] not null default '{}' check (cardinality(element_ids) <= 16),
 parent_id uuid references public.project_revision_comments(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (project_id, revision_id) references public.project_revisions(project_id, id)
);
create index project_revision_comments_revision_idx on public.project_revision_comments(revision_id, created_at, id);
create table public.project_revision_reviews (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 revision_id uuid not null,
 reviewer_id uuid not null,
 reviewer_role text not null check (reviewer_role in ('owner','reviewer')),
 decision text not null check (decision in ('APPROVED','CHANGES_REQUESTED')),
 note text not null default '' check (char_length(note) <= 2000),
 model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (project_id, revision_id) references public.project_revisions(project_id, id)
);
create index project_revision_reviews_revision_idx on public.project_revision_reviews(revision_id, created_at, id);

alter table public.project_members enable row level security;
alter table public.project_revision_comments enable row level security;
alter table public.project_revision_reviews enable row level security;
revoke all on public.project_members, public.project_revision_comments, public.project_revision_reviews from public, anon, authenticated, service_role;
grant select on public.project_members, public.project_revision_comments, public.project_revision_reviews to authenticated, service_role;

-- The caller's role on a project: 'owner', an active member role, or null. Membership never reaches beyond the collaboration RPCs.
create function project_private.project_role(p_project_id uuid, p_user uuid) returns text language sql stable security definer set search_path = '' as $$
 select coalesce((select 'owner' from public.projects where id = p_project_id and owner_id = p_user),
   (select m.role from public.project_members m where m.project_id = p_project_id and m.user_id = p_user and m.removed_at is null));
$$;
-- Direct reads (inline and non-recursive): the owner sees everything of the project; a member sees its own membership row and, while active, the
-- project's comments and reviews. The API reads through collaboration_read; these policies only keep direct table access no wider than that.
create policy project_members_read on public.project_members for select to authenticated using (user_id = (select auth.uid())
 or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy revision_comments_read on public.project_revision_comments for select to authenticated using (
 exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
 or exists (select 1 from public.project_members m where m.project_id = project_revision_comments.project_id and m.user_id = (select auth.uid()) and m.removed_at is null));
create policy revision_reviews_read on public.project_revision_reviews for select to authenticated using (
 exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
 or exists (select 1 from public.project_members m where m.project_id = project_revision_reviews.project_id and m.user_id = (select auth.uid()) and m.removed_at is null));
-- Comments and reviews are an immutable record of who said what about which revision.
create trigger project_revision_comment_immutable before update or delete on public.project_revision_comments for each row execute function project_private.immutable_revision();
create trigger project_revision_review_immutable before update or delete on public.project_revision_reviews for each row execute function project_private.immutable_revision();

-- Every stable element id of a stored model (the collections the B40 element diff compares).
create function project_private.model_element_ids(p_model jsonb) returns text[] language sql immutable set search_path = '' as $$
 select coalesce(array_agg(e->>'id'), '{}') from (
   select jsonb_array_elements(coalesce(p_model->c, '[]'::jsonb)) e
   from unnest(array['levels','spaces','walls','openings','stairs','slabs','columns','dimensions','specifications']) c) x;
$$;

create function public.collaboration_read(p_action text, p_project_id uuid, p_revision_id uuid default null) returns jsonb
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
       from (select * from public.project_revisions where project_id = p.id order by revision_number desc limit 100) x), '[]'::jsonb));
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

create function public.collaboration_write(p_action text, p_input jsonb, p_envelope text, p_signature text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); pid uuid := (p_input->>'projectId')::uuid; role text; m public.project_members; c public.project_revision_comments;
 v public.project_revision_reviews; r public.project_revisions; ids text[]; parent public.project_revision_comments;
begin
 if uid is null then raise insufficient_privilege; end if;
 role := project_private.project_role(pid, uid);
 if role is null then raise exception using errcode = 'P1201', message = 'Project not found'; end if;
 -- Serialize collaboration writes per project, so the member, comment and review caps below hold under concurrency (count then insert).
 -- A transaction-scoped advisory lock, not FOR UPDATE on projects, which would also block other writers' foreign-key checks.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collaboration:' || pid::text, 0));
 if p_action = 'member_upsert' then
   perform project_private.verify_envelope('/api/projects/:projectId/collaboration/members', p_input, null, p_envelope, p_signature);
   if role <> 'owner' then raise exception using errcode = 'P4401', message = 'Only the project owner manages members'; end if;
   if p_input->>'role' not in ('editor','reviewer','viewer') then raise invalid_parameter_value; end if;
   if (p_input->>'userId')::uuid = uid or not exists (select 1 from auth.users where id = (p_input->>'userId')::uuid) then
     raise exception using errcode = 'P4402', message = 'The member must be an existing user other than the owner'; end if;
   if (select count(*) from public.project_members where project_id = pid and removed_at is null and user_id <> (p_input->>'userId')::uuid) >= 20 then
     raise exception using errcode = 'P4405', message = 'A project has at most 20 members'; end if;
   insert into public.project_members(project_id, user_id, role, added_by) values (pid, (p_input->>'userId')::uuid, p_input->>'role', uid)
   on conflict (project_id, user_id) do update set role = excluded.role, added_by = excluded.added_by, updated_at = clock_timestamp(), removed_at = null
   returning * into m;
   return jsonb_build_object('userId', m.user_id, 'role', m.role, 'addedBy', m.added_by, 'createdAt', m.created_at, 'updatedAt', m.updated_at);
 elsif p_action = 'member_remove' then
   perform project_private.verify_envelope('/api/projects/:projectId/collaboration/members/:userId', p_input, null, p_envelope, p_signature);
   if role <> 'owner' then raise exception using errcode = 'P4401', message = 'Only the project owner manages members'; end if;
   update public.project_members set removed_at = clock_timestamp(), updated_at = clock_timestamp()
   where project_id = pid and user_id = (p_input->>'userId')::uuid and removed_at is null returning * into m;
   if not found then raise exception using errcode = 'P4403', message = 'Member not found'; end if;
   return jsonb_build_object('userId', m.user_id, 'removed', true);
 elsif p_action = 'comment' then
   perform project_private.verify_envelope('/api/projects/:projectId/collaboration/revisions/:revisionId/comments', p_input, null, p_envelope, p_signature);
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
   return jsonb_build_object('id', c.id, 'authorId', c.author_id, 'authorRole', c.author_role, 'kind', c.kind, 'body', c.body, 'elementIds', to_jsonb(c.element_ids),
     'parentId', c.parent_id, 'createdAt', c.created_at);
 elsif p_action = 'review' then
   perform project_private.verify_envelope('/api/projects/:projectId/collaboration/revisions/:revisionId/reviews', p_input, null, p_envelope, p_signature);
   if role not in ('owner','reviewer') then raise exception using errcode = 'P4401', message = 'Only the owner or a reviewer records a review'; end if;
   select * into r from public.project_revisions where project_id = pid and id = (p_input->>'revisionId')::uuid;
   if not found then raise exception using errcode = 'P1205', message = 'Revision not found'; end if;
   if (select count(*) from public.project_revision_reviews where revision_id = r.id) >= 100 then
     raise exception using errcode = 'P4405', message = 'A revision has at most 100 reviews'; end if;
   -- The model hash is computed by the server from this stored, immutable revision and carried in the signed envelope.
   insert into public.project_revision_reviews(project_id, revision_id, reviewer_id, reviewer_role, decision, note, model_hash)
   values (pid, r.id, uid, role, p_input->>'decision', coalesce(p_input->>'note', ''), p_input->>'modelHash') returning * into v;
   return jsonb_build_object('id', v.id, 'reviewerId', v.reviewer_id, 'reviewerRole', v.reviewer_role, 'decision', v.decision, 'note', v.note, 'modelHash', v.model_hash,
     'createdAt', v.created_at);
 end if;
 raise invalid_parameter_value;
end;
$$;

revoke all on function public.collaboration_read(text, uuid, uuid), public.collaboration_write(text, jsonb, text, text) from public, anon;
grant execute on function public.collaboration_read(text, uuid, uuid), public.collaboration_write(text, jsonb, text, text) to authenticated;
revoke all on all functions in schema project_private from public, anon, authenticated;
