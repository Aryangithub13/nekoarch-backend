-- Security hardening: reference_download compared the presented token signature to the expected one with a plain text
-- comparison, whose duration can depend on how many leading characters match. Both sides are now HMAC'd again under the
-- commit key before comparison, so the comparison time is independent of the expected signature (a keyed double-HMAC).
-- Behaviour is otherwise identical: same signature, same P3107/P3105 errors, same grants (CREATE OR REPLACE keeps them).
-- Other envelope-signature checks (migrations 0006-0023) are unchanged by this migration.
create or replace function public.reference_download(p_token text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare secret text; part text; sig text; payload jsonb; r public.project_references; bytes bytea; now_epoch bigint := extract(epoch from clock_timestamp())::bigint;
begin
 -- Same shape as the API's DownloadTokenSchema; PostgreSQL caps regex repetition at 255, so the length is checked separately.
 if p_token is null or length(p_token) not between 81 and 665 or p_token !~ '^[A-Za-z0-9_-]+\.[a-f0-9]{64}$' then
   raise exception using errcode='P3107',message='Invalid download link'; end if;
 part := split_part(p_token,'.',1); sig := split_part(p_token,'.',2);
 select k.secret into secret from project_private.commit_key k where singleton;
 if extensions.hmac(convert_to(sig,'UTF8'),decode(secret,'hex'),'sha256')
    is distinct from extensions.hmac(convert_to(encode(extensions.hmac(convert_to(part,'UTF8'),decode(secret,'hex'),'sha256'),'hex'),'UTF8'),decode(secret,'hex'),'sha256') then
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
