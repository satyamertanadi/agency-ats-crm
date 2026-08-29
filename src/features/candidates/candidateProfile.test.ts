import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe,expect,it} from 'vitest'
import {
  calculateEvidenceScore,calculateMustHaveCoverage,candidateProfileDraftSchema,
  type CandidateRequirementEvidence,type ScoredRequirement,
} from './candidateProfile'

/* The internal match score and its backward compatibility.
 *
 * Two failures here are silent and unrecoverable in production, which is why they get their own
 * tests: a scoring change that makes historical drafts unparseable empties the profile history panel
 * for every workspace (stored versions are immutable, so there is no backfill), and a drift between
 * this copy of the scoring block and the edge copy makes the score written into ai_evaluations differ
 * from the score the consultant reads on screen.
 */

const evidence=(overrides:Partial<CandidateRequirementEvidence>={}):CandidateRequirementEvidence=>({
  requirement:'5+ years managing engineering teams',classification:'matched',source:'candidate_record',
  source_path:'candidate.employment[0].title',excerpt:'Engineering Manager',explanation:'Held the title for six years.',
  ...overrides,
})

const requirement=(id:string,level:ScoredRequirement['requirement_level'],weight=1):ScoredRequirement=>
  ({id,label:`Requirement ${id}`,requirement_level:level,weight})

describe('the evidence score without a requirement set',()=>{
  /* Legacy drafts and the unstructured fallback must score exactly as they always did, or the same
   * profile re-read tomorrow reports a different number than the one on the finalized document. */
  it('is the unweighted mean the function has always computed',()=>{
    const items=[evidence({classification:'matched'}),evidence({classification:'partial'}),evidence({classification:'missing'}),evidence({classification:'uncertain'})]
    expect(calculateEvidenceScore(items)).toBe(44)
    expect(calculateEvidenceScore(items,[])).toBe(44)
  })

  it('is zero for no evidence at all',()=>{
    expect(calculateEvidenceScore([])).toBe(0)
  })
})

describe('the evidence score with a weighted requirement set',()=>{
  const requirements=[requirement('a','must_have'),requirement('b','nice_to_have')]

  it('weights a must-have above a nice-to-have of the same weight',()=>{
    const missingMustHave=[evidence({requirement_id:'a',classification:'missing'}),evidence({requirement_id:'b',classification:'matched'})]
    const missingNiceToHave=[evidence({requirement_id:'a',classification:'matched'}),evidence({requirement_id:'b',classification:'missing'})]
    // Same two classifications, opposite assignment. Flat scoring gave both 50.
    expect(calculateEvidenceScore(missingMustHave,requirements)).toBe(33)
    expect(calculateEvidenceScore(missingNiceToHave,requirements)).toBe(67)
  })

  it('respects the recruiter’s own weight on top of the level',()=>{
    const heavy=[requirement('a','nice_to_have',4),requirement('b','nice_to_have',1)]
    expect(calculateEvidenceScore([evidence({requirement_id:'a',classification:'matched'}),evidence({requirement_id:'b',classification:'missing'})],heavy)).toBe(80)
  })

  it('excludes a zero-weighted requirement from the score entirely',()=>{
    const parked=[requirement('a','nice_to_have',1),requirement('b','nice_to_have',0)]
    expect(calculateEvidenceScore([evidence({requirement_id:'a',classification:'matched'}),evidence({requirement_id:'b',classification:'missing'})],parked)).toBe(100)
  })

  /* Scoring 0 would read as "matched nothing" rather than "nobody set a weight", which is a very
   * different thing to show a consultant about a real candidate. */
  it('falls back to the unweighted mean when every weight is zero',()=>{
    const unweighted=[requirement('a','nice_to_have',0),requirement('b','nice_to_have',0)]
    expect(calculateEvidenceScore([evidence({requirement_id:'a',classification:'matched'}),evidence({requirement_id:'b',classification:'missing'})],unweighted)).toBe(50)
  })

  /* A dropped id must not shrink the denominator, or omitting a requirement would raise the score. */
  it('still counts an entry whose requirement_id is missing',()=>{
    const items=[evidence({requirement_id:'a',classification:'matched'}),evidence({classification:'missing'})]
    expect(calculateEvidenceScore(items,requirements)).toBe(67)
  })

  it('is 100 when every requirement is matched and 0 when none is',()=>{
    expect(calculateEvidenceScore([evidence({requirement_id:'a'}),evidence({requirement_id:'b'})],requirements)).toBe(100)
    expect(calculateEvidenceScore([evidence({requirement_id:'a',classification:'missing'}),evidence({requirement_id:'b',classification:'missing'})],requirements)).toBe(0)
  })
})

