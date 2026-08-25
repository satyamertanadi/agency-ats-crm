import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe,expect,it} from 'vitest'
import {issueFixHref,issueLabel,parseIssue,qualityIssueDefinition,qualityIssues} from './candidateQuality'
import {candidateQueues} from './candidateQueues'

/* This module holds no rules -- public.candidate_quality_issues does, so the queue predicate, the
 * summary counts and the per-row codes are one answer rather than three. What is asserted here is
 * the half TypeScript owns: that every code the SQL can emit has a label, a reason and somewhere to
 * go, that an unknown one degrades rather than disappearing, and that the queue's tooltip still
 * describes the predicate the migration actually applies.
 *
 * Resolved from the Vitest root rather than import.meta.url: these run under jsdom, where
 * import.meta.url is an http:// URL and fileURLToPath refuses it. */
const migration=readFileSync(resolve(process.cwd(),'supabase/migrations/20260827000000_candidate_quality_issues.sql'),'utf8')

describe('the issue vocabulary',()=>{
  /* The SQL is the source of truth, so drift can only be caught by reading it. A rule added to the
   * helper without a definition here would render its own snake_case identifier to a consultant. */
  it('covers exactly the codes the migration can emit, in the same order',()=>{
    const start=migration.indexOf('create or replace function public.candidate_quality_issues')
    const body=migration.slice(start,migration.indexOf('$$;',start))
    expect(start).toBeGreaterThan(0)
    const fromSql=[...body.matchAll(/then '([a-z_]+)' end/g)].map((match)=>match[1])
    expect(fromSql.length).toBe(5)
    /* Order matters, not just membership: the chips in Quick View and the buttons in the summary
     * strip both render in definition order, and the array the SQL builds is what a reader compares
     * them against. */
    expect(qualityIssues.map((issue)=>issue.id)).toEqual(fromSql)
  })

  it('gives every issue a reason and somewhere to fix it',()=>{
    for(const issue of qualityIssues){
      expect(issue.reason.length,`${issue.id} has no reason`).toBeGreaterThan(30)
      expect(issue.reason.endsWith('.')).toBe(true)
      expect(['overview','profile','documents']).toContain(issue.tab)
      expect(issue.action.length).toBeGreaterThan(0)
      // The label names the gap in words, never the code.
      expect(issue.label).not.toContain('_')
    }
  })

  /* There is no score and no completeness percentage, and this is the test that keeps it that way.
   * A number that goes up when you fill in a portfolio URL teaches people that filling in fields is
   * the goal -- more fields filled does not automatically mean better data. */
  it('describes gaps rather than scoring records',()=>{
    const text=JSON.stringify(qualityIssues).toLowerCase()
    for(const word of ['score','complete','percent','%','rating','grade']){
      expect(text,`the vocabulary drifted toward scoring: ${word}`).not.toContain(word)
    }
  })

  it('routes each gap to the part of the record that closes it',()=>{
    expect(issueFixHref('acme','cand-1','missing_cv')).toBe('/app/acme/candidates/cand-1?tab=documents')
    expect(issueFixHref('acme','cand-1','missing_skills')).toBe('/app/acme/candidates/cand-1?tab=profile')
    expect(issueFixHref('acme','cand-1','missing_contact_method')).toBe('/app/acme/candidates/cand-1?tab=overview')
  })

  /* A server can gain a rule before the screen learns about it. A chip reading "missing_visa" is more
   * use to a consultant -- and to whoever gets the bug report -- than a row that silently shows one
   * fewer problem than it has. */
  it('renders an unknown code as itself rather than dropping it',()=>{
    const unknown=qualityIssueDefinition('missing_visa')
    expect(unknown.label).toBe('missing_visa')
    expect(unknown.tab).toBe('overview')
    expect(issueLabel('missing_visa')).toBe('missing_visa')
    expect(issueLabel(null)).toBeNull()
  })
})

describe('parseIssue',()=>{
  it('accepts every code the SQL serves',()=>{
    for(const issue of qualityIssues)expect(parseIssue(issue.id)).toBe(issue.id)
  })

  /* Fails closed, matching the migration's CASE, where an unrecognised code falls to `= any(...)`
   * against an array that cannot contain it and therefore matches nothing. A chip claiming a filter
   * that is not applying is worse than no chip. */
  it('treats anything it does not serve as no filter',()=>{
    expect(parseIssue('missing_visa')).toBeNull()
    expect(parseIssue('')).toBeNull()
    expect(parseIssue(null)).toBeNull()
    expect(parseIssue(undefined)).toBeNull()
    expect(parseIssue('  ')).toBeNull()
  })

  // Whitespace forgiven, case not -- the same contract parseQueue keeps, for the same reason.
  it('forgives whitespace so the value it sends is one the SQL can match',()=>{
    expect(parseIssue(' missing_cv ')).toBe('missing_cv')
    expect(parseIssue('Missing_CV')).toBeNull()
  })
})

describe('the queue and the codes agree',()=>{
  /* The queue predicate is now literally "cardinality(candidate_quality_issues) > 0". Its tooltip is
   * the only place a consultant can learn what that means, so a rule added to the helper without a
   * matching word in the tooltip leaves the queue unexplained -- which is the thing candidateQueues
   * exists to prevent. */
  it('names every issue in the enrichment queue rule',()=>{
    const rule=candidateQueues.find((queue)=>queue.id==='needs_enrichment')?.rule||''
    expect(rule).toContain('role')
    expect(rule).toContain('location')
    expect(rule).toContain('skills')
    expect(rule).toContain('CV')
    expect(rule).toContain('reach them')
  })

  it('is pinned to the migration that owns the predicate',()=>{
    expect(migration).toContain("when $15='needs_enrichment' then cardinality(public.candidate_quality_issues(")
  })

  /* The permission flag is the load-bearing argument: read the private columns without it and every
   * candidate reads as missing contact details to exactly the members not allowed to know. */
  it('passes the private-read permission into every call site',()=>{
    const calls=migration.split('public.candidate_quality_issues(').length-1
    // The definition, the queue predicate, the issue filter, the outer select, and the summary.
    expect(calls).toBeGreaterThanOrEqual(5)
    const guarded=migration.split("public.has_permission($1,'candidates_private.read')").length-1
    expect(guarded).toBe(4)
  })

  /* Every function this migration touches must stay unreachable by anon and PUBLIC.
   * tests/rls/rpc-acl.test.ts is the real guard; this catches a missing line at review time. */
  it('locks its functions away from anon and PUBLIC',()=>{
    for(const name of ['candidate_quality_issues','search_candidates_page','candidate_quality_summary']){
      expect(migration,`${name} is not revoked`).toContain(`revoke all on function public.${name}(`)
      expect(migration,`${name} is not granted`).toContain(`grant execute on function public.${name}(`)
    }
  })
})
