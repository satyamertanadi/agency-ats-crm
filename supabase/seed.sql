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
with stages(name,stage_key,stage_type,phase_key,position,visible) as (values
('Sourcing','sourced','active','sourcing',0,false),('Screening','screening','active','screening',1,false),('Shortlist','shortlisted','active','shortlist',2,false),
('Client review','submitted_to_client','active','client_review',3,true),('Interview','interview_scheduled','active','interview',4,true),('Offer','offer','active','offer',5,true),
('Placed','placed','placed','placed',6,true),('Rejected','rejected','rejected','other',7,false),('Withdrawn','withdrawn','withdrawn','other',8,false),('On hold','on_hold','on_hold','other',9,false))
insert into public.pipeline_stages(organization_id,pipeline_id,name,stage_key,stage_type,phase_key,position,is_client_visible)
select p.organization_id,p.id,s.name,s.stage_key,s.stage_type,s.phase_key,s.position,s.visible from public.pipelines p cross join stages s where p.id in ('50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002') on conflict do nothing;

insert into public.companies(id,organization_id,name,industry,website,location,account_status,business_development_stage,owner_member_id,created_by) values
('60000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Atlas Renewable Energy','energy_utilities','https://example.com','Singapore','active_client','won','40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001'),
('60000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Meridian Hospitality','hospitality',null,'Bali','prospect','qualifying','40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001'),
('60000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','Private Rival Client','technology',null,'Remote','active_client','won','40000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000001');
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
