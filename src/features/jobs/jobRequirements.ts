import {z} from 'zod'

/* The requirement set a vacancy is assessed against.
 *
 * Mirrors public.job_requirements and the drafting contract in
 * supabase/functions/_shared/job-requirements-schema.ts. The caps here match the ones the RPC
 * enforces: this layer exists to tell the recruiter before they lose work, not to be the boundary.
 */

export const requirementLevels=['must_have','nice_to_have'] as const
export const requirementCategories=['skill','experience','qualification','language','location','availability','other'] as const

export type RequirementLevel=(typeof requirementLevels)[number]
export type RequirementCategory=(typeof requirementCategories)[number]

export const MAX_JOB_REQUIREMENTS=40
const MAX_LABEL=300

export const requirementLevelLabels:Record<RequirementLevel,string>={must_have:'Must have',nice_to_have:'Nice to have'}
export const requirementCategoryLabels:Record<RequirementCategory,string>={
  skill:'Skill',experience:'Experience',qualification:'Qualification',language:'Language',
  location:'Location',availability:'Availability',other:'Other',
}

export const jobRequirementSchema=z.object({
  id:z.string().uuid().optional(),
  label:z.string().trim().min(3,'Write the requirement as something a CV can evidence.').max(MAX_LABEL),
  requirement_level:z.enum(requirementLevels),
  category:z.enum(requirementCategories),
  /* 0 is meaningful and kept: it is how a recruiter parks a requirement they want recorded on the
   * vacancy but not counted in the score. */
  weight:z.coerce.number().min(0,'Weight cannot be negative.').max(10,'Weight tops out at 10.'),
  evidence_expected:z.string().trim().max(1000).nullable(),
  source:z.enum(['manual','ai_draft','import']),
})

export type JobRequirement=z.infer<typeof jobRequirementSchema>

export const jobRequirementListSchema=z.array(jobRequirementSchema)
  .max(MAX_JOB_REQUIREMENTS,`A vacancy can carry at most ${MAX_JOB_REQUIREMENTS} requirements.`)
  .superRefine((requirements,context)=>{
    /* A duplicate is not a validation nicety. Each row is one entry in the assessment, so the same
     * requirement twice counts twice in the denominator and quietly doubles its own weight. */
    const seen=new Map<string,number>()
    requirements.forEach((requirement,index)=>{
      const key=requirement.label.trim().toLowerCase().replace(/\s+/g,' ')
      if(!key)return
      const first=seen.get(key)
      if(first===undefined){seen.set(key,index);return}
      context.addIssue({code:'custom',path:[index,'label'],message:'This requirement is already listed.'})
    })
  })

export function emptyJobRequirement():JobRequirement{
  return {label:'',requirement_level:'nice_to_have',category:'other',weight:1,evidence_expected:null,source:'manual'}
}

/* What the drafting endpoint returns, before a recruiter has touched it. Rows arrive without an id
 * because nothing has been saved, and are marked ai_draft so a saved set records that a model wrote
 * the first version of it. */
export const draftedRequirementSchema=z.object({
  label:z.string().trim().min(1).max(MAX_LABEL),
  requirement_level:z.enum(requirementLevels),
  category:z.enum(requirementCategories),
  weight:z.number().min(0).max(10).optional(),
  evidence_expected:z.string().trim().max(1000).nullable().optional(),
})

export function draftedToRequirement(drafted:z.infer<typeof draftedRequirementSchema>):JobRequirement{
  return {
    label:drafted.label,requirement_level:drafted.requirement_level,category:drafted.category,
    weight:drafted.weight??1,evidence_expected:drafted.evidence_expected??null,source:'ai_draft',
  }
}

/* Merges a draft into what is already on screen without discarding the recruiter's own rows.
 *
 * Regenerating is a normal thing to do after editing the job description, and replacing the list
 * outright would delete requirements a consultant typed from a phone call the JD never mentioned --
 * which is exactly the knowledge the model does not have. Matching on the normalized label means a
 * re-draft updates nothing it already agrees with and appends only what is genuinely new.
 */
export function mergeDraftedRequirements(existing:JobRequirement[],drafted:JobRequirement[]){
  const key=(label:string)=>label.trim().toLowerCase().replace(/\s+/g,' ')
  const present=new Set(existing.map((requirement)=>key(requirement.label)).filter(Boolean))
  const additions=drafted.filter((requirement)=>{
    const candidate=key(requirement.label)
    if(!candidate||present.has(candidate))return false
    present.add(candidate)
    return true
  })
  return {merged:[...existing,...additions].slice(0,MAX_JOB_REQUIREMENTS),addedCount:additions.length,skippedCount:drafted.length-additions.length}
}

export function moveRequirement(requirements:JobRequirement[],from:number,to:number){
  if(to<0||to>=requirements.length||from===to)return requirements
  const next=[...requirements]
  const [moved]=next.splice(from,1)
  if(!moved)return requirements
  next.splice(to,0,moved)
  return next
}

/* The one-line summary above the editor. Says what the set will do to an assessment rather than just
 * counting rows, because the count is already visible. */
export function summarizeRequirements(requirements:JobRequirement[]){
  const mustHaves=requirements.filter((requirement)=>requirement.requirement_level==='must_have').length
  if(!requirements.length)return 'No requirements yet. Client profiles for this vacancy fall back to the job description text.'
  return `${requirements.length} requirement${requirements.length===1?'':'s'}, ${mustHaves} must-have${mustHaves===1?'':'s'}. Candidate profiles are assessed against exactly this list.`
}
