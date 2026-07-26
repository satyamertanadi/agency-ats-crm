import {z} from 'zod'
import {captureError} from './observability'

// Repository functions have long cast query results straight through `as unknown as Domain[]`,
// which is unchecked -- a renamed/dropped column or a nullability mismatch between the DB and
// the hand-written domain type is invisible at compile time and stays invisible at runtime until
// a render throws on `undefined`. This validates once, at the boundary, and reports drift instead
// of crashing: `schema` describes one row, safeParse never throws, and a mismatch falls back to the
// raw cast (unblocking the caller) while still telling us the shape changed.
export function rows<T>(data:unknown,schema:z.ZodType<T>,fallback:string):T[]{
  const result=z.array(schema).safeParse(data??[])
  if(!result.success){
    captureError(new Error(fallback),{area:'row_shape_mismatch',issueCount:result.error.issues.length,issues:result.error.issues.slice(0,5).map((issue)=>({path:issue.path.join('.'),code:issue.code,message:issue.message}))})
    return (data??[]) as T[]
  }
  return result.data
}

// Same contract as rows(), for the single-object reads (an edge function response, an RPC that
// returns one row) rather than a list.
export function row<T>(data:unknown,schema:z.ZodType<T>,fallback:string):T{
  const result=schema.safeParse(data)
  if(!result.success){
    captureError(new Error(fallback),{area:'row_shape_mismatch',issueCount:result.error.issues.length,issues:result.error.issues.slice(0,5).map((issue)=>({path:issue.path.join('.'),code:issue.code,message:issue.message}))})
    return data as T
  }
  return result.data
}
