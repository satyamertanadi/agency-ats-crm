import {describe,expect,it} from 'vitest'
import type {CompanyPipelineRow} from '../../shared/types/domain'
import {accountRisks,bdStageLabel,bdSummary,filterAccountHealth,groupCompaniesByStage} from './bdPipeline'

const now=new Date('2026-07-18T10:00:00Z')
const company=(overrides:Partial<CompanyPipelineRow> = {}):CompanyPipelineRow=>({
  id:'c1',name:'Northstar Energy',industry:null,location:null,account_status:'prospect',
  business_development_stage:'qualifying',owner_member_id:'m1',owner_name:'Ayu',
  contact_count:2,open_jobs:0,active_candidates:0,
  next_follow_up_at:'2026-07-20T10:00:00Z',last_activity_at:'2026-07-17T10:00:00Z',placements:0,
  terms_status:'active',fee_type:'percentage',fee_percentage:18,fixed_fee:null,currency:'IDR',
  guarantee_days:90,terms_effective_to:null,expected_open_fee:0,updated_at:'2026-07-17T10:00:00Z',
  ...overrides,
})

describe('BD pipeline grouping',()=>{
  it('gives every default stage a column even when empty',()=>{
    const columns=groupCompaniesByStage([company()])
    expect(columns.map((column)=>column.key)).toEqual(['lead','qualifying','pitching','negotiating','won','lost','dormant'])
    expect(columns.find((column)=>column.key==='qualifying')?.companies).toHaveLength(1)
  })

  /* business_development_stage has no database check constraint, so an imported workspace can hold
   * anything. A client that vanishes from the board is a client nobody works. */
  it('keeps accounts whose stage is not in the default flow',()=>{
    const columns=groupCompaniesByStage([company({id:'c2',business_development_stage:'referral_only'})])
    const extra=columns.at(-1)!
    expect(extra.key).toBe('referral_only')
    expect(extra.companies.map((row)=>row.id)).toEqual(['c2'])
    expect(columns.flatMap((column)=>column.companies)).toHaveLength(1)
  })

  it('totals open jobs and expected fee per column',()=>{
    const columns=groupCompaniesByStage([
      company({id:'a',business_development_stage:'won',open_jobs:2,expected_open_fee:50_000_000}),
      company({id:'b',business_development_stage:'won',open_jobs:1,expected_open_fee:25_000_000}),
    ])
    const won=columns.find((column)=>column.key==='won')!
    expect(won.openJobs).toBe(3)
    expect(won.value).toBe(75_000_000)
  })
})

describe('account risk',()=>{
  it('reports nothing for a healthy worked account',()=>{
    expect(accountRisks(company(),now)).toEqual([])
  })

  it('flags an unowned account with an overdue follow-up',()=>{
    const risks=accountRisks(company({owner_member_id:null,next_follow_up_at:'2026-07-10T10:00:00Z'}),now)
    expect(risks.map((risk)=>risk.key)).toEqual(['unowned','follow_up_overdue'])
  })

  /* "No next action" and "follow-up overdue" are the same underlying gap in two states. Reporting
   * both would double-count one account against the at-risk headline. */
  it('reports a missing next action only when no follow-up exists at all',()=>{
    expect(accountRisks(company({next_follow_up_at:null}),now).map((risk)=>risk.key)).toContain('no_next_action')
    expect(accountRisks(company({next_follow_up_at:'2026-07-10T10:00:00Z'}),now).map((risk)=>risk.key)).not.toContain('no_next_action')
  })

  it('flags an account with no recent contact',()=>{
    expect(accountRisks(company({last_activity_at:'2026-06-01T10:00:00Z'}),now).map((risk)=>risk.key)).toContain('stale')
    expect(accountRisks(company({last_activity_at:null}),now).map((risk)=>risk.key)).toContain('stale')
  })

  /* Chasing a brand-new lead for a signed fee agreement is not a real finding; chasing a won account
   * or one already carrying open roles is. */
  it('raises commercial gaps only once an account is winnable',()=>{
    expect(accountRisks(company({terms_status:'none'}),now).map((risk)=>risk.key)).not.toContain('terms_missing')
    expect(accountRisks(company({terms_status:'none',business_development_stage:'won'}),now).map((risk)=>risk.key)).toContain('terms_missing')
    expect(accountRisks(company({terms_status:'expired',open_jobs:1}),now).map((risk)=>risk.key)).toContain('terms_expired')
  })

  it('leaves closed accounts alone',()=>{
    expect(accountRisks(company({business_development_stage:'lost',owner_member_id:null,next_follow_up_at:null,last_activity_at:null}),now)).toEqual([])
    expect(accountRisks(company({business_development_stage:'dormant',owner_member_id:null,next_follow_up_at:null}),now)).toEqual([])
  })
})

