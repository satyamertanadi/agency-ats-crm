/* Running one existing single-record call over a selection, and reporting what actually happened.
 *
 * The reason this exists rather than a Promise.all and a success toast: a batch of seven writes can
 * come back five-succeeded-two-failed, and both of the obvious shortcuts lie about it. `Promise.all`
 * rejects on the first failure, leaving the earlier writes committed while the UI says the whole
 * action failed. A plain success toast after `allSettled` says seven moved when five did. Either way
 * the consultant's next decision is made against a list they believe is something it is not.
 *
 * So: settle everything, keep the names of what failed, and let the caller state it. No RPC is added
 * for this -- batching the calls that already exist is the smaller change, and the per-row RPCs carry
 * the permission checks and audit writes that a new bulk RPC would have to reimplement.
 */
export interface BulkOutcome {
  total:number
  succeeded:number
  /** Display names of the rows that failed, for a message that names them rather than counting them. */
  failed:string[]
  /** The first error, kept so the caller can surface a cause rather than just a count. */
  error?:unknown
}

export async function runBulk<T>(
  items:readonly T[],
  label:(item:T)=>string,
  action:(item:T)=>Promise<unknown>,
):Promise<BulkOutcome>{
  const results=await Promise.allSettled(items.map((item)=>action(item)))
  const failed:string[]=[];let error:unknown
  results.forEach((result,index)=>{
    if(result.status!=='rejected')return
    const item=items[index]
    if(item!==undefined)failed.push(label(item))
    error??=result.reason
  })
  return {total:items.length,succeeded:items.length-failed.length,failed,error}
}

/* The sentence for the outcome. Deliberately three shapes, not one with a count spliced in:
 * "7 of 7 moved" reads as a hedge on a clean run, and "0 of 7 moved" buried in a success toast reads
 * as a success. */
export function describeBulk(outcome:BulkOutcome,verb:string):{tone:'success'|'partial'|'failure';message:string}{
  const {total,succeeded,failed}=outcome
  if(succeeded===total)return {tone:'success',message:`${total} ${total===1?'candidate':'candidates'} ${verb}.`}
  if(succeeded===0)return {tone:'failure',message:`Nothing was ${verb}.`}
  // Names rather than a bare count, capped so a large failure does not become a wall of text -- the
  // consultant needs to know WHICH rows to look at, and the first few plus a count does that.
  const named=failed.slice(0,3).join(', ')
  const rest=failed.length>3?` and ${failed.length-3} more`:''
  return {tone:'partial',message:`${succeeded} of ${total} ${verb}. ${named}${rest} ${failed.length===1?'was':'were'} not — check ${failed.length===1?'it':'them'} and try again.`}
}
