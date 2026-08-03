import {mkdir,readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

export const IMPORT_ORDER=['companies','contacts','candidates','candidate_employment','candidate_education','candidate_languages','jobs','job_candidates','submissions','tasks','activities','interviews','offers','placements','revenue_splits','invoices']
export const ROLLBACK_ORDER=[...IMPORT_ORDER].reverse()
export const EXPECTED_COUNTS={companies:8,contacts:12,candidates:40,candidate_employment:64,candidate_education:40,candidate_languages:60,jobs:8,job_candidates:36,submissions:4,tasks:20,activities:36,interviews:8,offers:4,placements:2,revenue_splits:6,invoices:2}

/* Why no record here says "this is demo data" in its prose any more.
 *
 * It used to. Every account note read "Fictional Indonesian demo account. No external outreach.",
 * every candidate's source read "Demo dataset — Indonesia v1", and both rendered straight onto the
 * screen -- so the workspace announced itself as a prototype in the exact moment someone was being
 * shown it. The wording was doing real work, though, and deleting it needed the work to be done
 * somewhere better rather than just dropped.
 *
 * It already is, three times over, and every one of these is stronger than a sentence in a field
 * nobody reads:
 *
 *   1. Nobody can be contacted. Every address below is under a `.example` domain, which RFC 2606
 *      reserves precisely so that it can never resolve. `phone` and `linkedin_url` are empty. There
 *      is no channel out. Prose asks a human not to make contact; this makes contact impossible.
 *   2. Every row is identifiable. `legacy_id` carries the PREFIX below, so demo rows are one
 *      predicate away (`legacy_id like 'DEMO-IDN-V1-%'`) -- which is how ROLLBACK_ORDER removes the
 *      whole set cleanly.
 *   3. The names are visibly invented. The companies and people do not exist.
 *
 * So: keep the guarantees, drop the narration. If you add a record here, the rule is the address
 * stays under `.example` and the legacy_id keeps the prefix. Those are the safety properties. The
 * copy is just copy. */
const PREFIX='DEMO-IDN-V1'
const id=(kind,index)=>`${PREFIX}-${kind}-${String(index).padStart(2,'0')}`
const owner=(owners,index)=>owners[index%owners.length]
const iso=(anchor,days,hour=9)=>{const date=new Date(`${anchor}T${String(hour).padStart(2,'0')}:00:00+08:00`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString()}
const day=(anchor,days)=>iso(anchor,days).slice(0,10)

// Column 2 is a canonical industry key from src/shared/lib/industries.ts, not a display label -- demo
// data that seeded free text would make the clients filter look broken in exactly the workspace people
// use to evaluate the product.
const companySource=[
  ['Kinarya Digital Nusantara','technology','Jakarta','201-500','active_client','won'],
  ['Arunika Dana Teknologi','fintech','Jakarta','101-200','active_client','won'],
  ['Lintas Rona Logistik','logistics','Surabaya','501-1000','active_client','won'],
  ['Sembada Pangan Indonesia','consumer_goods','Bandung','501-1000','active_client','won'],
  ['Tirta Surya Energi','energy_utilities','Makassar','201-500','active_client','won'],
  ['Nawasena Hospitality Group','hospitality','Bali','201-500','prospect','pitching'],
  ['Satwika Medika Utama','healthcare','Yogyakarta','101-200','prospect','qualifying'],
  ['Bumirakit Manufaktur','manufacturing','Bekasi','1001-5000','inactive','lost'],
]

const contactSource=[
  [1,'Maya Prameswari','People Director','Final hiring decision'],[1,'Rizky Mahendra','VP Engineering','Technical sign-off'],
  [2,'Dian Kartikasari','Head of Talent','Shortlist approval'],[2,'Fajar Wibisono','Chief Product Officer','Final hiring decision'],
  [3,'Nadia Permata','HR Business Partner','Process owner'],[3,'Bagus Santoso','Operations Director','Final hiring decision'],
  [4,'Rina Kusumawardani','Talent Acquisition Lead','Shortlist approval'],[5,'Yoga Pranata','Chief Commercial Officer','Final hiring decision'],
  [5,'Larasati Pertiwi','People Operations Manager','Process owner'],[6,'Agung Kurniawan','Group HR Director','Final hiring decision'],
  [7,'Sekar Ayuningtyas','People and Culture Lead','Shortlist approval'],[8,'Hendra Gunawan','Plant Director','Final hiring decision'],
]

const candidateNames=[
  'Aditya Nugroho','Alya Maharani','Andi Prasetyo','Anisa Rahmawati','Arif Setiawan','Bella Oktaviani','Bima Saputra','Citra Lestari','Daffa Ramadhan','Dewi Anggraini',
  'Dimas Kurnia','Eka Wulandari','Farhan Hakim','Fitri Handayani','Galih Prabowo','Gita Savitri','Hana Putri','Ilham Maulana','Indah Puspitasari','Joko Firmansyah',
  'Kartika Sari','Kevin Wijaya','Laila Nuraini','M. Reza Akbar','Mega Purnamasari','Naufal Hidayat','Nisa Azzahra','Putra Mahardika','Qori Amalia','Rafi Darmawan',
  'Ratih Kusuma','Rendra Irawan','Salsa Nabila','Taufik Hendra','Tiara Anindita','Vino Prakoso','Wahyu Adinata','Yasmin Fauziah','Yudha Baskara','Zahra Kamila',
]
const positions=['Engineering Manager','Senior Product Manager','Data Engineering Lead','Talent Acquisition Manager','Enterprise Account Executive','Finance Business Partner','Operations Excellence Lead','Brand Marketing Manager','Backend Engineer','People Analytics Specialist','Regional Sales Manager','Supply Chain Manager','Commercial Strategy Lead','Customer Experience Manager','Product Designer','Quality Assurance Lead','HR Business Partner','Cloud Infrastructure Engineer','Procurement Manager','Area Operations Manager','Key Account Manager','Risk and Compliance Lead','Business Intelligence Analyst','Warehouse Operations Lead','Renewable Energy Project Manager','Revenue Operations Manager','Clinical Operations Manager','Manufacturing Engineering Lead','Solutions Architect','Head of Engineering','Director of Product','Senior Recruiter','Partnerships Manager','Financial Planning Manager','Hotel Operations Manager','Medical Affairs Manager','Plant Maintenance Manager','Growth Marketing Lead','Information Security Manager','Learning and Development Lead']
const currentCompanies=['Ruang Karya','Solusi Awan','Data Pijar','Talenta Bersama','Niaga Maju','Dana Cermat','Gerak Cepat','Merek Cerah','Kode Rakit','Insan Analitika','Jual Tumbuh','Rantai Prima','Strategi Timur','Sapa Pelanggan','Studio Bentuk','Mutu Digital','Mitra Insani','Infrastruktur Kita','Sumber Andalan','Operasi Raya']
const locations=['Jakarta','Bandung','Surabaya','Bali','Makassar','Yogyakarta']
/* Account context a consultant would actually have written, rather than one sentence repeated eight
 * times. Varied on purpose: identical notes down a column read as seeding even when the words are
 * innocuous. */
const accountNotes=[
  'Retained on engineering leadership since 2024. Prefers a three-person shortlist and moves quickly once briefed.',
  'Two open mandates a year, consistently. Talent lead runs the process and expects weekly written updates.',
  'Fee agreement renewed at 20%. Hiring committee meets fortnightly, so time submissions to land Monday.',
  'Expanding the Bandung site. Decisions sit with the COO; the HR team schedules but does not decide.',
  'Renewables build-out is the driver here. Long lead times on approvals — keep candidates warm.',
  'Relationship paused after the last search filled internally. Worth a check-in next quarter.',
  'Strong on culture fit, slow on feedback. Chase within 48 hours or the process stalls.',
  'New logo via referral. First mandate is a test of the desk; keep the bar high on shortlist quality.',
]
/* Where a real desk finds people. Replaces 'Demo dataset — Indonesia v1', which rendered under every
 * candidate's name on the database screen. */
const candidateSources=['Referral','LinkedIn','Inbound application','Network — ex-colleague','Industry event','Referral — placed candidate']
/* The activity feed is the record of a relationship, so "Demo recruitment activity 14 / Recorded
 * fictional call activity" was both a giveaway and useless as a demonstration -- a feed of numbered
 * placeholders proves nothing about the product. These read like a desk's actual history. */
const activitySubjects=[
  'Intro call — availability and motivation','Client briefing on the role','Shortlist walkthrough','Interview debrief',
  'Salary expectations discussed','Reference check arranged','Offer terms confirmed','Weekly search update',
  'Candidate follow-up','Notice period clarified','Feedback chased','Start date agreed',
]
const activitySummaries=[
  'Covered background, motivation for a move, and what would make them say yes. Open to the right role.',
  'Client confirmed the brief and the must-haves. Wants to see three candidates by end of next week.',
  'Talked the client through each profile and the rationale. Two progressing to first interview.',
  'Interview went well on substance. Client wants one more conversation on team fit before deciding.',
  'Expectations are inside the range. No competing offers at this stage.',
  'Two referees confirmed and scheduled for later this week.',
  'Terms agreed verbally. Written offer to follow once the client has signed off internally.',
  'Sent the client a written update on pipeline and timeline. No blockers to report.',
  'Checked in after the interview. Still engaged and keen to progress.',
  'Confirmed a 30-day notice period, so an earliest start of mid next month.',
  'Chased the client for interview feedback; promised by tomorrow.',
  'Start date agreed and confirmed with both sides. Placement to be recorded.',
]
const jobNotes=[
  'Client wants three candidates, not five. Quality over volume on this one.',
  'Budget confirmed at the top of the range for the right profile.',
  'Prior search stalled on notice periods — screen for availability early.',
  'Hiring manager is direct in interviews; brief candidates on style beforehand.',
  'Board-visible hire. Expect an extra reference round before offer.',
  'On hold pending the client’s budget review. Do not submit further candidates yet.',
  'Filled from our shortlist. Keep the runners-up warm for the next mandate.',
  'Replacement search. Discretion matters — the incumbent is still in post.',
]
const universities=['Universitas Indonesia','Institut Teknologi Bandung','Universitas Gadjah Mada','Universitas Airlangga','Institut Teknologi Sepuluh Nopember','Universitas Hasanuddin']
/* One literal title reused across a batch of tasks was the second half of the Today-dashboard
 * repetition bug: fixing the "assign an owner" duplication just exposed that every candidate
 * follow-up said the exact same "Follow up on candidate availability", stacked one after another.
 * Varied per task so the dashboard doesn't trade one repeated headline for another. */
const followUpTitles=['Follow up on candidate availability','Check in on notice period','Confirm interview availability','Chase feedback from last call','Reconnect after the holiday break','Follow up on relocation timeline']
const shortlistTitles=['Prepare client shortlist','Finalise shortlist notes','Pull together the top profiles','Write up submission summaries','Confirm shortlist before sending','Cross-check shortlist against the brief']
const vacancyUpdateTitles=['Update vacancy progress','Send the client a status update','Log this week’s pipeline movement','Note interview outcomes on the vacancy','Update the search timeline','Flag any blockers on this role','Confirm next steps with the client','Review vacancy ageing']

export function generateDemoData({anchorDate=new Date().toISOString().slice(0,10),owners}){
  validateOwners(owners)
  if(!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)||Number.isNaN(new Date(`${anchorDate}T00:00:00Z`).valueOf()))throw new Error('anchorDate must use YYYY-MM-DD')

  const companies=companySource.map(([name,industry,location,size,status,stage],index)=>({legacy_id:id('COMP',index+1),name,industry,website:`https://${slug(name)}.example`,location,company_size:size,account_status:status,business_development_stage:stage,notes_summary:accountNotes[index%accountNotes.length],owner_email:owner(owners,index)}))
  const contacts=contactSource.map(([companyIndex,name,position,authority],index)=>({legacy_id:id('CONT',index+1),company_legacy_id:id('COMP',companyIndex),full_name:name,position,email:`${slug(name)}@client.demo.example`,phone:'',linkedin_url:'',contact_status:index===11?'inactive':'active',decision_authority:authority,next_follow_up_at:iso(anchorDate,index-3,10),owner_email:owner(owners,index+1)}))

  const candidates=candidateNames.map((fullName,index)=>({
    legacy_id:id('CAND',index+1),full_name:fullName,email:`${slug(fullName)}@candidate.demo.example`,phone:'',current_company:currentCompanies[index%currentCompanies.length],current_position:positions[index],location:locations[index%locations.length],linkedin_url:'',
    status:index===29||index===30?'placed':index>=38?'do_not_contact':index%3===0?'passive':'active',source:candidateSources[index%candidateSources.length],availability:index%4===0?'Immediate':`${30+(index%3)*15} days`,notice_period_days:index%4===0?0:30+(index%3)*15,current_salary:180000000+index*6000000,expected_salary:220000000+index*7500000,salary_currency:'IDR',work_authorization:'Indonesian citizen',consent_status:index>=38?'withdrawn':'granted',owner_email:owner(owners,index),
  }))

  const candidate_employment=[]
  for(let index=0;index<candidates.length;index++){
    candidate_employment.push({legacy_id:id('EMP',candidate_employment.length+1),candidate_legacy_id:candidates[index].legacy_id,company_name:candidates[index].current_company,title:positions[index],location:locations[index%locations.length],started_on:day(anchorDate,-(730+index*13)),ended_on:'',is_current:'true',summary:`Leads ${positions[index].toLowerCase()} responsibilities in a growing Indonesian business.`})
    if(index<24)candidate_employment.push({legacy_id:id('EMP',candidate_employment.length+1),candidate_legacy_id:candidates[index].legacy_id,company_name:`${currentCompanies[(index+7)%currentCompanies.length]} Indonesia`,title:`Senior ${positions[index]}`,location:locations[(index+2)%locations.length],started_on:day(anchorDate,-(1825+index*11)),ended_on:day(anchorDate,-(760+index*13)),is_current:'false',summary:'Delivered cross-functional projects and measurable operating improvements.'})
  }
  const candidate_education=candidates.map((candidate,index)=>({legacy_id:id('EDU',index+1),candidate_legacy_id:candidate.legacy_id,institution:universities[index%universities.length],degree:index%4===0?'Master of Management':'Bachelor degree',field_of_study:index%3===0?'Business Administration':index%3===1?'Computer Science':'Industrial Engineering',started_on:`${2010+(index%7)}-08-01`,ended_on:`${2014+(index%7)}-06-30`}))
  const candidate_languages=candidates.flatMap((candidate,index)=>[
    {legacy_id:id('LANG',index+1),candidate_legacy_id:candidate.legacy_id,language:'Bahasa Indonesia',proficiency:'Native'},
    ...(index<20?[{legacy_id:id('LANG',41+index),candidate_legacy_id:candidate.legacy_id,language:'English',proficiency:index%3===0?'Fluent':'Professional working'}]:[]),
  ])

  const jobTitles=['Engineering Manager','Senior Product Manager','National Operations Manager','Head of Brand Marketing','Commercial Director','Hotel General Manager','Clinical Operations Lead','Plant Engineering Manager']
  const jobs=jobTitles.map((title,index)=>({legacy_id:id('JOB',index+1),company_legacy_id:id('COMP',index+1),title,description:`Own the ${title.toLowerCase()} mandate, reporting to the executive team and building out the function through the next growth stage.`,requirements:'Demonstrated leadership, strong stakeholder management, and relevant Indonesian market experience.',location:locations[index%locations.length],employment_type:'Permanent',salary_min:300000000+index*30000000,salary_max:480000000+index*45000000,priority:index<2?'urgent':index<5?'high':'normal',status:index===5?'on_hold':index===6?'filled':'open',currency:'IDR',placement_fee_percentage:20,fixed_fee:'',target_close_date:day(anchorDate,30+index*7),internal_notes:jobNotes[index%jobNotes.length],client_visible_notes:'Search underway. Shortlist in progress and tracking to the agreed timeline.',owner_email:owner(owners,index),primary_contact_legacy_id:contacts.find((contact)=>contact.company_legacy_id===id('COMP',index+1)).legacy_id,team_member_emails:`${owner(owners,index)};${owner(owners,index+1)}`}))

  const jobGroups=[[1,2,3,4,5],[6,7,8,9,10],[11,12,13,14,15],[16,17,18,19,20],[21,22,23,24],[25,26,27,28],[29,30,31,32],[33,34,35,36]]
  const stageGroups=[['Sourced','Contacted','Screening','Shortlisted','Submitted to Client'],['Interested','Screening','Client Reviewing','Interview Scheduled','Rejected'],['Longlisted','Shortlisted','Submitted to Client','Interview Completed','Offer'],['Contacted','Screening','Assessment','Reference Check','Withdrawn'],['Sourced','Interested','On Hold','Rejected'],['Shortlisted','Client Reviewing','Interview Scheduled','Offer'],['Interview Completed','Placed','Placed','Offer'],['Sourced','Screening','Submitted to Client','Withdrawn']]
  const job_candidates=[]
  jobGroups.forEach((group,jobIndex)=>group.forEach((candidateIndex,groupIndex)=>job_candidates.push({legacy_id:id('JC',job_candidates.length+1),candidate_legacy_id:id('CAND',candidateIndex),job_legacy_id:id('JOB',jobIndex+1),stage:stageGroups[jobIndex][groupIndex],stage_occurred_at:iso(anchorDate,-(35-job_candidates.length),11),source:candidateSources[candidateIndex%candidateSources.length],owner_email:owner(owners,candidateIndex-1)})))

  const submissions=[[1,[3,4,5]],[2,[8,9,10]],[3,[13,14,15]],[8,[33,34,35]]].map(([jobIndex,jcIndexes],index)=>({legacy_id:id('SUB',index+1),job_legacy_id:id('JOB',jobIndex),contact_legacy_id:jobs[jobIndex-1].primary_contact_legacy_id,job_candidate_legacy_ids:jcIndexes.map((value)=>id('JC',value)).join(';'),title:`${jobTitles[jobIndex-1]} shortlist`,message:'Please review the shortlisted candidates below and share your feedback on each. Happy to arrange interviews for anyone you would like to meet.',recipient_name:contacts.find((contact)=>contact.legacy_id===jobs[jobIndex-1].primary_contact_legacy_id).full_name,recipient_email:`reviewer${index+1}@client.demo.example`,expiry_days:30}))

  const tasks=Array.from({length:20},(_,index)=>({legacy_id:id('TASK',index+1),title:index<6?followUpTitles[index]:index<12?shortlistTitles[index-6]:vacancyUpdateTitles[index-12],description:index<6?'Confirm notice period and earliest start date before the client asks.':index<12?'Pull the three strongest profiles together and write the submission notes.':'Send the client a written progress update on the current search.',priority:index%5===0?'urgent':index%3===0?'high':'normal',status:index>=12?'completed':'open',due_at:iso(anchorDate,index-5,9),owner_email:owner(owners,index),candidate_legacy_id:index<8?id('CAND',index+1):'',company_legacy_id:index>=8&&index<14?id('COMP',(index%8)+1):'',contact_legacy_id:index>=14&&index<17?id('CONT',(index%12)+1):'',job_legacy_id:index>=17?id('JOB',(index%8)+1):''}))
  const activityTypes=['call','email','whatsapp','meeting','interview','status_change']
  const activities=Array.from({length:36},(_,index)=>({legacy_id:id('ACT',index+1),activity_type:activityTypes[index%activityTypes.length],direction:index%4===0?'inbound':index%3===0?'internal':'outbound',subject:activitySubjects[index%activitySubjects.length],summary:activitySummaries[index%activitySummaries.length],occurred_at:iso(anchorDate,-(index%28),8+(index%8)),owner_email:owner(owners,index),candidate_legacy_id:index<18?id('CAND',index+1):'',company_legacy_id:index>=18&&index<26?id('COMP',(index%8)+1):'',contact_legacy_id:index>=26&&index<30?id('CONT',(index%12)+1):'',job_legacy_id:index>=30?id('JOB',(index%8)+1):''}))

  const interviewJcs=[9,14,15,19,27,28,29,32]
  const interviews=interviewJcs.map((jcIndex,index)=>({legacy_id:id('INT',index+1),job_candidate_legacy_id:id('JC',jcIndex),interview_type:index%2===0?'client_interview':'panel_interview',starts_at:iso(anchorDate,index<4?index+2:-(index+2),10+(index%4)),ends_at:iso(anchorDate,index<4?index+2:-(index+2),11+(index%4)),timezone:'Asia/Makassar',location:index%2===0?'Google Meet':'Client office',meeting_url:'',status:index<4?'scheduled':index===7?'cancelled':'completed'}))
  const offers=[
    {jc:15,status:'presented',salary:510000000,offset:-3,start:35},{jc:28,status:'declined',salary:480000000,offset:-18,start:20},
    {jc:30,status:'accepted',salary:620000000,offset:-28,start:14},{jc:31,status:'accepted',salary:560000000,offset:-24,start:18},
  ].map((item,index)=>({legacy_id:id('OFFER',index+1),job_candidate_legacy_id:id('JC',item.jc),salary:item.salary,currency:'IDR',offered_at:day(anchorDate,item.offset),start_date:day(anchorDate,item.start),status:item.status,notes:'Terms agreed with the client before presenting. Candidate briefed on the package in full.'}))
  const placements=[
    {legacy_id:id('PLACE',1),job_candidate_legacy_id:id('JC',30),start_date:day(anchorDate,14),salary:620000000,placement_fee:124000000,currency:'IDR',guarantee_days:90,status:'confirmed'},
    {legacy_id:id('PLACE',2),job_candidate_legacy_id:id('JC',31),start_date:day(anchorDate,18),salary:560000000,placement_fee:112000000,currency:'IDR',guarantee_days:90,status:'confirmed'},
  ]
  const splitPercentages=[50,30,20]
  const revenue_splits=placements.flatMap((placement,placementIndex)=>splitPercentages.map((percentage,index)=>({legacy_id:id('SPLIT',placementIndex*3+index+1),placement_legacy_id:placement.legacy_id,member_email:owner(owners,placementIndex*3+index),split_percentage:percentage})))
  const invoices=placements.map((placement,index)=>({legacy_id:id('INV',index+1),placement_legacy_id:placement.legacy_id,invoice_reference:`INV-2026-${String(index+1).padStart(4,'0')}`,amount:placement.placement_fee,currency:'IDR',issued_on:day(anchorDate,-(10-index*3)),due_on:day(anchorDate,20+index*3),status:index===0?'paid':'issued',paid_on:index===0?day(anchorDate,-2):'',notes:'Placement fee invoiced per the agreed schedule. 30-day payment terms.'}))

  const data={companies,contacts,candidates,candidate_employment,candidate_education,candidate_languages,jobs,job_candidates,submissions,tasks,activities,interviews,offers,placements,revenue_splits,invoices}
  validateDemoData(data,owners)
  return data
}

export function validateDemoData(data,owners){
  validateOwners(owners)
  for(const [entity,expected] of Object.entries(EXPECTED_COUNTS))if(data[entity]?.length!==expected)throw new Error(`${entity} must contain ${expected} rows`)
  const allIds=Object.values(data).flat().map((row)=>row.legacy_id)
  if(new Set(allIds).size!==allIds.length)throw new Error('legacy IDs must be globally unique')
  const refs={companies:new Set(data.companies.map((row)=>row.legacy_id)),contacts:new Set(data.contacts.map((row)=>row.legacy_id)),candidates:new Set(data.candidates.map((row)=>row.legacy_id)),jobs:new Set(data.jobs.map((row)=>row.legacy_id)),job_candidates:new Set(data.job_candidates.map((row)=>row.legacy_id)),placements:new Set(data.placements.map((row)=>row.legacy_id))}
  for(const row of data.contacts)assertRef(refs.companies,row.company_legacy_id,'contact company')
  for(const entity of ['candidate_employment','candidate_education','candidate_languages'])for(const row of data[entity])assertRef(refs.candidates,row.candidate_legacy_id,`${entity} candidate`)
  for(const row of data.jobs){assertRef(refs.companies,row.company_legacy_id,'job company');assertRef(refs.contacts,row.primary_contact_legacy_id,'job contact')}
  for(const row of data.job_candidates){assertRef(refs.candidates,row.candidate_legacy_id,'pipeline candidate');assertRef(refs.jobs,row.job_legacy_id,'pipeline job')}
  for(const row of data.submissions){assertRef(refs.jobs,row.job_legacy_id,'submission job');for(const value of row.job_candidate_legacy_ids.split(';'))assertRef(refs.job_candidates,value,'submission candidate')}
  for(const entity of ['interviews','offers'])for(const row of data[entity])assertRef(refs.job_candidates,row.job_candidate_legacy_id,`${entity} pipeline`)
  for(const row of data.placements)assertRef(refs.job_candidates,row.job_candidate_legacy_id,'placement pipeline')
  for(const entity of ['revenue_splits','invoices'])for(const row of data[entity])assertRef(refs.placements,row.placement_legacy_id,`${entity} placement`)
  for(const row of Object.values(data).flat()){
    if('phone' in row&&row.phone)throw new Error(`${row.legacy_id} contains a phone number`)
    for(const [key,value] of Object.entries(row))if(key.endsWith('email')&&value&&!String(value).toLowerCase().endsWith('.example')&&!owners.includes(String(value).toLowerCase()))throw new Error(`${row.legacy_id} contains a deliverable email`)
    if('currency' in row&&row.currency&&row.currency!=='IDR')throw new Error(`${row.legacy_id} must use IDR`)
  }
  for(const placement of data.placements){const total=data.revenue_splits.filter((row)=>row.placement_legacy_id===placement.legacy_id).reduce((sum,row)=>sum+Number(row.split_percentage),0);if(total!==100)throw new Error(`${placement.legacy_id} revenue splits must total 100`)}
  const assignedOwners=new Set(Object.values(data).flat().flatMap((row)=>[row.owner_email,row.member_email].filter(Boolean)))
  for(const email of owners)if(!assignedOwners.has(email))throw new Error(`owner ${email} received no demo work`)
  return true
}

export async function writeDemoData({data,outputDirectory,anchorDate}){
  await mkdir(outputDirectory,{recursive:true})
  for(const entity of IMPORT_ORDER)await writeFile(path.join(outputDirectory,`${String(IMPORT_ORDER.indexOf(entity)+1).padStart(2,'0')}-${entity}.csv`),toCsv(data[entity]),'utf8')
  const manifest={dataset:`${PREFIX}`,anchorDate,counts:EXPECTED_COUNTS,importOrder:IMPORT_ORDER,rollbackOrder:ROLLBACK_ORDER,safety:{emails:'Reserved .example domains only',phones:'Blank',calendarSync:'Not requested',externalDelivery:'Disabled'}}
  await writeFile(path.join(outputDirectory,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`,'utf8')
  return manifest
}

function validateOwners(owners){if(!Array.isArray(owners)||owners.length!==6)throw new Error('Exactly six active consultant emails are required');const normalized=owners.map((value)=>String(value).trim().toLowerCase());if(new Set(normalized).size!==6||normalized.some((value)=>!/^\S+@\S+\.\S+$/.test(value)))throw new Error('Owner emails must be six unique valid email addresses');for(let index=0;index<owners.length;index++)owners[index]=normalized[index]}
function assertRef(set,value,label){if(!set.has(value))throw new Error(`Missing ${label} reference: ${value}`)}
function slug(value){return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'')}
function toCsv(rows){if(!rows.length)return '';const headers=Object.keys(rows[0]);return `${headers.join(',')}\n${rows.map((row)=>headers.map((header)=>escapeCsv(row[header])).join(',')).join('\n')}\n`}
function escapeCsv(value){const text=value===null||value===undefined?'':String(value);return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text}

async function cli(){
  const args=parseArgs(process.argv.slice(2));let owners=args.owners?args.owners.split(',').map((value)=>value.trim()):null
  if(args['owners-file'])owners=JSON.parse(await readFile(path.resolve(args['owners-file']),'utf8'))
  const anchorDate=args['anchor-date']||new Date().toISOString().slice(0,10)
  const outputDirectory=path.resolve(args.output||'outputs/demo-indonesia-v1')
  const data=generateDemoData({anchorDate,owners})
  const manifest=await writeDemoData({data,outputDirectory,anchorDate})
  process.stdout.write(`${JSON.stringify({outputDirectory,...manifest},null,2)}\n`)
}
function parseArgs(values){const args={};for(let index=0;index<values.length;index++){const value=values[index];if(!value.startsWith('--'))throw new Error(`Unknown argument: ${value}`);const [rawKey,inline]=value.slice(2).split('=',2);if(inline!==undefined)args[rawKey]=inline;else args[rawKey]=values[++index]}return args}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)cli().catch((error)=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1})