describe('BD summary',()=>{
  it('counts only accounts still in play toward pipeline value',()=>{
    const summary=bdSummary([
      company({id:'a',business_development_stage:'pitching',expected_open_fee:40_000_000}),
      company({id:'b',business_development_stage:'won',expected_open_fee:60_000_000,open_jobs:2}),
      company({id:'c',business_development_stage:'lost',expected_open_fee:99_000_000}),
      company({id:'d',business_development_stage:'dormant',expected_open_fee:99_000_000}),
    ],now)
    expect(summary.pipelineValue).toBe(100_000_000)
    expect(summary.active).toBe(2)
    expect(summary.won).toBe(1)
    expect(summary.openJobs).toBe(2)
  })

  it('counts an at-risk account once however many risks it carries',()=>{
    const summary=bdSummary([company({owner_member_id:null,next_follow_up_at:null,last_activity_at:null})],now)
    expect(summary.atRisk).toBe(1)
    expect(summary.unowned).toBe(1)
  })
})

describe('bdStageLabel',()=>{
  it('uses the product vocabulary for a known stage',()=>{
    expect(bdStageLabel('negotiating')).toBe('Negotiating')
  })

  /* The column has no check constraint, so an import brings whatever the previous system wrote. Three
   * casing conventions in one column read as three different values rather than one written three
   * ways. */
  const importedStages=[['NEGOTIATING','Negotiating'],['client_review','Client review'],['Warm Lead','Warm lead']] as const
  it.each(importedStages)('normalises the casing of an unknown stage %j',(stored,shown)=>{
    expect(bdStageLabel(stored)).toBe(shown)
  })

  it('never returns an empty label for a value that had one',()=>{
    expect(bdStageLabel('___')).toBe('___')
  })
})

describe('filterAccountHealth',()=>{
  const now=new Date('2026-08-25T00:00:00Z')
  const worked=company({business_development_stage:'won',owner_member_id:null,next_follow_up_at:null,last_activity_at:null})
  const clean=company({business_development_stage:'won',owner_member_id:'m1',
    next_follow_up_at:'2026-09-01T00:00:00Z',last_activity_at:'2026-08-24T00:00:00Z',terms_status:'active',open_jobs:1})

  it('passes everything through on "all"',()=>{
    expect(filterAccountHealth([worked,clean],'all',now)).toHaveLength(2)
  })

  /* Every option is a question about accountRisks rather than its own predicate, so the filter cannot
   * disagree with the risk badges on the rows it is filtering, or with the "Need attention" figure
   * above the table. That is the property worth pinning, not the individual thresholds. */
  it('agrees with accountRisks about which accounts need attention',()=>{
    const rows=[worked,clean]
    const byFilter=filterAccountHealth(rows,'attention',now)
    const byRisk=rows.filter((row)=>accountRisks(row,now).length>0)
    expect(byFilter).toEqual(byRisk)
  })

  it('treats "no open risks" as the complement, over worked accounts only',()=>{
    expect(filterAccountHealth([worked,clean],'healthy',now)).toEqual([clean])
    // A lost account has no risks, but calling it healthy would be an odd claim for the list to make.
    const lost=company({business_development_stage:'lost'})
    expect(filterAccountHealth([lost],'healthy',now)).toEqual([])
  })
})
