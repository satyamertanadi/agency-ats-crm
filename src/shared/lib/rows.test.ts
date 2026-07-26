import {describe,expect,it,vi} from 'vitest'
import {z} from 'zod'

const captureError=vi.fn()
vi.mock('./observability',()=>({captureError:(...args:unknown[])=>captureError(...args)}))

const {rows}=await import('./rows')

const personSchema=z.object({id:z.string(),name:z.string()})

describe('rows',()=>{
  it('returns parsed data unchanged when it matches the schema',()=>{
    const result=rows([{id:'1',name:'Ada'}],personSchema,'mismatch')
    expect(result).toEqual([{id:'1',name:'Ada'}])
    expect(captureError).not.toHaveBeenCalled()
  })

  it('treats null/undefined input as an empty array',()=>{
    expect(rows(null,personSchema,'mismatch')).toEqual([])
    expect(rows(undefined,personSchema,'mismatch')).toEqual([])
  })

  it('falls back to the raw data and reports instead of throwing on a shape mismatch',()=>{
    const malformed=[{id:'1'}] // missing `name`
    const result=rows(malformed,personSchema,'person rows did not match')
    expect(result).toBe(malformed) // fallback returns the original reference, not a copy
    expect(captureError).toHaveBeenCalledTimes(1)
    const [error,context]=captureError.mock.calls[0]!
    expect((error as Error).message).toBe('person rows did not match')
    expect(context).toMatchObject({area:'row_shape_mismatch',issueCount:1})
  })

  it('never throws, even for a completely wrong shape',()=>{
    expect(()=>rows('not an array',personSchema,'mismatch')).not.toThrow()
    expect(()=>rows(42,personSchema,'mismatch')).not.toThrow()
  })
})
