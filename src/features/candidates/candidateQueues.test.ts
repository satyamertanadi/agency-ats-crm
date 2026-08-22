import {describe,expect,it} from 'vitest'
import {STALE_DAYS,candidateQueues,emptyQueueMessage,parseQueue,queueLabel} from './candidateQueues'

describe('parseQueue',()=>{
  it('accepts every queue the SQL serves',()=>{
    for(const queue of candidateQueues)expect(parseQueue(queue.id)).toBe(queue.id)
  })

  /* Matches the migration, where an unrecognised p_queue falls through to `else false` and matches
   * nothing. A typo in a shared URL must not render a tab that looks selected but is not ours. */
  it('treats anything it does not serve as no queue',()=>{
    expect(parseQueue('typo_queue')).toBeNull()
    expect(parseQueue('')).toBeNull()
    expect(parseQueue(null)).toBeNull()
    expect(parseQueue(undefined)).toBeNull()
    expect(parseQueue('  ')).toBeNull()
  })

  /* Whitespace is forgiven; case is not.
   *
   * Trimming matters for agreement with the server, not just tidiness: the SQL null-checks
   * `nullif(trim($15),'')` but then compares the UNTRIMMED value, so a raw ' stale ' would slip past
   * the null check and fall through to `else false`, returning nothing while the tab looked active.
   * Normalising here means the value that reaches the RPC is one it can match. Case is left strict
   * because these ids are written by our own tabs -- a differently-cased one is a bug, not a typo. */
  it('forgives whitespace so the value it sends is one the SQL can match',()=>{
    expect(parseQueue(' stale ')).toBe('stale')
  })

  it('does not coerce case into a match',()=>{
    expect(parseQueue('In_Process')).toBeNull()
  })
})

describe('candidateQueues',()=>{
  it('states a rule for every queue, so none is unexplained',()=>{
    for(const queue of candidateQueues){
      expect(queue.rule.length).toBeGreaterThan(10)
      expect(queue.rule.endsWith('.')).toBe(true)
    }
  })

  /* The threshold is duplicated between this file and the SQL by necessity -- one is a predicate, the
   * other is what the tooltip says. Pinning it here means changing the migration without changing the
   * copy fails a test rather than quietly telling consultants the wrong number. */
  it('quotes the stale threshold the migration uses',()=>{
    expect(STALE_DAYS).toBe(21)
    const stale=candidateQueues.find((queue)=>queue.id==='stale')
    expect(stale?.rule).toContain('21 days')
  })

  it('has unique ids and labels',()=>{
    expect(new Set(candidateQueues.map((q)=>q.id)).size).toBe(candidateQueues.length)
    expect(new Set(candidateQueues.map((q)=>q.label)).size).toBe(candidateQueues.length)
  })
})

describe('emptyQueueMessage',()=>{
  it('falls back to the plain list message with no queue',()=>{
    expect(emptyQueueMessage(null).title).toBe('No candidates found')
  })

  /* These predicates read tables behind jobs.read / tasks.read / activities.read, and the RPC is
   * security invoker, so a member without them gets an empty result rather than an error. The copy
   * must therefore never assert "there are none" -- it states the rule and lets the reader judge. */
  it('states the rule instead of claiming none exist',()=>{
    const message=emptyQueueMessage('stale')
    expect(message.title).toBe('Nothing in stale')
    expect(message.description).toContain('21 days')
    expect(message.description).not.toMatch(/there are (no|none)/i)
    expect(message.description).not.toMatch(/\bnever\b/i)
  })

  it('reminds you filters still apply, so an empty queue is not blamed on the queue alone',()=>{
    expect(emptyQueueMessage('unassigned').description).toContain('filters')
  })
})

describe('queueLabel',()=>{
  it('names a queue and tolerates none',()=>{
    expect(queueLabel('needs_follow_up')).toBe('Needs follow-up')
    expect(queueLabel(null)).toBeNull()
  })
})
