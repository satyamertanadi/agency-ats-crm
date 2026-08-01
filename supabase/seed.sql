-- Local development only. Password for every seeded account: LocalTest!123
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change_token_new,email_change,created_at,updated_at)
values
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@northstar.local',crypt('LocalTest!123',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"full_name":"Olivia Owner"}','','','','',now(),now()),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','manager@northstar.local',crypt('LocalTest!123',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"full_name":"Marcus Manager"}','','','','',now(),now()),
('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','consultant@northstar.local',crypt('LocalTest!123',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"full_name":"Cara Consultant"}','','','','',now(),now()),
('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sourcer@northstar.local',crypt('LocalTest!123',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"full_name":"Sam Sourcer"}','','','','',now(),now()),
('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bd@northstar.local',crypt('LocalTest!123',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"full_name":"Bianca Development"}','','','','',now(),now()),
('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','finance@northstar.local',crypt('LocalTest!123',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"full_name":"Finn Finance"}','','','','',now(),now()),
('10000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','readonly@northstar.local',crypt('LocalTest!123',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"full_name":"Riley Reader"}','','','','',now(),now()),
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@rival.local',crypt('LocalTest!123',gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"full_name":"Rival Owner"}','','','','',now(),now())
on conflict(id) do nothing;

-- Northstar's seat_limit is raised above the production default of 6 because this fixture exists to
-- exercise all eight seeded roles, not to mirror the pilot contract; its seven members below would
-- otherwise trip the seat limit and fail `supabase db reset`.
--
-- Rival has exactly one member and is deliberately capped at one seat, giving the RLS suite an
-- already-full workspace to prove seat enforcement against. Do not add members to Rival.
insert into public.organizations(id,name,slug,base_currency,timezone,created_by,seat_limit) values
('30000000-0000-0000-0000-000000000001','Northstar Search','northstar-search','USD','Asia/Singapore','10000000-0000-0000-0000-000000000001',25),
('30000000-0000-0000-0000-000000000002','Rival Search','rival-search','USD','UTC','20000000-0000-0000-0000-000000000001',1)
on conflict(id) do nothing;
insert into public.organization_settings(organization_id) values('30000000-0000-0000-0000-000000000001'),('30000000-0000-0000-0000-000000000002') on conflict do nothing;

insert into public.organization_members(id,organization_id,user_id,status,job_title) values
('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','active','Managing Director'),
('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','active','Recruitment Manager'),
('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','active','Senior Consultant'),
('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','active','Researcher'),
('40000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','active','Business Development'),
('40000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','active','Finance'),
('40000000-0000-0000-0000-000000000007','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007','active','Observer'),
('40000000-0000-0000-0000-000000000008','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','active','Owner')
on conflict do nothing;

select public.seed_organization_roles('30000000-0000-0000-0000-000000000001');
select public.seed_organization_roles('30000000-0000-0000-0000-000000000002');
insert into public.member_roles(member_id,role_id)
select m.id,r.id from public.organization_members m join public.roles r on r.organization_id=m.organization_id
where r.role_key=case m.user_id
  when '10000000-0000-0000-0000-000000000001' then 'owner'
  when '10000000-0000-0000-0000-000000000002' then 'manager'
  when '10000000-0000-0000-0000-000000000003' then 'consultant'
  when '10000000-0000-0000-0000-000000000004' then 'sourcer'
  when '10000000-0000-0000-0000-000000000005' then 'bd'
  when '10000000-0000-0000-0000-000000000006' then 'finance'
  when '10000000-0000-0000-0000-000000000007' then 'readonly'
  else 'owner' end on conflict do nothing;

insert into public.pipelines(id,organization_id,name,kind,is_default) values
('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Agency recruitment','template',true),
('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','Agency recruitment','template',true)
on conflict do nothing;
with stages(name,stage_key,stage_type,position,visible) as (values
('Sourced','sourced','active',0,false),('Contacted','contacted','active',1,false),('Interested','interested','active',2,false),('Screening','screening','active',3,false),
('Longlisted','longlisted','active',4,false),('Shortlisted','shortlisted','active',5,false),('Submitted to Client','submitted_to_client','active',6,true),
('Client Reviewing','client_reviewing','active',7,true),('Interview Scheduled','interview_scheduled','active',8,true),('Interview Completed','interview_completed','active',9,true),
('Assessment','assessment','active',10,false),('Reference Check','reference_check','active',11,false),('Offer','offer','active',12,true),('Placed','placed','placed',13,true),
('Rejected','rejected','rejected',14,false),('Withdrawn','withdrawn','withdrawn',15,false),('On Hold','on_hold','on_hold',16,false))
insert into public.pipeline_stages(organization_id,pipeline_id,name,stage_key,stage_type,position,is_client_visible)
select p.organization_id,p.id,s.name,s.stage_key,s.stage_type,s.position,s.visible from public.pipelines p cross join stages s where p.id in ('50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002') on conflict do nothing;

insert into public.companies(id,organization_id,name,industry,website,location,account_status,business_development_stage,owner_member_id,created_by) values
('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Atlas Renewable Energy','Renewable energy','https://example.com','Singapore','active_client','active_account','40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001'),
('60000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Meridian Hospitality','Hospitality',null,'Bali','prospect','proposal','40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001'),
('60000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','Private Rival Client','Technology',null,'Remote','active_client','active_account','40000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000001');
insert into public.contacts(id,organization_id,company_id,full_name,position,email,phone,decision_authority,relationship_owner_id,created_by) values
('61000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','Amanda Chen','VP People','amanda@example.com','+65 6000 0000','Final hiring decision','40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001');
insert into public.commercial_terms(organization_id,company_id,fee_type,fee_percentage,currency,guarantee_days,status,created_by) values
('30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','percentage',20,'USD',90,'active','10000000-0000-0000-0000-000000000001');

insert into public.candidates(id,organization_id,full_name,current_company,current_position,location,status,owner_member_id,source,availability,notice_period_days,created_by) values
('70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Aisha Rahman','SunGrid','Commercial Director','Singapore','active','40000000-0000-0000-0000-000000000003','Referral','30 days',30,'10000000-0000-0000-0000-000000000003'),
('70000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Daniel Wong','VoltWorks','Regional Sales Lead','Kuala Lumpur','passive','40000000-0000-0000-0000-000000000004','Sourced','60 days',60,'10000000-0000-0000-0000-000000000004'),
('70000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','Hidden Rival Candidate','Private Co','CTO','Remote','active','40000000-0000-0000-0000-000000000008','Sourced','Immediate',0,'20000000-0000-0000-0000-000000000001');
insert into public.candidate_private_details(candidate_id,organization_id,email,phone,current_salary,expected_salary,salary_currency,work_authorization,consent_status) values
('70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','aisha@example.com','+65 8111 1111',150000,175000,'USD','Singapore citizen','granted'),
('70000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','daniel@example.com','+60 1222 2222',120000,145000,'USD','Requires sponsorship','granted'),
('70000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','hidden@rival.local',null,null,null,'USD',null,'granted');

-- Ready parse drafts used only by local RLS tests. No matching storage objects are required for read-isolation checks.
insert into public.candidate_cv_parses(id,organization_id,uploaded_by,original_filename,storage_path,mime_type,size_bytes,status,model,extracted_data) values
('71000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','consultant-cv.pdf','30000000-0000-0000-0000-000000000001/cv-drafts/10000000-0000-0000-0000-000000000003/71000000-0000-0000-0000-000000000001/consultant-cv.pdf','application/pdf',1024,'ready','test-model','{"full_name":"Visible only to uploader"}'),
('71000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','rival-cv.pdf','30000000-0000-0000-0000-000000000002/cv-drafts/20000000-0000-0000-0000-000000000001/71000000-0000-0000-0000-000000000002/rival-cv.pdf','application/pdf',1024,'ready','test-model','{"full_name":"Rival private parse"}');

-- Create one real job-specific pipeline and active candidates.
insert into public.jobs(id,organization_id,company_id,title,location,employment_type,currency,placement_fee_percentage,priority,status,owner_member_id,description,requirements,opened_at,created_by) values
('80000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','Regional Commercial Director','Singapore','Permanent','USD',20,'high','open','40000000-0000-0000-0000-000000000003','Lead regional growth for a renewable energy platform.','10+ years commercial leadership; energy experience; regional team leadership.',now()-interval '14 days','10000000-0000-0000-0000-000000000003');
insert into public.pipelines(id,organization_id,name,kind,source_pipeline_id,job_id) values('50000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','Regional Commercial Director pipeline','job','50000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001');
insert into public.pipeline_stages(organization_id,pipeline_id,name,stage_key,stage_type,position,is_client_visible)
select organization_id,'50000000-0000-0000-0000-000000000003',name,stage_key,stage_type,position,is_client_visible from public.pipeline_stages where pipeline_id='50000000-0000-0000-0000-000000000001';
update public.jobs set pipeline_id='50000000-0000-0000-0000-000000000003' where id='80000000-0000-0000-0000-000000000001';
insert into public.job_contacts(job_id,contact_id,organization_id,is_primary) values('80000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',true);
insert into public.job_candidates(id,organization_id,job_id,candidate_id,current_stage_id,owner_member_id,added_by)
select '81000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001',id,'40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003' from public.pipeline_stages where pipeline_id='50000000-0000-0000-0000-000000000003' and stage_key='shortlisted';
insert into public.job_candidates(id,organization_id,job_id,candidate_id,current_stage_id,owner_member_id,added_by)
select '81000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002',id,'40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004' from public.pipeline_stages where pipeline_id='50000000-0000-0000-0000-000000000003' and stage_key='screening';

insert into public.tasks(organization_id,title,status,priority,due_at,owner_member_id,created_by) values
('30000000-0000-0000-0000-000000000001','Follow up with Atlas on shortlist','open','high',now()-interval '1 day','40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003'),
('30000000-0000-0000-0000-000000000001','Call Daniel about availability','open','normal',now()+interval '1 day','40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004');

-- Interview intelligence: one completed Meet interview with a transcript, an accepted-shaped draft,
-- and the owner-only coaching review of the consultant who ran it. Seeded so tests/rls can prove the
-- split that is the whole point of the third table -- a consultant reads the notes and gets nothing
-- from the coaching review.
insert into public.interviews(id,organization_id,job_candidate_id,interview_type,stage_label,starts_at,ends_at,timezone,meeting_url,status,organizer_member_id,create_google_meet,created_by) values
('82000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','First interview','Interview Completed',now()-interval '2 days',now()-interval '2 days'+interval '45 minutes','Asia/Singapore','https://meet.google.com/abc-defg-hij','completed','40000000-0000-0000-0000-000000000003',true,'10000000-0000-0000-0000-000000000003');

insert into public.interview_transcripts(id,organization_id,interview_id,source,status,google_conference_record,google_transcript_name,language,entries,plain_text,talk_time,duration_seconds,entry_count,fetched_at,created_by) values
('83000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001','google_meet','ready','conferenceRecords/seed','conferenceRecords/seed/transcripts/seed','en-US',
 '[{"speaker_id":"conferenceRecords/seed/participants/1","speaker_name":"Priya Consultant","speaker_role":"consultant","text":"Thanks for making the time. Let me explain the role.","start_ms":0,"end_ms":6000},{"speaker_id":"conferenceRecords/seed/participants/2","speaker_name":"Amara Chen","speaker_role":"candidate","text":"I led the regional commercial team for four years.","start_ms":6000,"end_ms":20000}]'::jsonb,
 'Priya Consultant (consultant): Thanks for making the time. Let me explain the role.
Amara Chen (candidate): I led the regional commercial team for four years.',
 '{"consultant_ms":6000,"candidate_ms":14000,"other_ms":0}'::jsonb,20,2,now()-interval '2 days','10000000-0000-0000-0000-000000000003');

insert into public.ai_evaluations(id,organization_id,candidate_id,job_id,evaluation_type,provider,model,prompt_version,status,summary,score,input_tokens,output_tokens,completed_at,requested_by) values
('84000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','interview_notes','anthropic','test-model','interview-notes-v1','completed','Four years leading a regional commercial team.',75,1000,500,now()-interval '2 days','10000000-0000-0000-0000-000000000003');

insert into public.interview_ai_notes(id,organization_id,interview_id,interview_transcript_id,ai_evaluation_id,status,prompt_version,language,generated_content,score,input_hash,created_by) values
('85000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000001','draft','interview-notes-v1','en-US',
 '{"detected_language":"en-US","summary":{"headline":"Four years leading a regional commercial team.","key_points":["Led a regional commercial team for four years."],"topics_covered":[],"candidate_stated_facts":[],"logistics":{"notice_period":"","salary_expectation":"","location_preference":"","availability":""}},"candidate_assessment":{"requirement_evidence":[{"requirement":"regional team leadership","classification":"matched","quote":"I led the regional commercial team for four years.","explanation":"Stated directly."}],"strengths":[],"concerns":[],"open_questions":[],"recommendation_note":""},"consultant_assessment":{"rubric":[],"missed_topics":[]},"score":100,"rating_summary":{"strong":0,"adequate":0,"needs_work":0,"not_observed":8,"index":0}}'::jsonb,
 100,'seed-interview-notes-hash','10000000-0000-0000-0000-000000000003');

insert into public.interview_coaching_reviews(id,organization_id,interview_id,interview_ai_notes_id,subject_member_id,rubric,rating_summary,missed_topics) values
('86000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001','85000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003',
 '[{"criterion":"role_and_process_explained","rating":"strong","evidence_quote":"Let me explain the role.","coaching_note":"Kept doing this."},{"criterion":"salary_expectation","rating":"not_observed","evidence_quote":"","coaching_note":""}]'::jsonb,
 '{"strong":1,"adequate":0,"needs_work":0,"not_observed":1,"index":100}'::jsonb,'["salary expectations"]'::jsonb);
