-- Phase 38: immutable, owner-only engineering evidence packages bound to one accepted revision.
-- A package records, with recomputable hashes, the Phase 37 dependency graph, the Phase 35 engineering assessment and the Phase 38
-- construction-document manifest of that revision. It is provenance: nothing here certifies, approves or reviews a design, and
-- professionalReview is fixed to NOT_RECORDED. Additive only: no historical migration, row or identity is rewritten.
create table public.project_revision_evidence_packages (
 id uuid primary key default gen_random_uuid(),
 project_revision_id uuid not null references public.project_revisions(id),
 acceptance_qa_id uuid not null,
 package_version text not null check (package_version = 'engineering-evidence-package-v1'),
 created_as text not null check (created_as in ('CURRENT_REVISION','HISTORICAL_SNAPSHOT')),
 model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
 input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
 content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
 graph_hash text not null check (graph_hash ~ '^[a-f0-9]{64}$'),
 assessment_result_hash text not null check (assessment_result_hash ~ '^[a-f0-9]{64}$'),
 manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
 node_count integer not null check (node_count between 2 and 128),
 package_json jsonb not null check (octet_length(package_json::text) <= 4000000),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (project_revision_id, acceptance_qa_id) references public.project_revision_qa_runs(revision_id,id),
 unique (project_revision_id,input_hash),
 -- Columns must agree with the package; the review status and claims are fixed, never caller-controlled.
 check ((jsonb_typeof(package_json) = 'object' and package_json->>'version' = package_version and package_json->>'createdAs' = created_as
   and package_json->'binding'->>'revisionId' = project_revision_id::text and package_json->'binding'->>'acceptanceQaId' = acceptance_qa_id::text
   and package_json->'binding'->>'modelHash' = model_hash and package_json->>'inputHash' = input_hash and package_json->>'contentHash' = content_hash
   and package_json->'dependencyGraph'->>'graphHash' = graph_hash and package_json->'assessment'->>'resultHash' = assessment_result_hash
   and package_json->'documents'->>'manifestHash' = manifest_hash and jsonb_array_length(package_json->'dependencyGraph'->'nodes') = node_count
   and package_json->'professionalReview'->>'status' = 'NOT_RECORDED'
   and package_json->'claims' = jsonb_build_object('engineeringCorrectness','NOT_CLAIMED','codeCompliance','NOT_CLAIMED','structuralAdequacy','NOT_CLAIMED',
     'permitReadiness','NOT_CLAIMED','constructionReadiness','NOT_CLAIMED','professionalCertification','NOT_CLAIMED')) is true)
);
create index evidence_revision_created_idx on public.project_revision_evidence_packages(project_revision_id,created_at desc,id desc);
create index evidence_acceptance_qa_idx on public.project_revision_evidence_packages(acceptance_qa_id);
alter table public.project_revision_evidence_packages enable row level security;
revoke all on public.project_revision_evidence_packages from public,anon,authenticated,service_role;
grant select on public.project_revision_evidence_packages to authenticated,service_role;
create policy evidence_owner_read on public.project_revision_evidence_packages for select to authenticated using (
 exists (select 1 from public.project_revisions r join public.projects p on p.id=r.project_id
 where r.id=project_revision_id and p.owner_id=(select auth.uid()))
);
create trigger evidence_immutable before update or delete on public.project_revision_evidence_packages
 for each row execute function project_private.immutable_revision();

create function project_private.evidence_summary(e public.project_revision_evidence_packages) returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('id',e.id,'projectRevisionId',e.project_revision_id,'acceptanceQaId',e.acceptance_qa_id,'packageVersion',e.package_version,
 'createdAs',e.created_as,'modelHash',e.model_hash,'inputHash',e.input_hash,'contentHash',e.content_hash,'graphHash',e.graph_hash,
 'assessmentResultHash',e.assessment_result_hash,'manifestHash',e.manifest_hash,'nodeCount',e.node_count,'createdAt',e.created_at)
$$;

