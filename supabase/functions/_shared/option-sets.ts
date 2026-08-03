// Deno cannot import from src/, so this mirrors the curated vocabularies in
// src/shared/lib/optionSets.ts. src/shared/lib/optionSets.test.ts reads this file from disk and
// asserts every set matches entry for entry and alias for alias -- the same discipline
// provider-outage.ts and industries.ts follow, because two copies drifting silently is the whole risk
// and the failure mode is a migrated CSV landing values the app's own filters cannot see.
//
// Industries live in industries.ts rather than here: that list is long enough to be its own file and
// carries the key-equals-normalised-label invariant these sets deliberately do not require.
export interface MirroredOption{value:string;label:string}
export interface MirroredSet{all:readonly MirroredOption[];aliases:Readonly<Record<string,string>>}

export const OPTION_SETS:Readonly<Record<string,MirroredSet>>={
  company_size:{
    all:[
      {value:'1_10',label:'1-10'},{value:'11_50',label:'11-50'},{value:'51_100',label:'51-100'},
      {value:'101_200',label:'101-200'},{value:'201_500',label:'201-500'},{value:'501_1000',label:'501-1000'},
      {value:'1001_5000',label:'1001-5000'},{value:'5000_plus',label:'5000+'},
    ],
    aliases:{'5000':'5000_plus','5001':'5000_plus',more_than_5000:'5000_plus'},
  },
  decision_authority:{
    all:[
      {value:'decision_maker',label:'Decision maker'},{value:'budget_holder',label:'Budget holder'},
      {value:'influencer',label:'Influencer'},{value:'champion',label:'Champion'},
      {value:'gatekeeper',label:'Gatekeeper'},{value:'end_user',label:'End user'},
    ],
    aliases:{final_hiring_decision:'decision_maker',final_decision:'decision_maker',hiring_manager:'decision_maker',
      technical_sign_off:'influencer',sign_off:'influencer',budget:'budget_holder',recommender:'influencer'},
  },
  candidate_source:{
    all:[
      {value:'referral',label:'Referral'},{value:'linkedin',label:'LinkedIn'},{value:'job_board',label:'Job board'},
      {value:'website',label:'Website'},{value:'direct_approach',label:'Direct approach'},{value:'capture',label:'Capture'},
      {value:'event',label:'Event'},{value:'agency_partner',label:'Agency partner'},{value:'former_placement',label:'Former placement'},
    ],
    aliases:{jobstreet:'job_board',glints:'job_board',kalibrr:'job_board',indeed:'job_board',jobs_id:'job_board',
      headhunt:'direct_approach',headhunted:'direct_approach',outreach:'direct_approach',sourced:'direct_approach',
      network:'referral',word_of_mouth:'referral',rehire:'former_placement',career_site:'website',
      linked_in:'linkedin',li:'linkedin',career_fair:'event',conference:'event'},
  },
  candidate_availability:{
    all:[
      {value:'immediately',label:'Immediately'},{value:'within_2_weeks',label:'Within 2 weeks'},
      {value:'1_month',label:'1 month'},{value:'2_months',label:'2 months'},
      {value:'3_months_plus',label:'3+ months'},{value:'not_looking',label:'Not looking'},
    ],
    aliases:{immediate:'immediately',asap:'immediately',now:'immediately',two_weeks:'within_2_weeks',
      one_month:'1_month',two_months:'2_months',three_months:'3_months_plus',passive:'not_looking'},
  },
  employment_type:{
    all:[
      {value:'permanent',label:'Permanent'},{value:'contract',label:'Contract'},{value:'fixed_term',label:'Fixed term'},
      {value:'part_time',label:'Part time'},{value:'internship',label:'Internship'},{value:'freelance',label:'Freelance'},
    ],
    aliases:{full_time:'permanent',fulltime:'permanent',perm:'permanent',ftc:'fixed_term',
      temporary:'contract',temp:'contract',contractor:'contract',parttime:'part_time',intern:'internship'},
  },
  work_authorization:{
    all:[
      {value:'unrestricted',label:'Citizen or permanent resident'},{value:'permit_held',label:'Work permit / KITAS held'},
      {value:'requires_sponsorship',label:'Requires sponsorship'},{value:'working_holiday',label:'Working holiday visa'},
      {value:'not_eligible',label:'Not eligible to work'},
    ],
    aliases:{citizen:'unrestricted',permanent_resident:'unrestricted',pr:'unrestricted',wni:'unrestricted',
      kitas:'permit_held',kitap:'permit_held',work_permit:'permit_held',imta:'permit_held',
      sponsorship_required:'requires_sponsorship',needs_sponsorship:'requires_sponsorship',visa_required:'requires_sponsorship'},
  },
}

const normalize=(value:string)=>value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')
const indexes=new Map<string,Map<string,string>>()

/* Same resolution as the app: the normalised form of a value or its label, then the alias table, and
 * otherwise the input untouched. An unrecognised sector, size or source survives the import as typed
 * -- these columns have no CHECK, and a value nobody anticipated is worth more verbatim than dropped. */
export function resolveOption(setName:keyof typeof OPTION_SETS|string,value:string|null|undefined):string{
  const raw=(value??'').trim()
  if(!raw)return ''
  const set=OPTION_SETS[setName]
  if(!set)return raw
  let index=indexes.get(setName)
  if(!index){
    index=new Map<string,string>()
    for(const option of set.all){index.set(normalize(option.value),option.value);index.set(normalize(option.label),option.value)}
    for(const [alias,target] of Object.entries(set.aliases))index.set(normalize(alias),target)
    indexes.set(setName,index)
  }
  return index.get(normalize(raw))??raw
}
