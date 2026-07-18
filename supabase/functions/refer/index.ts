import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
import {FunctionError} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'

// Public referral intake. Same shape as public-review: service_role only, reached solely through this
// rate-limited edge boundary so the resolve/submit RPCs cannot be called directly via PostgREST.
// - resolve: branding + the open-jobs picker for the "choose a role" step.
// - upload-url: a short-lived signed upload URL into the private candidate-documents bucket, so a
//   referrer can attach a resume without the bucket ever being public.
// - submit: records the referral (optionally referencing an uploaded resume path).
interface Input{
  action:'resolve'|'submit'|'upload-url'
  token:string
  filename?:string
  payload?:Record<string,unknown>
}

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request);const started=Date.now()
  try{
    if(request.method!=='POST')throw new FunctionError(405,'method_not_allowed','Use POST.')
    const input=await request.json() as Input
    if(!input.token||input.token.length<32)throw new FunctionError(400,'invalid_link','This referral link is invalid.')
    const url=Deno.env.get('SUPABASE_URL');const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!url||!service)throw new Error('Function environment is incomplete.')
    const forwarded=request.headers.get('x-forwarded-for')||request.headers.get('cf-connecting-ip')||'unknown'
    const admin=createClient(url,service,{global:{headers:{'x-forwarded-for':forwarded}},auth:{persistSession:false}})

    if(input.action==='resolve'){
      const {data,error}=await admin.rpc('resolve_referral_link',{p_token:input.token})
      if(error)throw new FunctionError(error.message.includes('rate_limited')?429:400,error.message.includes('rate_limited')?'rate_limited':'link_unavailable',error.message.includes('rate_limited')?'Too many requests. Try again later.':'This referral link is unavailable.')
      if(!data)throw new FunctionError(404,'link_unavailable','This referral link is invalid, expired, or revoked.')
      log('info','refer.resolved',{requestId:id,durationMs:Date.now()-started})
      return json(request,data)
    }

    if(input.action==='upload-url'){
      // Resolve first so an invalid/expired token cannot mint upload URLs; scope the path under the link.
      const {data:link,error:linkError}=await admin.rpc('resolve_referral_link',{p_token:input.token})
      if(linkError||!link)throw new FunctionError(404,'link_unavailable','This referral link is unavailable.')
      const safeName=(input.filename||'resume').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)
      const path=`referrals/${input.token.slice(0,16)}/${crypto.randomUUID()}/${safeName}`
      const {data:signed,error:signError}=await admin.storage.from('candidate-documents').createSignedUploadUrl(path)
      if(signError||!signed)throw new FunctionError(400,'upload_unavailable','Could not prepare the resume upload.')
      log('info','refer.upload_url',{requestId:id,durationMs:Date.now()-started})
      return json(request,{path,token:signed.token,signedUrl:signed.signedUrl})
    }

    // submit
    const payload=input.payload||{}
    const {data,error}=await admin.rpc('submit_referral',{p_token:input.token,p_payload:payload})
    if(error){
      const rate=error.message.includes('rate_limited')
      const missing=error.message.includes('candidate_name_required')
      throw new FunctionError(rate?429:400,rate?'rate_limited':(missing?'invalid_referral':'submit_failed'),rate?'Too many submissions. Try again later.':(missing?'A candidate name is required.':'Could not submit this referral.'))
    }
    log('info','refer.submitted',{requestId:id,durationMs:Date.now()-started})
    return json(request,data)
  }catch(error){const known=error instanceof FunctionError;log('error','refer.failed',{requestId:id,code:known?error.code:'unexpected_error',durationMs:Date.now()-started});return json(request,{error:{code:known?error.code:'unexpected_error',message:known?error.message:'Referrals are temporarily unavailable.',requestId:id}},known?error.status:500)}
})
