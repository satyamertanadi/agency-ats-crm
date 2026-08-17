import {describe,expect,it,vi} from 'vitest'
import {describeBulk,runBulk} from './bulkResult'

const rows=[{id:'1',name:'Ana'},{id:'2',name:'Budi'},{id:'3',name:'Citra'}]
const name=(row:{name:string})=>row.name

describe('runBulk',()=>{
  it('reports a clean run',async()=>{
    const outcome=await runBulk(rows,name,()=>Promise.resolve())
    expect(outcome).toEqual({total:3,succeeded:3,failed:[],error:undefined})
  })

  /* The case both obvious shortcuts get wrong. Promise.all would reject and lose the two that
   * succeeded; a success toast after allSettled would claim all three. */
  it('keeps the successes and names the failures',async()=>{
    const outcome=await runBulk(rows,name,(row)=>row.id==='2'?Promise.reject(new Error('rls')):Promise.resolve())
    expect(outcome.succeeded).toBe(2)
    expect(outcome.failed).toEqual(['Budi'])
    expect(outcome.error).toBeInstanceOf(Error)
  })

  it('does not stop at the first failure',async()=>{
    const action=vi.fn().mockRejectedValue(new Error('nope'))
    const outcome=await runBulk(rows,name,action)
    // Every row was attempted, so the report is complete rather than truncated at the first error.
    expect(action).toHaveBeenCalledTimes(3)
    expect(outcome).toMatchObject({total:3,succeeded:0,failed:['Ana','Budi','Citra']})
  })

  it('handles an empty selection without inventing work',async()=>{
    const action=vi.fn()
    const outcome=await runBulk([],name,action)
    expect(action).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({total:0,succeeded:0,failed:[]})
  })
})

describe('describeBulk',()=>{
  it('states a clean run without hedging',()=>{
    expect(describeBulk({total:3,succeeded:3,failed:[]},'moved'))
      .toEqual({tone:'success',message:'3 candidates moved.'})
    expect(describeBulk({total:1,succeeded:1,failed:[]},'reassigned').message).toBe('1 candidate reassigned.')
  })

  // A total failure must never arrive dressed as a success.
  it('states a total failure as a failure',()=>{
    expect(describeBulk({total:2,succeeded:0,failed:['Ana','Budi']},'moved'))
      .toEqual({tone:'failure',message:'Nothing was moved.'})
  })

  /* The whole point: a partial write is reported as partial, naming the rows to look at rather than
   * leaving the consultant to diff the list themselves. */
  it('names the rows that did not make it',()=>{
    const result=describeBulk({total:7,succeeded:5,failed:['Ana','Budi']},'moved')
    expect(result.tone).toBe('partial')
    expect(result.message).toContain('5 of 7 moved.')
    expect(result.message).toContain('Ana, Budi')
    expect(result.message).toContain('were not')
  })

  it('caps the names so a large failure is not a wall of text',()=>{
    const failed=['A','B','C','D','E']
    const result=describeBulk({total:9,succeeded:4,failed},'moved')
    expect(result.message).toContain('A, B, C and 2 more')
    expect(result.message).not.toContain('D,')
  })

  it('reads correctly for a single failure',()=>{
    const result=describeBulk({total:4,succeeded:3,failed:['Ana']},'reassigned')
    expect(result.message).toBe('3 of 4 reassigned. Ana was not — check it and try again.')
  })
})
