import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {FunctionError} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'

interface Input{action:'resolve'|'feedback';token:string;submissionId?:string;decision?:string;comments?:string;reviewerName?:string}

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request);const started=Date.now()
  try{
    if(request.method!=='POST')throw new FunctionError(405,'method_not_allowed','Use POST.')
    const input=await request.json() as Input
    if(!input.token||input.token.length<32)throw new FunctionError(400,'invalid_link','This review link is invalid.')
    const url=Deno.env.get('SUPABASE_URL');const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!url||!service)throw new Error('Function environment is incomplete.')
    const forwarded=request.headers.get('x-forwarded-for')||request.headers.get('cf-connecting-ip')||'unknown'
    const admin=createClient(url,service,{global:{headers:{'x-forwarded-for':forwarded}},auth:{persistSession:false}})
    if(input.action==='feedback'){
      if(!input.submissionId||!['approve','reject','interview','hold'].includes(input.decision||''))throw new FunctionError(400,'invalid_feedback','Choose a valid decision.')
      const {error}=await admin.rpc('submit_submission_feedback',{p_token:input.token,p_candidate_submission_id:input.submissionId,p_decision:input.decision,p_comments:(input.comments||'').slice(0,4000)||null,p_reviewer_name:(input.reviewerName||'').slice(0,120)||null})
      if(error)throw new FunctionError(error.message.includes('rate_limited')?429:400,error.message.includes('rate_limited')?'rate_limited':'feedback_failed',error.message.includes('rate_limited')?'Too many feedback attempts. Try again later.':'Could not save feedback.')
      log('info','public_review.feedback_saved',{requestId:id,submissionId:input.submissionId,durationMs:Date.now()-started})
      return json(request,{ok:true})
    }
    const {data,error}=await admin.rpc('resolve_submission_link',{p_token:input.token})
    if(error)throw new FunctionError(error.message.includes('rate_limited')?429:400,error.message.includes('rate_limited')?'rate_limited':'review_unavailable',error.message.includes('rate_limited')?'Too many requests. Try again later.':'This review link is unavailable.')
    if(!data)throw new FunctionError(404,'review_unavailable','This review link is invalid, expired, or revoked.')
    const {data:documents}=await admin.rpc('resolve_submission_documents',{p_token:input.token})
    const signedDocuments=await Promise.all((documents||[]).map(async(document:{document_id:string;storage_path:string;filename:string;mime_type:string})=>{
      const {data:signed}=await admin.storage.from('candidate-documents').createSignedUrl(document.storage_path,300)
      return signed?.signedUrl?{id:document.document_id,filename:document.filename,mimeType:document.mime_type,url:signed.signedUrl}:null
    }))
    log('info','public_review.resolved',{requestId:id,documentCount:signedDocuments.filter(Boolean).length,durationMs:Date.now()-started})
    return json(request,{...data,documents:signedDocuments.filter(Boolean)})
  }catch(error){const known=error instanceof FunctionError;log('error','public_review.failed',{requestId:id,code:known?error.code:'unexpected_error',durationMs:Date.now()-started});return json(request,{error:{code:known?error.code:'unexpected_error',message:known?error.message:'Review is temporarily unavailable.',requestId:id}},known?error.status:500)}
})
