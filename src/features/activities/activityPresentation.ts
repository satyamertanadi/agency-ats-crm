import type {Activity,PipelinePhaseKey} from '../../shared/types/domain'
import {phaseForStage,pipelinePhases} from '../workflow/workflow'

const aliases:Record<string,PipelinePhaseKey>={client_ready:'shortlist',client_review:'client_review',submitted:'client_review',interview:'interview',offered:'offer',hired:'placed'}
const key=(name:string)=>name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')
const phase=(name:string)=>{const stageKey=key(name);const phaseKey=aliases[stageKey]||phaseForStage({stage_key:stageKey,stage_type:stageKey==='placed'?'placed':'active',phase_key:null});return pipelinePhases.find((item)=>item.key===phaseKey)?.label||null}

export function presentActivity(activity:Pick<Activity,'activity_type'|'subject'|'summary'>){
  if(activity.activity_type!=='status_change')return {title:activity.subject||null,summary:activity.summary,detail:null}
  const moved=activity.summary.match(/^Moved from (.+) to (.+?)(?:\.|$)/i)
  if(!moved)return {title:activity.subject||'Pipeline update',summary:activity.summary,detail:null}
  const fromStage=moved[1]||'';const toStage=moved[2]||'';const fromPhase=phase(fromStage);const toPhase=phase(toStage)
  if(!fromPhase||!toPhase)return {title:activity.subject||'Pipeline update',summary:activity.summary,detail:null}
  return fromPhase===toPhase
    ?{title:`Moved within ${toPhase}`,summary:`${fromStage} → ${toStage}`,detail:'Detailed stage'}
    :{title:`Moved from ${fromPhase} to ${toPhase}`,summary:`${fromStage} → ${toStage}`,detail:'Detailed stage'}
}
