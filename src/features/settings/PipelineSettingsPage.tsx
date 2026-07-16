import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query'
import {useOrganization} from '../../app/OrganizationProvider'
import {listJobs,getPipeline} from '../core/repository'
import {Page,Panel,Badge} from '../../shared/ui/Page'
import {ErrorState,LoadingState} from '../../shared/ui/States'
import {groupPipelineStages,phaseForStage} from '../workflow/workflow'
import {pipelinePhases} from '../workflow/workflow'
import {updatePipelineStagePhase} from '../core/commercialRepository'
import {Select} from '../../shared/ui/Field'
import type {PipelinePhaseKey} from '../../shared/types/domain'

export function PipelineSettingsPage(){
  const {organization}=useOrganization();const cache=useQueryClient()
  const query=useQuery({queryKey:['pipeline-settings',organization?.id],enabled:Boolean(organization),queryFn:async()=>{const jobs=await listJobs(organization!.id);const source=jobs.find((job)=>job.pipeline_id);return source?getPipeline(source):{stages:[],items:[]}}})
  const update=useMutation({mutationFn:({id,phaseKey}:{id:string;phaseKey:PipelinePhaseKey|null})=>updatePipelineStagePhase(organization!.id,id,phaseKey),onSuccess:()=>cache.invalidateQueries({queryKey:['pipeline-settings',organization?.id]})})
  if(query.isLoading)return <LoadingState/>;if(query.error)return <ErrorState error={query.error}/>
  const groups=groupPipelineStages(query.data?.stages||[]);const unmapped=(query.data?.stages||[]).filter((stage)=>phaseForStage(stage)==='other')
  return <Page title="Pipeline configuration" eyebrow="Advanced workspace" description="Detailed stages remain intact while consultants work in seven clear phases."><Panel title="Consultant phase mapping" subtitle="Existing stage history is never rewritten."><div className="phase-mapping-list">{groups.map((group)=><article key={group.key}><strong>{group.label}</strong><div>{group.stages.map((stage)=><Badge key={stage.id}>{stage.name}</Badge>)}</div></article>)}{unmapped.length>0&&<article><strong>Other</strong><div>{unmapped.map((stage)=><Badge tone="warn" key={stage.id}>{stage.name}</Badge>)}</div><p className="muted">Custom stages stay visible in Detailed stages until they receive a phase mapping.</p></article>}</div></Panel><Panel title="Detailed stage mapping" subtitle="Explicitly map custom stages. Choosing Other clears the mapping; the system never guesses."><div className="pipeline-stage-settings">{(query.data?.stages||[]).map((stage)=><label key={stage.id}><span><strong>{stage.name}</strong><small>{stage.stage_key}</small></span><Select aria-label={`Phase for ${stage.name}`} value={stage.phase_key||''} disabled={update.isPending} onChange={(event)=>update.mutate({id:stage.id,phaseKey:(event.target.value||null) as PipelinePhaseKey|null})}><option value="">Other / unmapped</option>{pipelinePhases.map((phase)=><option key={phase.key} value={phase.key}>{phase.label}</option>)}</Select></label>)}</div>{update.error&&<p className="form-error" role="alert">{update.error.message}</p>}</Panel></Page>
}
