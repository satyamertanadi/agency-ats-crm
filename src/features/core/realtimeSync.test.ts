import {describe,expect,it} from 'vitest'
import {queriesForTable,queriesForTables,realtimeQueryMap,realtimeTables} from './realtimeSync'

describe('realtime query mapping',()=>{
  it('subscribes to exactly the tables it can act on',()=>{
    expect(realtimeTables).toEqual(['job_candidates','jobs','tasks','interviews','offers','placements',
      'submission_feedback','submission_packages','candidate_submissions','activities','candidates'])
  })

  /* A table in the publication with no mapping is a subscription that costs bandwidth on every write
   * and refreshes nothing -- dead weight that looks like a working feature. */
  it('maps every subscribed table to at least one query',()=>{
    for(const table of realtimeTables)expect(queriesForTable(table).length,`${table} refreshes nothing`).toBeGreaterThan(0)
  })

  /* Private details stay off the publication entirely. `candidates` carries name, status and owner;
   * salary, email and phone live in candidate_private_details, and broadcasting those to
   * every subscribed client to keep a name fresh would be a bad trade. */
  it('ignores tables it does not track rather than refetching everything',()=>{
    expect(queriesForTable('candidate_private_details')).toEqual([])
    expect(queriesForTable('documents')).toEqual([])
  })

  /* The Today queue is built from tasks, interviews, offers, placements, pipeline state, and now
   * client feedback and the submission packages behind its expired-link rows. Missing one here is how
   * the queue comes to show work a colleague already finished -- the exact failure Phase 1 existed to
   * fix. `activities` is deliberately not in this list: the feed records what happened, it is not a
   * source of anything Today asks the consultant to do. */
  it('refreshes the Today queue for every record type it is built from',()=>{
    const todaySources=['job_candidates','jobs','tasks','interviews','offers','placements','submission_feedback','submission_packages','candidate_submissions','candidates']
    for(const table of todaySources)expect(queriesForTable(table),`${table} leaves Today stale`).toContain('today')
  })

  /* A client answering is the only event in the workflow that originates outside the workspace, so it
   * is the one nobody is present to notice. Before this it reached the consultant on their next
   * navigation, if they happened to open the right job. */
  it('refreshes every surface a client response changes',()=>{
    expect(queriesForTable('submission_feedback')).toEqual(expect.arrayContaining(['today','submissions','activities']))
  })

  it('refreshes the board and the job-health aggregate together on a stage move',()=>{
    expect(queriesForTable('job_candidates')).toContain('pipeline')
    expect(queriesForTable('job_candidates')).toContain('job-health')
  })

  /* Placements and jobs both feed the BD board's open-jobs and expected-fee columns. */
  it('refreshes the client pipeline when commercial state changes',()=>{
    expect(queriesForTable('placements')).toContain('company-pipeline')
    expect(queriesForTable('jobs')).toContain('company-pipeline')
  })

  /* This used to assert the OPPOSITE -- that a stage move leaves candidates-page alone -- and that was
   * correct while the candidate list showed only attributes. The list now renders open_job_count,
   * primary_job_title and primary_stage_name per row, so a job_candidates write changes exactly what
   * it displays. Left as it was, a colleague's add or stage move showed "Not in a pipeline" on every
   * other open list forever: refetchOnWindowFocus is off, so nothing else would ever correct it. */
  it('refreshes the candidate list on a stage move, because the list now shows pipeline state',()=>{
    expect(queriesForTable('job_candidates')).toContain('candidates-page')
  })

  it('still leaves genuinely unrelated lists alone',()=>{
    expect(queriesForTable('tasks')).not.toContain('pipeline')
    expect(queriesForTable('activities')).not.toContain('candidates-page')
  })

  it('keeps the table list and the mapping in sync',()=>{
    expect(realtimeTables.sort()).toEqual(Object.keys(realtimeQueryMap).sort())
  })
})

/* The reconnect flush.
 *
 * Ten of the eleven tables map to 'today'. Flushing table-by-table therefore invalidated that single
 * key ten times in one synchronous pass, and because invalidateQueries defaults to cancelRefetch,
 * each one aborted the refetch the previous had just started -- while the abandoned HTTP requests
 * carried on, since the queryFn never receives an AbortSignal. One reconnect could put roughly ten
 * times the necessary load on the wire and keep only the last result. */
describe('de-duplicating a multi-table flush',()=>{
  it('names each query key once, however many tables share it',()=>{
    const keys=queriesForTables(realtimeTables)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('collapses the ten tables that all refresh Today into one refresh',()=>{
    const todayTables=realtimeTables.filter((table)=>queriesForTable(table).includes('today'))
    expect(todayTables.length).toBeGreaterThan(1)
    expect(queriesForTables(todayTables).filter((key)=>key==='today')).toHaveLength(1)
  })

  it('still covers every key the individual tables would have invalidated',()=>{
    const union=new Set(realtimeTables.flatMap((table)=>queriesForTable(table)))
    expect(new Set(queriesForTables(realtimeTables))).toEqual(union)
  })

  it('handles an empty or untracked set without inventing work',()=>{
    expect(queriesForTables([])).toEqual([])
    expect(queriesForTables(['candidate_private_details'])).toEqual([])
  })
})
