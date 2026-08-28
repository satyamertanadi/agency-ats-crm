import type {Tone} from '../../shared/lib/status'
import type {BlueprintDimension,BlueprintItemType,BlueprintStatus,RequirementLevel} from './blueprintRepository'

/* Wording for the blueprint surfaces, kept out of the components so the states can be tested without
 * rendering anything.
 *
 * The distinction the copy has to carry is between "this job has no blueprint" and "this blueprint no
 * longer matches the job". The first is a setup step and must not look like a problem; the second is
 * a prompt to a human and must never read as though the system already fixed it. */

export type BlueprintState='unavailable'|'not_set_up'|'draft_waiting'|'active'|'stale'

export function blueprintState(status:BlueprintStatus|null):BlueprintState{
  if(!status)return 'unavailable'
  if(!status.rubricId)return status.draftRubricId?'draft_waiting':'not_set_up'
  if(status.isStale)return 'stale'
  return 'active'
}

export interface BlueprintSummary {
  headline:string
  detail:string
  tone:Tone
}

export function summarizeBlueprint(status:BlueprintStatus|null):BlueprintSummary{
  const state=blueprintState(status)
  if(state==='unavailable')return {headline:'Not available',detail:'Interview Intelligence is not enabled for this workspace.',tone:'neutral'}
  if(state==='not_set_up')return {headline:'No blueprint yet',detail:'Generate a draft to define what this interview should establish.',tone:'neutral'}
  if(state==='draft_waiting')return {headline:'Draft awaiting review',detail:'A draft is ready. Review and activate it before interviewing.',tone:'neutral'}

  const active=status as BlueprintStatus
  const counts=`${active.essentialQuestionCount} ${plural(active.essentialQuestionCount,'question','questions')} · ${active.mustHaveCount} must-have`
  if(state==='stale'){
    return {
      headline:`Version ${active.version} may be outdated`,
      // Explicitly says nothing was changed automatically: a stale blueprint is still the one being
      // used, and a consultant needs to know that rather than assume a refresh already happened.
      detail:`The job brief has changed since this was activated. It is still in use. ${counts}.`,
      tone:'warn',
    }
  }
  return {headline:`Version ${active.version} active`,detail:counts,tone:'good'}
}

const DIMENSION_LABELS:Record<BlueprintDimension,string>={
  essential_coverage:'Essential coverage',
  question_quality:'Question quality',
  listening_balance:'Listening balance',
  role_presentation:'Role presentation',
  next_step_clarity:'Next-step clarity',
}

const ITEM_TYPE_LABELS:Record<BlueprintItemType,string>={
  essential_question:'Question',
  requirement:'Requirement',
  role_presentation:'To explain',
  logistics:'Logistics',
  next_steps:'Next steps',
  quality_criterion:'Quality criterion',
}

const REQUIREMENT_LABELS:Record<RequirementLevel,string>={
  must_have:'Must have',
  nice_to_have:'Nice to have',
  not_applicable:'Not applicable',
}

export function dimensionLabel(value:BlueprintDimension){return DIMENSION_LABELS[value]??value}
export function itemTypeLabel(value:BlueprintItemType){return ITEM_TYPE_LABELS[value]??value}
export function requirementLabel(value:RequirementLevel){return REQUIREMENT_LABELS[value]??value}

export const DIMENSION_ORDER:BlueprintDimension[]=['essential_coverage','question_quality','listening_balance','role_presentation','next_step_clarity']

function plural(count:number,one:string,many:string){return count===1?one:many}