-- Every binding is recomputed from the stored revision and every hash from the package itself, never trusted from the payload.
-- CURRENT_REVISION packages hold the project row FOR SHARE while checking that the revision is still current, so a revision committed
-- while the package was assembled fails this write (P3804) instead of being stored as current.
create function public.evidence_write(p_input jsonb,p_envelope text default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
 uid uuid := auth.uid(); op text := '/api/projects/:projectId/revisions/:revisionId/evidence-packages';
 p public.projects; r public.project_revisions; q public.project_revision_qa_runs; e public.project_revision_evidence_packages;
 pkg jsonb := p_input->'package'; graph jsonb := p_input->'package'->'dependencyGraph'; assessment jsonb := p_input->'package'->'assessment';
 docs jsonb := p_input->'package'->'documents'; model_hash text;
begin
 if uid is null then raise insufficient_privilege; end if;
 perform project_private.verify_envelope(op,p_input,null,p_envelope,p_signature);
 select * into p from public.projects where id=(p_input->>'projectId')::uuid and owner_id=uid for share;
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 select * into r from public.project_revisions where id=(p_input->>'projectRevisionId')::uuid and project_id=p.id;
 if not found then raise exception using errcode='P1205',message='Revision not found'; end if;
 select * into q from public.project_revision_qa_runs where id=r.acceptance_qa_id and revision_id=r.id;
 if (q.status in ('PASS','PASS_WITH_WARNINGS') and q.report_json->>'inputStatus'='SCHEMA_VALID' and q.report_json->'summary'->>'errors'='0') is not true then
   raise exception using errcode='P3802',message='Revision not accepted'; end if;
 model_hash := project_private.revision_model_hash(r.model_json);
 if (jsonb_typeof(pkg)='object' and pkg->>'version'='engineering-evidence-package-v1'
   and pkg->'binding'->>'projectId'=p.id::text and pkg->'binding'->>'revisionId'=r.id::text and (pkg->'binding'->>'revisionNumber')::integer=r.revision_number
   and pkg->'binding'->>'modelHash'=model_hash and pkg->'binding'->>'acceptanceQaId'=q.id::text and pkg->'binding'->>'qaStatus'=q.status
   and (r.generation_identity is null or r.generation_identity->>'modelHash'=model_hash)
   -- Review status and claims are fixed: no package can record a review or claim compliance.
   and pkg->'professionalReview'->>'status'='NOT_RECORDED'
   and pkg->'claims'=jsonb_build_object('engineeringCorrectness','NOT_CLAIMED','codeCompliance','NOT_CLAIMED','structuralAdequacy','NOT_CLAIMED',
     'permitReadiness','NOT_CLAIMED','constructionReadiness','NOT_CLAIMED','professionalCertification','NOT_CLAIMED')
   -- Phase 37 graph of exactly this revision: complete, self-hashed, and with no unverified node.
   and graph->>'graphVersion'='dependency-graph-v1' and (graph->>'complete')::boolean
   and graph->'inputIdentity'->>'projectId'=p.id::text and graph->'inputIdentity'->>'revisionId'=r.id::text and graph->'inputIdentity'->>'modelHash'=model_hash
   and graph->>'graphHash'=project_private.cost_hash(graph - 'graphHash')
   and not jsonb_path_exists(graph,'$.nodes[*] ? (@.state == "UNVERIFIED")')
   -- Phase 35 assessment of exactly this revision, self-hashed (its read-time generatedAt is not part of the package).
   and assessment->>'assessmentVersion'='engineering-assessment-v1' and not (assessment ? 'generatedAt')
   and assessment->>'projectId'=p.id::text and assessment->>'revisionId'=r.id::text and assessment->>'modelHash'=model_hash
   and assessment->>'resultHash'=project_private.cost_hash(assessment - 'resultHash')
   -- Phase 38 document manifest of exactly this revision, self-hashed.
   and docs->>'documentsVersion'='construction-documents-v1' and docs->'binding'->>'revisionId'=r.id::text and docs->'binding'->>'modelHash'=model_hash
   and docs->>'manifestHash'=project_private.cost_hash(docs - 'manifestHash')
   -- The evidence index restates its sources exactly: assessment domains with their flags, and the graph's artifact nodes with their states.
   and pkg->'evidenceIndex'->'assessmentDomains'=(select coalesce(jsonb_agg(jsonb_build_object('domain',d->'domain','assuranceLevel',d->'assuranceLevel',
     'status',d->'status','evidenceClass',d->'evidenceClass','blockerKinds',(select coalesce(jsonb_agg(b->'kind' order by bo),'[]'::jsonb)
     from jsonb_array_elements(d->'blockers') with ordinality bb(b,bo))) order by o),'[]'::jsonb) from jsonb_array_elements(assessment->'domains') with ordinality t(d,o))
   and pkg->'evidenceIndex'->'computedArtifacts'=(select coalesce(jsonb_agg(jsonb_build_object('nodeId',n->'nodeId','family',n->'family','artifactId',n->'artifactId',
     'state',n->'state','kind',case when n->>'family' in ('STRUCTURAL_ANALYSIS','ENVIRONMENTAL_ANALYSIS','BUILDING_SYSTEMS_ANALYSIS') then 'SOLVER_OR_CALCULATOR'
       when n->>'family'='SPECIALIZED_KNOWLEDGE' then 'RULE_EVALUATION' else 'DETERMINISTIC_ENGINE' end) order by o),'[]'::jsonb)
     from jsonb_array_elements(graph->'nodes') with ordinality t(n,o) where n->>'family' not in ('REVISION','ACCEPTANCE_QA'))
   and docs->'freshness'->>'projectCurrentRevisionId'=graph->'inputIdentity'->>'projectCurrentRevisionId'
   and pkg->>'inputHash'=project_private.cost_hash(jsonb_build_object('version',pkg->'version','createdAs',pkg->'createdAs','revisionId',r.id,'modelHash',model_hash,
     'graphHash',graph->'graphHash','assessmentInputHash',assessment->'inputHash','assessmentResultHash',assessment->'resultHash','manifestHash',docs->'manifestHash'))
   and pkg->>'contentHash'=project_private.cost_hash(pkg - 'contentHash')) is not true then
   raise exception using errcode='P3803',message='Evidence package is not bound to this revision'; end if;
 if pkg->>'createdAs'='CURRENT_REVISION' then
   if (p.current_revision_id=r.id and graph->'inputIdentity'->>'projectCurrentRevisionId'=r.id::text
     and not jsonb_path_exists(graph,'$.nodes[*] ? (@.state != "CURRENT")')) is not true then
     raise exception using errcode='P3804',message='The revision is no longer current'; end if;
 elsif pkg->>'createdAs'='HISTORICAL_SNAPSHOT' then
   if (p.current_revision_id<>r.id and graph->'inputIdentity'->>'projectCurrentRevisionId'<>r.id::text) is not true then
     raise exception using errcode='P3803',message='A historical snapshot must be of a superseded revision'; end if;
 else raise exception using errcode='P3803',message='Unknown evidence package mode'; end if;
 -- Identical inputs converge on one immutable package.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('evidence:' || r.id::text || ':' || (pkg->>'inputHash'),0));
 select * into e from public.project_revision_evidence_packages where project_revision_id=r.id and input_hash=pkg->>'inputHash';
 if found then
   if e.content_hash<>pkg->>'contentHash' then raise exception using errcode='P3803',message='Nondeterministic evidence package for an identical input'; end if;
 else
   insert into public.project_revision_evidence_packages(project_revision_id,acceptance_qa_id,package_version,created_as,model_hash,input_hash,content_hash,
     graph_hash,assessment_result_hash,manifest_hash,node_count,package_json)
   values(r.id,q.id,pkg->>'version',pkg->>'createdAs',model_hash,pkg->>'inputHash',pkg->>'contentHash',graph->>'graphHash',assessment->>'resultHash',
     docs->>'manifestHash',jsonb_array_length(graph->'nodes'),pkg)
   returning * into e;
 end if;
 return project_private.evidence_summary(e) || jsonb_build_object('package',e.package_json,'projectCurrentRevisionId',p.current_revision_id);
