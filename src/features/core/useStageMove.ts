import {useMutation,useQueryClient} from '@tanstack/react-query'
import {getPipeline,moveCandidate} from './repository'
import {useToast} from '../../shared/ui/Toast'

type PipelineData=Awaited<ReturnType<typeof getPipeline>>
// `name` and `label` ride along purely so the confirmation can say what moved and where, without
// the mutation having to look either up again from a cache it may already have rewritten.
export interface StageMoveInput {
  itemId:string;stageId:string;name?:string;label:string
  /* The reason, for the moves that have one. Reaches stage_history.note and becomes the activity-feed
   * summary in place of the generated "Moved from X to Y". */
  note?:string
  source?:string
  /* Where the card came from. Present only when the caller can name it, which is what makes Undo
   * possible: a move is reversible by definition, so a rejection that turns out to be the wrong card
   * should not need the outcomes drawer to walk back. */
  undo?:{stageId:string;label:string}
}

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
  const mutation=useMutation({
    mutationFn:({itemId,stageId,note,source}:StageMoveInput)=>moveCandidate(itemId,stageId,{note,source}),
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
    /* Undo replays the same mutation backwards rather than calling a special "reinstate" path, so the
     * reversal goes through the same permission check, writes its own stage_history row, and shows up
     * in the feed as what it is -- a second move. It carries no `undo` of its own: offering to undo an
     * undo turns one misclick into an unbounded loop of toasts. */
    onSuccess:(_data,{itemId,name,label,undo})=>toast.success(`${name||'Candidate'} moved to ${label}.`,undefined,
      undo?{label:'Undo',onClick:()=>mutation.mutate({itemId,stageId:undo.stageId,name,label:undo.label,source:'undo'})}:undefined),
    // Settled, not success: a rollback still has to resync against the server, because the failure
    // may have been a stage the board no longer has rather than a transient network error.
    onSettled:()=>onSettled?onSettled():cache.invalidateQueries({queryKey:['pipeline',jobId]}),
  })
  return mutation
}
