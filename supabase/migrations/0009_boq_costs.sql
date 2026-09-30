-- Phase 15 is additive. V1 estimates and prior immutable artifacts remain unchanged.
alter table public.project_revision_construction_calculations add constraint construction_source_chain_unique
 unique(project_revision_id,takeoff_id,acceptance_qa_id,id);
create function project_private.cost_hash(value jsonb) returns text language sql immutable strict set search_path='' as $$
 select encode(extensions.digest(convert_to(project_private.canonical_json(value),'UTF8'),'sha256'),'hex')
$$;
create table public.project_revision_cost_estimates (
 id uuid primary key default gen_random_uuid(),
 project_revision_id uuid not null,
 takeoff_id uuid not null,
 acceptance_qa_id uuid not null,
 construction_calculation_id uuid not null,
 construction_report_hash text not null check(construction_report_hash ~ '^[a-f0-9]{64}$'),
 engine_version text not null check(char_length(engine_version) between 1 and 100),
 rate_book jsonb not null check(jsonb_typeof(rate_book)='object'),
 rate_book_hash text not null check(rate_book_hash=project_private.cost_hash(rate_book)),
 costing_policy jsonb not null check(jsonb_typeof(costing_policy)='object'),
 costing_policy_hash text not null check(costing_policy_hash=project_private.cost_hash(costing_policy)),
 currency text not null check(currency in ('INR','USD','EUR')),
 region jsonb not null,
 options jsonb not null,
 input_fingerprint text not null unique check(input_fingerprint ~ '^[a-f0-9]{64}$'),
 report_hash text not null check(report_hash ~ '^[a-f0-9]{64}$'),
 coverage text not null check(coverage in ('FULLY_PRICED','PARTIALLY_PRICED','NOT_PRICED')),
 report_json jsonb not null check(octet_length(report_json::text)<=28000000),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(project_revision_id,takeoff_id,acceptance_qa_id,construction_calculation_id)
   references public.project_revision_construction_calculations(project_revision_id,takeoff_id,acceptance_qa_id,id),
 check((jsonb_typeof(report_json)='object' and report_hash=project_private.cost_hash(report_json)
   and report_json->>'engineVersion'=engine_version and report_json->'rateBook'=rate_book
   and report_json->>'rateBookHash'=rate_book_hash and report_json->'costingPolicy'=costing_policy
   and report_json->>'costingPolicyHash'=costing_policy_hash and report_json->>'currency'=currency
   and rate_book->>'currency'=currency and costing_policy->>'currency'=currency and rate_book->>'minorUnits'='2'
   and report_json->'region'=region and rate_book->'region'=region and report_json->'options'=options
   and report_json->>'coverage'=coverage and jsonb_typeof(report_json->'boqLines')='array'
   and jsonb_typeof(report_json->'adjustments')='array') is true)
);
create index costs_revision_created_idx on public.project_revision_cost_estimates(project_revision_id,created_at desc,id desc);
create index costs_calculation_idx on public.project_revision_cost_estimates(construction_calculation_id);
alter table public.project_revision_cost_estimates enable row level security;
revoke all on public.project_revision_cost_estimates from public,anon,authenticated,service_role;
grant select on public.project_revision_cost_estimates to authenticated,service_role;
create policy cost_owner_read on public.project_revision_cost_estimates for select to authenticated using (
 exists(select 1 from public.project_revision_construction_calculations c
 join public.project_revision_takeoffs t on t.id=c.takeoff_id and t.project_revision_id=c.project_revision_id
 join public.project_revisions r on r.id=t.project_revision_id join public.projects p on p.id=r.project_id
 where c.id=construction_calculation_id and p.owner_id=(select auth.uid()))
);
create trigger cost_immutable before update or delete on public.project_revision_cost_estimates
 for each row execute function project_private.immutable_revision();
create function project_private.cost_summary(t public.project_revision_cost_estimates) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',t.id,'projectRevisionId',t.project_revision_id,'takeoffId',t.takeoff_id,
 'constructionCalculationId',t.construction_calculation_id,'acceptanceQaId',t.acceptance_qa_id,
 'engineVersion',t.engine_version,'inputFingerprint',t.input_fingerprint,'reportHash',t.report_hash,'constructionReportHash',t.construction_report_hash,
 'rateBookId',t.rate_book->'id','rateBookVersion',t.rate_book->'version','rateBookHash',t.rate_book_hash,
 'costingPolicyHash',t.costing_policy_hash,'currency',t.currency,'region',t.region,'coverage',t.coverage,
 'finalTotals',t.report_json->'finalTotals','createdAt',t.created_at)
