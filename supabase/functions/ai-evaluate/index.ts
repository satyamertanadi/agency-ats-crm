import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors={'Access-Control-Allow-Origin':Deno.env.get('APP_ORIGIN')||'http://localhost:5173','Access-Control-Allow-Headers':'authorization,content-type,x-request-id'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors})
  const requestId=request.headers.get('x-request-id')||crypto.randomUUID()
  try{
    const authorization=request.headers.get('authorization')||''
    const url=Deno.env.get('SUPABASE_URL');const anon=Deno.env.get('SUPABASE_ANON_KEY');const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!url||!anon||!service)return json({error:{code:'server_configuration',message:'AI worker is not configured.',requestId}},500)
    const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}}});const {data:{user}}=await caller.auth.getUser()
    if(!user)return json({error:{code:'authentication_required',message:'Authentication required.',requestId}},401)
    const body=await request.json() as {organizationId:string;candidateId:string;jobId:string}
    const {data:allowed}=await caller.rpc('has_permission',{p_organization_id:body.organizationId,p_permission:'ai.use'})
    if(!allowed)return json({error:{code:'permission_denied',message:'You cannot run this evaluation.',requestId}},403)
    const provider=Deno.env.get('AI_PROVIDER')||'anthropic';const model=Deno.env.get('AI_MODEL')||'claude-sonnet';
    const admin=createClient(url,service);const {data,error}=await admin.from('ai_evaluations').insert({organization_id:body.organizationId,candidate_id:body.candidateId,job_id:body.jobId,evaluation_type:'candidate_job_match',provider,model,prompt_version:'v1',status:'queued',triggered_by:user.id,input_versions:{requestId}}).select('id').single()
    if(error)throw error
    return json({evaluationId:data.id,status:'queued',requestId},202)
  }catch(error){return json({error:{code:'unexpected_error',message:error instanceof Error?error.message:'Unexpected error',requestId}},500)}
})
