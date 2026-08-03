import {optionSet} from './optionSet'

/* The short categorical vocabularies, together in one file because each is six lines and a file apiece
 * would be more ceremony than content. Industries and currencies keep their own modules: those lists
 * are long, and the reasoning behind which entries made the cut is the point of the file.
 *
 * Every column below was `text` with no CHECK and a free-text input, which is why each carries aliases
 * for what is already stored. Rows an alias does not catch stay exactly as typed -- they surface in
 * the dropdown as a prepended option, which is how we find out what the curated list is missing. */

/* Buckets chosen to match what the workspace already holds rather than a tidier set, so existing
 * records land on an option instead of each becoming its own. */
export const companySize=optionSet([
  {value:'1_10',label:'1-10'},
  {value:'11_50',label:'11-50'},
  {value:'51_100',label:'51-100'},
  {value:'101_200',label:'101-200'},
  {value:'201_500',label:'201-500'},
  {value:'501_1000',label:'501-1000'},
  {value:'1001_5000',label:'1001-5000'},
  {value:'5000_plus',label:'5000+'},
],{'5000':'5000_plus','5001':'5000_plus',more_than_5000:'5000_plus'})

/* Who the contact is in the deal, which is what a consultant actually needs before a pitch -- the
 * free-text column held job-title-ish phrases like "Final hiring decision" instead. */
export const decisionAuthority=optionSet([
  {value:'decision_maker',label:'Decision maker'},
  {value:'budget_holder',label:'Budget holder'},
  {value:'influencer',label:'Influencer'},
  {value:'champion',label:'Champion'},
  {value:'gatekeeper',label:'Gatekeeper'},
  {value:'end_user',label:'End user'},
],{final_hiring_decision:'decision_maker',final_decision:'decision_maker',hiring_manager:'decision_maker',
  technical_sign_off:'influencer',sign_off:'influencer',budget:'budget_holder',recommender:'influencer'})

/* 'Capture' and 'Referral' are not aspirational: capture_prospect (20260718100000 :24) and the
 * referral acceptance path already write those exact strings, so a curated list that omitted them
 * would put every self-served candidate in "Other" on day one. */
export const candidateSource=optionSet([
  {value:'referral',label:'Referral'},
  {value:'linkedin',label:'LinkedIn'},
  {value:'job_board',label:'Job board'},
  {value:'website',label:'Website'},
  {value:'direct_approach',label:'Direct approach'},
  {value:'capture',label:'Capture'},
  {value:'event',label:'Event'},
  {value:'agency_partner',label:'Agency partner'},
  {value:'former_placement',label:'Former placement'},
],{jobstreet:'job_board',glints:'job_board',kalibrr:'job_board',indeed:'job_board',jobs_id:'job_board',
  headhunt:'direct_approach',headhunted:'direct_approach',outreach:'direct_approach',sourced:'direct_approach',
  network:'referral',word_of_mouth:'referral',rehire:'former_placement',career_site:'website',
  linked_in:'linkedin',li:'linkedin',career_fair:'event',conference:'event'})

/* Buckets rather than dates: "from March" was true when it was typed and wrong a quarter later, and
 * nothing re-asked. notice_period_days remains the precise field for candidates who have one. */
export const candidateAvailability=optionSet([
  {value:'immediately',label:'Immediately'},
  {value:'within_2_weeks',label:'Within 2 weeks'},
  {value:'1_month',label:'1 month'},
  {value:'2_months',label:'2 months'},
  {value:'3_months_plus',label:'3+ months'},
  {value:'not_looking',label:'Not looking'},
],{immediate:'immediately',asap:'immediately',now:'immediately',two_weeks:'within_2_weeks',
  one_month:'1_month',two_months:'2_months',three_months:'3_months_plus',passive:'not_looking'})

/* Phrased as the question a client actually asks -- can this person start without us sponsoring
 * anything -- rather than by permit name, which differs per market. */
export const workAuthorization=optionSet([
  {value:'unrestricted',label:'Citizen or permanent resident'},
  {value:'permit_held',label:'Work permit / KITAS held'},
  {value:'requires_sponsorship',label:'Requires sponsorship'},
  {value:'working_holiday',label:'Working holiday visa'},
  {value:'not_eligible',label:'Not eligible to work'},
],{citizen:'unrestricted',permanent_resident:'unrestricted',pr:'unrestricted',wni:'unrestricted',
  kitas:'permit_held',kitap:'permit_held',work_permit:'permit_held',imta:'permit_held',
  sponsorship_required:'requires_sponsorship',needs_sponsorship:'requires_sponsorship',visa_required:'requires_sponsorship'})

/* jobs.employment_type had no input anywhere in the product -- only the CSV importer and the seed ever
 * wrote it -- so every hand-created job has carried a null since launch. */
export const employmentType=optionSet([
  {value:'permanent',label:'Permanent'},
  {value:'contract',label:'Contract'},
  {value:'fixed_term',label:'Fixed term'},
  {value:'part_time',label:'Part time'},
  {value:'internship',label:'Internship'},
  {value:'freelance',label:'Freelance'},
],{full_time:'permanent',fulltime:'permanent',perm:'permanent',ftc:'fixed_term',
  temporary:'contract',temp:'contract',contractor:'contract',parttime:'part_time',intern:'internship'})