end;
$$;

create function public.evidence_read(p_action text,p_project_id uuid,p_revision_id uuid,p_package_id uuid default null,p_limit integer default 20,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.project_revision_evidence_packages; p public.projects; items jsonb; next_cursor jsonb; total integer;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into p from public.projects where id=p_project_id and owner_id=auth.uid();
 if not found then raise exception using errcode='P1201',message='Project not found'; end if;
 perform 1 from public.project_revisions r where r.id=p_revision_id and r.project_id=p_project_id;
 if not found then raise exception using errcode='P1205',message='Revision not found'; end if;
 if p_action='get' then
   select * into e from public.project_revision_evidence_packages where id=p_package_id and project_revision_id=p_revision_id;
   if not found then raise exception using errcode='P3801',message='Evidence package not found'; end if;
   return project_private.evidence_summary(e) || jsonb_build_object('package',e.package_json,'projectCurrentRevisionId',p.current_revision_id);
 elsif p_action='list' then
   if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value; end if;
   with page as (select * from public.project_revision_evidence_packages where project_revision_id=p_revision_id
     and (p_cursor is null or (created_at,id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid))
     order by created_at desc,id desc limit p_limit+1),
   shown as (select * from page order by created_at desc,id desc limit p_limit)
   select (select count(*) from page),coalesce(jsonb_agg(project_private.evidence_summary(shown) order by created_at desc,id desc),'[]'::jsonb),
   (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) into total,items,next_cursor from shown;
   return jsonb_build_object('items',items,'nextCursor',case when total>p_limit then next_cursor else null end,'projectCurrentRevisionId',p.current_revision_id);
 end if;
 raise invalid_parameter_value;
end;
$$;
revoke all on function public.evidence_write(jsonb,text,text),public.evidence_read(text,uuid,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.evidence_write(jsonb,text,text),public.evidence_read(text,uuid,uuid,uuid,integer,jsonb) to authenticated;
revoke all on all functions in schema project_private from public,anon,authenticated;
