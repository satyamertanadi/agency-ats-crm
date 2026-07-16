import {corsHeaders,json,requestId} from '../_shared/http.ts'

// Retained temporarily as an explicit tombstone so old clients cannot create
// evaluations that remain queued forever. Candidate profiles are the only v1 AI flow.
Deno.serve((request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request)
  return json(request,{error:{code:'evaluation_endpoint_retired',message:'This endpoint has been retired. Use generate-candidate-profile.',requestId:id}},410)
})