/* Hardcoded to 'client_interview' at the only call site that creates one, so the column has never
 * distinguished a phone screen from a final panel. */
export const interviewType=optionSet([
  {value:'phone_screen',label:'Phone screen'},
  {value:'client_interview',label:'Client interview'},
  {value:'technical',label:'Technical interview'},
  {value:'panel',label:'Panel interview'},
  {value:'final',label:'Final interview'},
],{screen:'phone_screen',phone:'phone_screen',first_round:'phone_screen',client:'client_interview',
  tech:'technical',technical_test:'technical',final_round:'final'})

/* One scale for both skills and languages would be wrong: "Advanced" describes a skill, "Fluent"
 * describes a language, and forcing either onto the other is how a CV profile reads as machine-made. */
export const skillProficiency=optionSet([
  {value:'beginner',label:'Beginner'},
  {value:'intermediate',label:'Intermediate'},
  {value:'advanced',label:'Advanced'},
  {value:'expert',label:'Expert'},
],{basic:'beginner',novice:'beginner',competent:'intermediate',proficient:'advanced',master:'expert'})

export const languageProficiency=optionSet([
  {value:'native',label:'Native'},
  {value:'fluent',label:'Fluent'},
  {value:'professional',label:'Professional working'},
  {value:'conversational',label:'Conversational'},
  {value:'basic',label:'Basic'},
],{mother_tongue:'native',bilingual:'native',business:'professional',
  professional_working:'professional',intermediate:'conversational',beginner:'basic',elementary:'basic'})

/* The languages this market's placements actually involve. Anything else goes through Other. */
export const language=optionSet([
  {value:'indonesian',label:'Indonesian'},
  {value:'english',label:'English'},
  {value:'mandarin',label:'Mandarin'},
  {value:'javanese',label:'Javanese'},
  {value:'balinese',label:'Balinese'},
  {value:'sundanese',label:'Sundanese'},
  {value:'japanese',label:'Japanese'},
  {value:'korean',label:'Korean'},
  {value:'dutch',label:'Dutch'},
  {value:'german',label:'German'},
  {value:'french',label:'French'},
  {value:'russian',label:'Russian'},
  {value:'arabic',label:'Arabic'},
  {value:'spanish',label:'Spanish'},
],{bahasa:'indonesian',bahasa_indonesia:'indonesian',id:'indonesian',en:'english',
  chinese:'mandarin',mandarin_chinese:'mandarin',bahasa_jawa:'javanese',bahasa_bali:'balinese'})

/* Indonesian levels first, since that is what a local CV states, with the international equivalents
 * in the label so a client-facing profile reads correctly either way. */
export const educationLevel=optionSet([
  {value:'high_school',label:'High school (SMA/SMK)'},
  {value:'diploma',label:'Diploma (D1-D4)'},
  {value:'bachelor',label:'Bachelor (S1)'},
  {value:'master',label:'Master (S2)'},
  {value:'doctorate',label:'Doctorate (S3)'},
  {value:'certification',label:'Professional certification'},
],{sma:'high_school',smk:'high_school',senior_high_school:'high_school',
  d1:'diploma',d2:'diploma',d3:'diploma',d4:'diploma',associate:'diploma',
  s1:'bachelor',bachelors:'bachelor',be:'bachelor',bsc:'bachelor',ba:'bachelor',
  s2:'master',masters:'master',msc:'master',ma:'master',mba:'master',
  s3:'doctorate',phd:'doctorate',doctoral:'doctorate'})

/* "For the right role" is the honest and most common answer, and a free-text box is how it used to be
 * recorded as six different sentences. */
export const relocationWillingness=optionSet([
  {value:'yes',label:'Yes'},
  {value:'right_role',label:'For the right role'},
  {value:'within_country',label:'Within country only'},
  {value:'no',label:'No'},
],{willing:'yes',open:'right_role',maybe:'right_role',negotiable:'right_role',
  domestic_only:'within_country',not_willing:'no'})

export const taxTreatment=optionSet([
  {value:'vat_exclusive',label:'VAT exclusive'},
  {value:'vat_inclusive',label:'VAT inclusive'},
  {value:'not_applicable',label:'Not applicable'},
],{exclusive:'vat_exclusive',ex_vat:'vat_exclusive',plus_vat:'vat_exclusive',
  inclusive:'vat_inclusive',incl_vat:'vat_inclusive',none:'not_applicable',na:'not_applicable'})

/* Numeric, but a select: these five cover essentially every agreement, and Other still accepts a
 * typed number for the client who negotiated 21. */
export const paymentTermsDays=optionSet([
  {value:'7',label:'7 days'},
  {value:'14',label:'14 days'},
  {value:'30',label:'30 days'},
  {value:'45',label:'45 days'},
  {value:'60',label:'60 days'},
])
