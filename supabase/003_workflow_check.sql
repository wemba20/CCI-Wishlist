-- Non-destructive test: every test record and decision is rolled back.
begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.giving_admins where role='owner' and active limit 1),true);
do $$
declare first_report jsonb;second_report jsonb;report_uuid uuid;second_uuid uuid;duplicate_blocked boolean:=false;begin
 first_report:=public.create_submission('{"kind":"payment","project_id":"water","amount_cents":100,"donor_name":"Fictional verification test","submission_key":"e288a930-7bce-4a26-a37a-61d24f7a6aa1","payment_date":"2026-11-07","payment_reference":"CCI-TEST-ROLLBACK"}'::jsonb);
 select id into report_uuid from public.giving_submissions where reference=first_report->>'reference';
 if (select sum((v->>'raised_cents')::bigint) from jsonb_array_elements(public.public_project_totals())v)<>0 then raise exception 'Pending report changed public totals';end if;
 perform public.review_submission(report_uuid,'approved','CCI-TEST-ROLLBACK','Fictional rollback test');
 if not exists(select 1 from jsonb_array_elements(public.public_project_totals())v where v->>'id'='water' and (v->>'raised_cents')::bigint=100)then raise exception 'Approval did not update total';end if;
 second_report:=public.create_submission('{"kind":"payment","project_id":"water","amount_cents":100,"donor_name":"Fictional duplicate test","submission_key":"e288a930-7bce-4a26-a37a-61d24f7a6aa2","payment_date":"2026-11-07","payment_reference":"CCI-TEST-ROLLBACK"}'::jsonb);
 select id into second_uuid from public.giving_submissions where reference=second_report->>'reference';
 begin perform public.review_submission(second_uuid,'approved','CCI-TEST-ROLLBACK','Duplicate test');exception when others then if sqlerrm like '%already been recorded%' then duplicate_blocked:=true;else raise;end if;end;
 if not duplicate_blocked then raise exception 'Duplicate reference was allowed';end if;
 perform public.review_submission(report_uuid,'reversed','','Reversal rollback test');
 if (select sum((v->>'raised_cents')::bigint) from jsonb_array_elements(public.public_project_totals())v)<>0 then raise exception 'Reversal did not restore totals';end if;
end;$$;
rollback;
select count(*) as retained_reports from public.giving_submissions;