$$;
alter table public.idempotency_records drop constraint idempotency_records_operation_check;
alter table public.idempotency_records add check(operation in (
 '/api/plans','/api/plans/generate','/api/estimates','/api/projects','/api/projects/:projectId/revisions',
 '/api/projects/:projectId/revisions/generate','/api/projects/:projectId/revisions/:revisionId/takeoffs',
 '/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations',
 '/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations/:calculationId/cost-estimates'));
create function public.cost_write(p_input jsonb,p_context jsonb default null,p_envelope text default null,p_signature text default null) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
 uid uuid:=auth.uid(); op text:='/api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations/:calculationId/cost-estimates';
 secret text; envelope jsonb; r public.project_revisions; q public.project_revision_qa_runs;
 source public.project_revision_construction_calculations; t public.project_revision_cost_estimates;
 receipt public.idempotency_records; report jsonb:=p_input->'report'; fingerprint text; source_hash text;
 result jsonb; material_amount numeric; labor_amount numeric; adjustment_amount numeric;
begin
 if uid is null then raise insufficient_privilege; end if;
 select k.secret into secret from project_private.commit_key k where singleton;
 if p_envelope is null or p_signature is null or
 p_signature<>encode(extensions.hmac(convert_to(p_envelope,'UTF8'),decode(secret,'hex'),'sha256'),'hex') then raise insufficient_privilege; end if;
 envelope:=p_envelope::jsonb;
 if (envelope->>'userId'=uid::text and envelope->>'operation'=op and envelope->'input'=p_input
 and envelope->'context'=coalesce(p_context,'null'::jsonb)
 and (envelope->>'expiresAt')::bigint between extract(epoch from clock_timestamp())::bigint and extract(epoch from clock_timestamp())::bigint+600) is not true then raise insufficient_privilege; end if;
 if octet_length(p_input::text)>28500000 then raise invalid_parameter_value; end if;
 if not exists(select 1 from public.projects where id=(p_input->>'projectId')::uuid and owner_id=uid) then
 raise exception using errcode='P1201',message='Project not found'; end if;
 select * into r from public.project_revisions where id=(p_input->>'projectRevisionId')::uuid and project_id=(p_input->>'projectId')::uuid;
 if not found then raise exception using errcode='P1205',message='Revision not found'; end if;
 select * into source from public.project_revision_construction_calculations where id=(p_input->>'constructionCalculationId')::uuid
 and project_revision_id=r.id and takeoff_id=(p_input->>'takeoffId')::uuid;
 if not found then raise exception using errcode='P1401',message='Construction calculation not found'; end if;
 select * into q from public.project_revision_qa_runs where id=r.acceptance_qa_id and revision_id=r.id;
 source_hash:=project_private.cost_hash(source.report_json);
 if (q.status in ('PASS','PASS_WITH_WARNINGS') and q.report_json->>'inputStatus'='SCHEMA_VALID'
   and q.report_json->>'status' in ('PASS','PASS_WITH_WARNINGS') and q.report_json->'summary'->>'errors'='0'
   and source.acceptance_qa_id=q.id and p_input->>'acceptanceQaId'=q.id::text
   and report->'source'->>'constructionEngineVersion'=source.engine_version
   and report->'source'->>'takeoffEngineVersion'=source.report_json->>'takeoffEngineVersion'
   and report->'source'->>'measurementPolicyVersion'=source.report_json->>'measurementPolicyVersion'
   and report->'source'->'recipePack'=source.recipe_pack and report->'source'->>'upstreamStatus'=source.status
   and p_input->>'constructionReportHash'=source_hash) is not true then
 raise exception using errcode='P1502',message='Construction provenance not accepted'; end if;
 if p_context is not null then
   if (p_context->>'operation'=op and p_context->>'keyHash' ~ '^[a-f0-9]{64}$' and p_context->>'fingerprint' ~ '^[a-f0-9]{64}$') is not true then raise invalid_parameter_value; end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||':'||op||':'||(p_context->>'keyHash'),0));
   select * into receipt from public.idempotency_records where user_id=uid and operation=op and key_hash=p_context->>'keyHash';
   if found and receipt.expires_at>now() then
     if receipt.fingerprint<>p_context->>'fingerprint' then raise exception using errcode='P8001',message='Idempotency conflict'; end if;
     return receipt.response;
   end if;
   delete from public.idempotency_records where user_id=uid and operation=op and key_hash=p_context->>'keyHash';
 end if;
 fingerprint:=project_private.cost_hash(jsonb_build_object('projectRevisionId',r.id,'constructionCalculationId',source.id,
   'constructionInputFingerprint',source.input_fingerprint,'constructionReportHash',source_hash,'engineVersion',report->'engineVersion',
   'rateBookHash',report->'rateBookHash','costingPolicyHash',report->'costingPolicyHash','options',report->'options'));
 if (p_input->>'inputFingerprint'=fingerprint and report->>'rateBookHash'=project_private.cost_hash(report->'rateBook')
   and report->>'costingPolicyHash'=project_private.cost_hash(report->'costingPolicy')
   and p_input->>'reportHash'=project_private.cost_hash(report)) is not true then
 raise exception using errcode='P1503',message='Cost content hash mismatch'; end if;
 -- Independent reconciliation catches signed projection mistakes without repeating the cost engine.
 select coalesce(sum((l->>'baseAmount')::numeric) filter(where l->>'category'='MATERIAL'),0),
 coalesce(sum((l->>'baseAmount')::numeric) filter(where l->>'category'='LABOR'),0)
 into material_amount,labor_amount from jsonb_array_elements(report->'boqLines') l;
 select coalesce(sum((a->>'amount')::numeric),0) into adjustment_amount from jsonb_array_elements(report->'adjustments') a;
 if ((report->'subtotals'->>'material')::numeric=material_amount and (report->'subtotals'->>'labor')::numeric=labor_amount
   and (report->'subtotals'->>'direct')::numeric=material_amount+labor_amount
   and (report->'finalTotals'->>'pricedSubtotal')::numeric=material_amount+labor_amount
   and (report->'finalTotals'->>'adjustmentsOnPricedSubtotal')::numeric=adjustment_amount
   and (report->'finalTotals'->>'pricedGrandTotal')::numeric=material_amount+labor_amount+adjustment_amount
   and (report->'finalTotals'->>'completeTotalAvailable')::boolean=(report->>'coverage'='FULLY_PRICED')
   and (source.status='EVALUATED' or report->>'coverage'<>'FULLY_PRICED')) is not true then
 raise exception using errcode='P1503',message='Cost totals or coverage mismatch'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cost:'||fingerprint,0));
 select * into t from public.project_revision_cost_estimates where input_fingerprint=fingerprint;
 if found then
   if t.report_json<>report then raise exception using errcode='P1503',message='Deterministic cost report mismatch'; end if;
 else
   insert into public.project_revision_cost_estimates(project_revision_id,takeoff_id,acceptance_qa_id,construction_calculation_id,
   construction_report_hash,engine_version,rate_book,rate_book_hash,costing_policy,costing_policy_hash,currency,region,options,
   input_fingerprint,report_hash,coverage,report_json)
   values(r.id,source.takeoff_id,q.id,source.id,source_hash,report->>'engineVersion',report->'rateBook',report->>'rateBookHash',
   report->'costingPolicy',report->>'costingPolicyHash',report->>'currency',report->'region',report->'options',fingerprint,
   p_input->>'reportHash',report->>'coverage',report) returning * into t;
 end if;
 result:=project_private.cost_summary(t)||jsonb_build_object('report',t.report_json);
 if p_context is not null then
   insert into public.idempotency_records(user_id,operation,key_hash,fingerprint,response)
   values(uid,op,p_context->>'keyHash',p_context->>'fingerprint',result);
 end if;
 return result;
