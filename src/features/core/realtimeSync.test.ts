import {describe,expect,it} from 'vitest'
import {queriesForTable,realtimeQueryMap,realtimeTables} from './realtimeSync'

describe('realtime query mapping',()=>{
  it('subscribes to exactly the tables it can act on',()=>{
    expect(realtimeTables).toEqual(['job_candidates','jobs','tasks','interviews','interview_transcripts','offers','placements'])
  })

  /* A table in the publication with no mapping is a subscription that costs bandwidth on every write
   * and refreshes nothing -- dead weight that looks like a working feature. */
  it('maps every subscribed table to at least one query',()=>{
    for(const table of realtimeTables)expect(queriesForTable(table).length,`${table} refreshes nothing`).toBeGreaterThan(0)
  })

  it('ignores tables it does not track rather than refetching everything',()=>{
    expect(queriesForTable('candidates')).toEqual([])
    expect(queriesForTable('candidate_private_details')).toEqual([])
  })

  /* The Today queue is built from tasks, interviews, offers, placements, and pipeline state, so a
   * change to any of them can make one of its items stale. Missing one here is how the queue comes
   * to show work a colleague already finished -- the exact failure Phase 1 existed to fix.
   *
   * Enumerated rather than derived from realtimeTables: a subscribed table is not automatically a
   * Today input. interview_transcripts is subscribed so an open drawer sees a transcript land, and
   * nothing on Today reads it -- invalidating the queue for it would be a refetch that changes
   * nothing on screen. */
  const todayInputs=['job_candidates','jobs','tasks','interviews','offers','placements'] as const
  it('refreshes the Today queue for every record type it is built from',()=>{
    for(const table of todayInputs)expect(queriesForTable(table),`${table} leaves Today stale`).toContain('today')
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

  it('does not refresh unrelated lists on a stage move',()=>{
    expect(queriesForTable('job_candidates')).not.toContain('candidates-page')
    expect(queriesForTable('tasks')).not.toContain('pipeline')
  })

  it('keeps the table list and the mapping in sync',()=>{
    expect(realtimeTables.sort()).toEqual(Object.keys(realtimeQueryMap).sort())
  })
})
