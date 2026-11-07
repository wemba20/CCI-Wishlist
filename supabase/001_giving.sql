begin;
create table public.giving_projects(id text primary key,name text not null,goal_cents bigint not null check(goal_cents>0),active boolean not null default true);
create table public.giving_admins(user_id uuid primary key references auth.users(id) on delete cascade,role text not null check(role in ('owner','finance','viewer')),active boolean not null default true);
create table public.giving_submissions(
 id uuid primary key default gen_random_uuid(), submission_key uuid unique not null,
 reference text unique not null default ('CCI-'||upper(replace(gen_random_uuid()::text,'-',''))),
 kind text not null check(kind in ('payment','pledge')),project_id text not null references public.giving_projects(id),
 amount_cents bigint not null check(amount_cents between 100 and 100000000), donor_name text not null check(length(donor_name) between 2 and 100),email text not null default '' check(length(email)<=254),
 payment_date date,payment_reference text not null default '',verified_reference text,note text not null default '' check(length(note)<=500),pledge_reference text not null default '',
 status text not null default 'pending' check(status in ('pending','approved','needs_info','rejected','reversed','fulfilled')),
 created_at timestamptz not null default now(),reviewed_at timestamptz,reviewed_by uuid references auth.users(id),review_note text not null default ''
);
create unique index giving_verified_reference_unique on public.giving_submissions(lower(trim(verified_reference))) where verified_reference is not null and trim(verified_reference)<>'';
create index giving_project_status on public.giving_submissions(project_id,status);
create table public.giving_audit(id bigint generated always as identity primary key,report_id uuid references public.giving_submissions(id),actor uuid references auth.users(id),previous_status text,new_status text not null,note text not null default '',created_at timestamptz not null default now());
alter table public.giving_projects enable row level security;
alter table public.giving_admins enable row level security;
alter table public.giving_submissions enable row level security;
alter table public.giving_audit enable row level security;
revoke all on public.giving_projects,public.giving_admins,public.giving_submissions,public.giving_audit from anon,authenticated;
-- Private tables have no browser policies or direct grants. All operations use narrowly scoped functions.
create function public.public_project_totals() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'goal_cents',p.goal_cents,'raised_cents',coalesce(t.raised,0),'pledged_cents',coalesce(t.pledged,0))),'[]'::jsonb)
 from public.giving_projects p left join lateral(select sum(amount_cents) filter(where kind='payment' and status='approved') raised,sum(amount_cents) filter(where kind='pledge' and status='approved') pledged from public.giving_submissions where project_id=p.id)t on true where p.active;
$$;
create function public.create_submission(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.giving_submissions;begin
 if not exists(select 1 from public.giving_projects where id=payload->>'project_id' and active) then raise exception 'Project is unavailable.';end if;
 select * into r from public.giving_submissions where submission_key=(payload->>'submission_key')::uuid;
 if found then return jsonb_build_object('reference',r.reference,'status',r.status);end if;
 insert into public.giving_submissions(submission_key,kind,project_id,amount_cents,donor_name,email,payment_date,payment_reference,note,pledge_reference)
 values((payload->>'submission_key')::uuid,payload->>'kind',payload->>'project_id',(payload->>'amount_cents')::bigint,payload->>'donor_name',coalesce(payload->>'email',''),nullif(payload->>'payment_date','')::date,coalesce(payload->>'payment_reference',''),coalesce(payload->>'note',''),coalesce(payload->>'pledge_reference','')) returning * into r;
 insert into public.giving_audit(report_id,new_status) values(r.id,'pending');
 return jsonb_build_object('reference',r.reference,'status',r.status);
end;$$;
create function public.admin_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare admin_role text;begin
 select role into admin_role from public.giving_admins where user_id=auth.uid() and active;
 if admin_role is null then raise exception 'Administrator access required.';end if;
 return jsonb_build_object('role',admin_role,'reports',coalesce((select jsonb_agg(to_jsonb(s) order by created_at desc) from public.giving_submissions s),'[]'::jsonb),'audit',coalesce((select jsonb_agg(to_jsonb(a) order by created_at desc) from (select * from public.giving_audit order by id desc limit 500)a),'[]'::jsonb));
end;$$;
create function public.review_submission(report_id uuid,new_status text,verified_reference text default '',review_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.giving_submissions;linked public.giving_submissions;ref text:=lower(trim(verified_reference));begin
 if not exists(select 1 from public.giving_admins where user_id=auth.uid() and active and role in ('owner','finance')) then raise exception 'Finance administrator access required.';end if;
 if length(review_note)>1000 then raise exception 'Review note is too long.';end if;
 select * into r from public.giving_submissions where id=report_id for update;
 if not found then raise exception 'Report not found.';end if;
 if new_status not in ('approved','needs_info','rejected','reversed') then raise exception 'Invalid review status.';end if;
 if r.status in ('reversed','fulfilled','rejected') then raise exception 'This report is closed.';end if;
 if r.status='approved' and new_status<>'reversed' then raise exception 'Approved records can only be reversed.';end if;
 if new_status='reversed' and r.status<>'approved' then raise exception 'Only approved records can be reversed.';end if;
 if new_status<>'approved' and trim(review_note)='' then raise exception 'Please record a reason.';end if;
 if new_status='approved' and r.kind='payment' and length(ref)<3 then raise exception 'Enter the verified Tithely transaction reference.';end if;
 update public.giving_submissions set status=new_status,verified_reference=case when new_status='approved' and r.kind='payment' then ref else giving_submissions.verified_reference end,review_note=review_submission.review_note,reviewed_by=auth.uid(),reviewed_at=now() where id=report_id;
 insert into public.giving_audit(report_id,actor,previous_status,new_status,note) values(r.id,auth.uid(),r.status,new_status,review_note);
 if new_status='approved' and r.kind='payment' and r.pledge_reference<>'' then
  select * into linked from public.giving_submissions where reference=r.pledge_reference and kind='pledge' and status='approved' for update;
  if found and linked.project_id=r.project_id and linked.amount_cents=r.amount_cents then
   update public.giving_submissions set status='fulfilled' where id=linked.id;
   insert into public.giving_audit(report_id,actor,previous_status,new_status,note) values(linked.id,auth.uid(),'approved','fulfilled','Matched payment '||r.reference);
  end if;
 end if;
 if new_status='reversed' and r.kind='payment' and r.pledge_reference<>'' then
  select * into linked from public.giving_submissions where reference=r.pledge_reference and kind='pledge' and status='fulfilled' and project_id=r.project_id and amount_cents=r.amount_cents for update;
  if found then
   update public.giving_submissions set status='approved' where id=linked.id;
   insert into public.giving_audit(report_id,actor,previous_status,new_status,note) values(linked.id,auth.uid(),'fulfilled','approved','Reopened after reversal of '||r.reference);
  end if;
 end if;
 return jsonb_build_object('reference',r.reference,'status',new_status);
exception when unique_violation then raise exception 'That transaction reference has already been recorded. Check for a duplicate.';
end;$$;
revoke all on function public.public_project_totals(),public.create_submission(jsonb),public.admin_snapshot(),public.review_submission(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.public_project_totals() to anon,authenticated;
grant execute on function public.create_submission(jsonb) to service_role;
grant execute on function public.admin_snapshot(),public.review_submission(uuid,text,text,text) to authenticated;
commit;