end;
$$;
create function public.cost_read(p_project_id uuid,p_revision_id uuid,p_cost_id uuid default null,p_limit integer default 20,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.project_revision_cost_estimates; items jsonb; next_cursor jsonb; total integer;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if not exists(select 1 from public.projects where id=p_project_id and owner_id=auth.uid()) then raise exception using errcode='P1201',message='Project not found'; end if;
 if not exists(select 1 from public.project_revisions where id=p_revision_id and project_id=p_project_id) then raise exception using errcode='P1205',message='Revision not found'; end if;
 if p_cost_id is not null then
   select * into t from public.project_revision_cost_estimates where id=p_cost_id and project_revision_id=p_revision_id;
   if not found then raise exception using errcode='P1501',message='Cost estimate not found'; end if;
   return project_private.cost_summary(t)||jsonb_build_object('report',t.report_json);
 end if;
 if p_limit is null or p_limit<1 or p_limit>100 then raise invalid_parameter_value; end if;
 with page as(select * from public.project_revision_cost_estimates where project_revision_id=p_revision_id
   and (p_cursor is null or (created_at,id)<((p_cursor->>'createdAt')::timestamptz,(p_cursor->>'id')::uuid)) order by created_at desc,id desc limit p_limit+1),
 shown as(select * from page order by created_at desc,id desc limit p_limit)
 select (select count(*) from page),coalesce(jsonb_agg(project_private.cost_summary(shown) order by created_at desc,id desc),'[]'::jsonb),
 (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) into total,items,next_cursor from shown;
 return jsonb_build_object('items',items,'nextCursor',case when total>p_limit then next_cursor else null end);
end;
$$;
revoke all on function public.cost_write(jsonb,jsonb,text,text),public.cost_read(uuid,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.cost_write(jsonb,jsonb,text,text),public.cost_read(uuid,uuid,uuid,integer,jsonb) to authenticated;
revoke all on all functions in schema project_private from public,anon,authenticated;
