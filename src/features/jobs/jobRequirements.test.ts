import {describe,expect,it} from 'vitest'
import {
  draftedRequirementSchema,draftedToRequirement,jobRequirementListSchema,
  mergeDraftedRequirements,moveRequirement,summarizeRequirements,type JobRequirement,
} from './jobRequirements'

const requirement=(label:string,overrides:Partial<JobRequirement>={}):JobRequirement=>({
  label,requirement_level:'nice_to_have',category:'skill',weight:1,evidence_expected:null,source:'manual',...overrides,
})

describe('the job requirement list',()=>{
  it('accepts a normal set',()=>{
    expect(jobRequirementListSchema.safeParse([requirement('5+ years managing engineering teams'),requirement('Holds a CPA licence')]).success).toBe(true)
  })

  /* Not a tidiness rule. Each row is one entry in the assessment, so a duplicate counts twice in the
   * denominator and doubles its own weight without anyone choosing that. */
  it('rejects a duplicate requirement and points at the second one',()=>{
    const result=jobRequirementListSchema.safeParse([requirement('Fluent written English'),requirement('  fluent   Written English  ')])
    expect(result.success).toBe(false)
    if(result.success)return
    const issue=result.error.issues.find((entry)=>entry.message==='This requirement is already listed.')
    expect(issue?.path).toEqual([1,'label'])
  })

  it('keeps weight 0, which parks a requirement without scoring it',()=>{
    const result=jobRequirementListSchema.safeParse([requirement('Nice to have Figma',{weight:0})])
    expect(result.success).toBe(true)
    if(!result.success)return
    expect(result.data[0]?.weight).toBe(0)
  })

  it('rejects a weight above 10 and a label too short to evidence',()=>{
    expect(jobRequirementListSchema.safeParse([requirement('X',{weight:1})]).success).toBe(false)
    expect(jobRequirementListSchema.safeParse([requirement('Valid requirement',{weight:11})]).success).toBe(false)
  })

  it('refuses more than the forty the RPC would accept',()=>{
    const many=Array.from({length:41},(_,index)=>requirement(`Requirement number ${index}`))
    expect(jobRequirementListSchema.safeParse(many).success).toBe(false)
  })
})

describe('merging a drafted set into what is on screen',()=>{
  /* Regenerating after editing the description is normal, and a straight replace would delete the
   * requirements a consultant typed from a phone call the JD never mentioned -- exactly the knowledge
   * the model does not have. */
  it('appends only genuinely new rows and never drops the recruiter’s own',()=>{
    const existing=[requirement('Willing to relocate to Lombok',{source:'manual'})]
    const drafted=[requirement('Willing to relocate to Lombok',{source:'ai_draft'}),requirement('5+ years in hospitality',{source:'ai_draft'})]
    const {merged,addedCount,skippedCount}=mergeDraftedRequirements(existing,drafted)
    expect(merged.map((item)=>item.label)).toEqual(['Willing to relocate to Lombok','5+ years in hospitality'])
    expect(merged[0]?.source).toBe('manual')
    expect(addedCount).toBe(1)
    expect(skippedCount).toBe(1)
  })

  it('matches on normalised labels so casing and spacing do not create a near-duplicate',()=>{
    const {addedCount}=mergeDraftedRequirements([requirement('Fluent Bahasa Indonesia')],[requirement('fluent  bahasa indonesia')])
    expect(addedCount).toBe(0)
  })

  it('deduplicates within the draft itself',()=>{
    const {merged}=mergeDraftedRequirements([],[requirement('CPA licence'),requirement('CPA Licence')])
    expect(merged).toHaveLength(1)
  })

  it('never pushes the set past the cap',()=>{
    const existing=Array.from({length:38},(_,index)=>requirement(`Existing ${index}`))
    const drafted=Array.from({length:10},(_,index)=>requirement(`Drafted ${index}`))
    expect(mergeDraftedRequirements(existing,drafted).merged).toHaveLength(40)
  })
})

describe('reordering',()=>{
  const rows=[requirement('One'),requirement('Two'),requirement('Three')]

  it('moves a row and leaves the rest in order',()=>{
    expect(moveRequirement(rows,2,0).map((item)=>item.label)).toEqual(['Three','One','Two'])
  })

  it('is a no-op at the ends and for a move to itself',()=>{
    expect(moveRequirement(rows,0,-1)).toBe(rows)
    expect(moveRequirement(rows,2,3)).toBe(rows)
    expect(moveRequirement(rows,1,1)).toBe(rows)
  })
})

describe('the drafting contract',()=>{
  it('marks a drafted row ai_draft and defaults its weight',()=>{
    const drafted=draftedToRequirement(draftedRequirementSchema.parse({label:'Team leadership',requirement_level:'must_have',category:'experience'}))
    expect(drafted).toMatchObject({source:'ai_draft',weight:1,evidence_expected:null,requirement_level:'must_have'})
  })

  it('rejects a level or category the editor cannot render',()=>{
    expect(draftedRequirementSchema.safeParse({label:'X',requirement_level:'preferred',category:'skill'}).success).toBe(false)
    expect(draftedRequirementSchema.safeParse({label:'X',requirement_level:'must_have',category:'vibes'}).success).toBe(false)
  })
})

describe('the editor summary',()=>{
  it('names the consequence when the set is empty rather than just saying zero',()=>{
    expect(summarizeRequirements([])).toContain('fall back to the job description')
  })

  it('counts must-haves separately',()=>{
    const summary=summarizeRequirements([requirement('A',{requirement_level:'must_have'}),requirement('B')])
    expect(summary).toContain('2 requirements')
    expect(summary).toContain('1 must-have')
  })
})
