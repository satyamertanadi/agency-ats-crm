import {useMutation,useQueryClient} from '@tanstack/react-query'
import {getPipeline,moveCandidate} from './repository'
import {useToast} from '../../shared/ui/Toast'

type PipelineData=Awaited<ReturnType<typeof getPipeline>>
// `name` and `label` ride along purely so the confirmation can say what moved and where, without
// the mutation having to look either up again from a cache it may already have rewritten.
export interface StageMoveInput {itemId:string;stageId:string;name?:string;label:string}

/* Optimistic stage movement, shared by both boards.
 *
 * The two kanbans (the consultant Job Workspace and the legacy vacancy pipeline) write to the same
 * `['pipeline', jobId]` cache through the same RPC, so they get one implementation rather than two
 * that can drift -- an optimistic path duplicated per board is an optimistic path that gets rolled
 * back correctly on one of them.
 *
 * A drag is the most repeated gesture in the product and it used to wait on a round-trip plus a
 * refetch before anything visibly moved, which reads as a dropped drag and invites a second one.
 */
export function useStageMove(jobId:string,onSettled?:()=>Promise<unknown>){
  const cache=useQueryClient();const toast=useToast()
  return useMutation({
    mutationFn:({itemId,stageId}:StageMoveInput)=>moveCandidate(itemId,stageId),
    onMutate:async({itemId,stageId})=>{
      // Stops an in-flight refetch from landing on top of the optimistic write and undoing it
      // mid-drag.
      await cache.cancelQueries({queryKey:['pipeline',jobId]})
      const previous=cache.getQueryData<PipelineData>(['pipeline',jobId])
      // The embedded `pipeline_stages` is patched alongside `current_stage_id` because the candidate
      // panel reads the stage off the relation while the board reads the id. Updating only one of
      // the two is how an optimistic move shows a card under Interview whose detail pane still says
      // Screening for as long as the refetch takes.
      cache.setQueryData<PipelineData>(['pipeline',jobId],(current)=>current?{...current,items:current.items.map((item)=>item.id===itemId?{...item,current_stage_id:stageId,pipeline_stages:current.stages.find((stage)=>stage.id===stageId)??item.pipeline_stages}:item)}:current)
      // The whole cached pipeline, not the one card: a failed move has to restore a board the user
      // may have dragged twice, and replaying individual card patches in reverse gets that wrong.
      return {previous}
    },
    onError:(error,_variables,context)=>{
      if(context?.previous)cache.setQueryData(['pipeline',jobId],context.previous)
      toast.error(error,'The card was returned to its previous phase.')
    },
    onSuccess:(_data,{name,label})=>toast.success(`${name||'Candidate'} moved to ${label}.`),
    // Settled, not success: a rollback still has to resync against the server, because the failure
    // may have been a stage the board no longer has rather than a transient network error.
    onSettled:()=>onSettled?onSettled():cache.invalidateQueries({queryKey:['pipeline',jobId]}),
  })
}