describe('must-have coverage',()=>{
  const requirements=[requirement('a','must_have'),requirement('b','must_have'),requirement('c','nice_to_have')]

  it('counts only must-haves, and only matched ones as evidenced',()=>{
    const items=[
      evidence({requirement_id:'a',classification:'matched'}),
      // Partial is precisely the thing to go and check, so it must not read as covered.
      evidence({requirement_id:'b',classification:'partial'}),
      evidence({requirement_id:'c',classification:'matched'}),
    ]
    expect(calculateMustHaveCoverage(items,requirements)).toEqual({evidenced:1,total:2})
  })

  it('reads the level off the evidence when no requirement set is supplied',()=>{
    const items=[evidence({requirement_level:'must_have',classification:'matched'}),evidence({requirement_level:'nice_to_have'})]
    expect(calculateMustHaveCoverage(items)).toEqual({evidenced:1,total:1})
  })

  it('reports zero of zero when a vacancy has no must-haves',()=>{
    expect(calculateMustHaveCoverage([evidence({requirement_id:'c'})],requirements)).toEqual({evidenced:0,total:0})
  })
})

describe('parsing stored profile drafts',()=>{
  const base={
    candidate_summary:['A summary line.'],strengths_opportunities:'Strong delivery record.',
    risks_challenges:'Notice period unknown.',points_to_validate:['Confirm notice period.'],
    experience_relevance:[{company_name:'Kinarya',title:'Engineering Manager',relevance:['Led the platform team.']}],
    requirement_evidence:[evidence()],score:75,
  }

  /* The one that matters most. listCandidateProfileVersions parses EVERY historical
   * generated_content through this schema; a required new field empties the whole history panel. */
  it('still parses a draft written before structured requirements existed',()=>{
    const result=candidateProfileDraftSchema.safeParse(base)
    expect(result.success).toBe(true)
    if(!result.success)return
    expect(result.data.must_have_coverage).toBeUndefined()
    expect(result.data.requirements_source).toBeUndefined()
    expect(result.data.requirement_evidence[0]?.requirement_id).toBeUndefined()
  })

  it('parses a draft carrying the new fields',()=>{
    const result=candidateProfileDraftSchema.safeParse({
      ...base,
      requirement_evidence:[evidence({requirement_id:'11111111-1111-1111-1111-111111111111',requirement_level:'must_have'})],
      must_have_coverage:{evidenced:1,total:2},requirements_source:'structured',
    })
    expect(result.success).toBe(true)
    if(!result.success)return
    expect(result.data.must_have_coverage).toEqual({evidenced:1,total:2})
  })

  it('accepts CV evidence and holds it to a cv. path with an excerpt',()=>{
    expect(candidateProfileDraftSchema.safeParse({...base,requirement_evidence:[
      evidence({source:'candidate_cv',source_path:'cv.experience.kinarya',excerpt:'Scaled the team from 4 to 19.'}),
    ]}).success).toBe(true)
    // A CV citation pointing at a candidate.* path is claiming a checkability it does not have.
    expect(candidateProfileDraftSchema.safeParse({...base,requirement_evidence:[
      evidence({source:'candidate_cv',source_path:'candidate.employment[0]',excerpt:'Engineering Manager'}),
    ]}).success).toBe(false)
    expect(candidateProfileDraftSchema.safeParse({...base,requirement_evidence:[
      evidence({source:'candidate_cv',source_path:'cv.summary',excerpt:''}),
    ]}).success).toBe(false)
  })

  it('keeps refusing evidence that cites nothing while claiming a source',()=>{
    expect(candidateProfileDraftSchema.safeParse({...base,requirement_evidence:[
      evidence({source:'none',source_path:'candidate.location',excerpt:'Jakarta'}),
    ]}).success).toBe(false)
    expect(candidateProfileDraftSchema.safeParse({...base,requirement_evidence:[
      evidence({source:'candidate_record',source_path:'role.description',excerpt:'Own the mandate.'}),
    ]}).success).toBe(false)
  })
})

/* The Deno edge runtime cannot import from src/, so the scoring block exists twice. Nothing but this
 * stops the two from drifting apart -- and a drift means the number persisted to ai_evaluations and
 * the number rendered in the evidence panel are computed by different code. */
describe('the edge copy of the scoring contract',()=>{
  const between=(source:string)=>{
    const marked=source.split('// --- scoring:begin ---')[1]?.split('// --- scoring:end ---')[0]
    expect(marked,'both copies must carry the scoring:begin/scoring:end markers').toBeDefined()
    return marked
  }

  it('is byte-identical to this one',()=>{
    const here=between(readFileSync(resolve(__dirname,'./candidateProfile.ts'),'utf8'))
    const edge=between(readFileSync(resolve(__dirname,'../../../supabase/functions/_shared/profile-schema.ts'),'utf8'))
    expect(edge).toBe(here)
  })
})
