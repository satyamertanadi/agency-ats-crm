import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe,expect,it} from 'vitest'
import {optionSet} from './optionSet'
import {candidateAvailability,candidateSource,companySize,decisionAuthority,employmentType,workAuthorization} from './optionSets'

/* Two things are worth testing here and neither is the option lists themselves: that the shared
 * resolution rule behaves, and that the Deno mirror the CSV importer uses has not drifted. */

describe('optionSet',()=>{
  const set=optionSet([{value:'job_board',label:'Job board'},{value:'201_500',label:'201-500'}],{jobstreet:'job_board'})

  it('resolves by value, by label, and by alias',()=>{
    expect(set.key('job_board')).toBe('job_board')
    expect(set.key('Job Board')).toBe('job_board')
    expect(set.key('JobStreet')).toBe('job_board')
    // Indexing the label too is what lets a set use values that do not normalise from their own
    // labels -- '201-500' would otherwise be unresolvable from the string a CSV carries.
    expect(set.key('201-500')).toBe('201_500')
    expect(set.key('201_500')).toBe('201_500')
  })

  it('returns unrecognised input untouched rather than key-shaping it',()=>{
    expect(set.key('Referred by a friend')).toBe('Referred by a friend')
    expect(set.key('')).toBe('')
    expect(set.key(null)).toBe('')
  })

  it('keeps an unrecognised current value selectable',()=>{
    const options=set.options('Referred by a friend')
    expect(options).toHaveLength(3)
    expect(options[0]).toEqual({value:'Referred by a friend',label:'Referred by a friend'})
    expect(set.options('JobStreet')).toHaveLength(2)
  })

  it('labels known values, de-keys key-shaped strays, and leaves prose alone',()=>{
    expect(set.label('job_board')).toBe('Job board')
    expect(set.label('JobStreet')).toBe('Job board')
    expect(set.label('some_new_channel')).toBe('Some new channel')
    expect(set.label('Referred by a friend')).toBe('Referred by a friend')
    expect(set.label(null)).toBe('')
  })
})

describe('the retrofitted vocabularies',()=>{
  it('resolves the literals the backend already writes',()=>{
    // capture_prospect and the referral acceptance path write these exact strings today, so a curated
    // list that could not resolve them would put every self-served candidate in Other.
    expect(candidateSource.key('Capture')).toBe('capture')
    expect(candidateSource.key('Referral')).toBe('referral')
  })

  it('resolves the sizes the seed and demo workspaces already hold',()=>{
    for(const raw of ['101-200','201-500','501-1000','1001-5000'])expect(companySize.all.some((option)=>option.value===companySize.key(raw))).toBe(true)
  })

  it('resolves the decision-authority phrases the seed data uses',()=>{
    expect(decisionAuthority.key('Final hiring decision')).toBe('decision_maker')
    expect(decisionAuthority.key('Technical sign-off')).toBe('influencer')
  })

  it('resolves market-specific work authorization wording',()=>{
    expect(workAuthorization.key('KITAS')).toBe('permit_held')
    expect(workAuthorization.key('Needs sponsorship')).toBe('requires_sponsorship')
  })

  it('resolves availability written as a phrase',()=>{
    expect(candidateAvailability.key('ASAP')).toBe('immediately')
    expect(candidateAvailability.key('3+ months')).toBe('3_months_plus')
  })
})

describe('edge-function mirror',()=>{
  /* The importer runs in Deno and cannot import from src/, so supabase/functions/_shared/option-sets.ts
   * carries a copy. If it drifts, a migrated CSV lands values the app's own filters cannot see -- which
   * is silent, and only visible as a filter that mysteriously misses records. */
  const source=readFileSync(resolve(__dirname,'../../../supabase/functions/_shared/option-sets.ts'),'utf8')
  const sets={company_size:companySize,decision_authority:decisionAuthority,candidate_source:candidateSource,
    candidate_availability:candidateAvailability,employment_type:employmentType,work_authorization:workAuthorization}

  const block=(name:string)=>{
    const start=source.indexOf(`  ${name}:{`)
    expect(start,`edge copy is missing the ${name} set`).toBeGreaterThan(-1)
    const next=source.indexOf('\n  },\n',start)
    return source.slice(start,next)
  }

  it.each(Object.keys(sets))('mirrors the %s options',(name)=>{
    const text=block(name)
    const all=text.slice(text.indexOf('all:['),text.indexOf('aliases:'))
    const options=[...all.matchAll(/\{value:'([^']+)',label:'([^']+)'\}/g)].map((match)=>({value:match[1]!,label:match[2]!}))
    expect(options).toEqual(sets[name as keyof typeof sets].all)
  })

  it.each(Object.keys(sets))('mirrors the %s aliases',(name)=>{
    const text=block(name)
    const aliases=[...text.slice(text.indexOf('aliases:')).matchAll(/'?([a-z0-9_]+)'?:'([a-z0-9_]+)'/g)].map((match)=>[match[1]!,match[2]!] as const)
    expect(aliases.length,`${name} should mirror at least one alias`).toBeGreaterThan(0)
    const set=sets[name as keyof typeof sets]
    const known=new Set(set.all.map((option)=>option.value))
    for(const [alias,target] of aliases){
      expect(known.has(target),`${name} alias ${alias} points at unknown value ${target}`).toBe(true)
      expect(set.key(alias),`${name}: app and edge copy disagree on ${alias}`).toBe(target)
    }
  })
})
