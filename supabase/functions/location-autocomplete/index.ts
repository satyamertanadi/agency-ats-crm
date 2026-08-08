import {FunctionError,requireUser} from '../_shared/auth.ts'
import {corsHeaders,json,log,requestId} from '../_shared/http.ts'
import {buildAutocompleteRequestBody,mapAutocompleteResponse,type GoogleAutocompleteResponse} from '../_shared/places.ts'

// Proxies Google Places Autocomplete so the API key never reaches the browser -- same shape as every
// other third-party credential in this app (Calendar's GOOGLE_CLIENT_ID/SECRET, CV parsing's
// ANTHROPIC_API_KEY). Returns only place names; no tenant data crosses this function, so requireUser
// alone (any authenticated member, no organization/permission check) is the right gate -- there is
// nothing here for an organization-scoped RPC to protect.
class ProviderError extends Error{constructor(public status:number,providerMessage:string|null){super(providerMessage||'provider_error')}}

interface Input {input:string;sessionToken:string}

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders(request)})
  const id=requestId(request)
  try{
    if(request.method!=='POST')throw new FunctionError(405,'method_not_allowed','Use POST.')
    const input=await request.json() as Input
    if(typeof input.input!=='string'||input.input.trim().length<2)throw new FunctionError(400,'invalid_request','A search of at least 2 characters is required.')
    if(typeof input.sessionToken!=='string'||!input.sessionToken)throw new FunctionError(400,'invalid_request','A session token is required.')
    await requireUser(request)
    const apiKey=Deno.env.get('GOOGLE_PLACES_API_KEY')
    if(!apiKey)throw new FunctionError(503,'places_not_configured','Location search is not configured.')
    const response=await fetch('https://places.googleapis.com/v1/places:autocomplete',{
      method:'POST',headers:{'X-Goog-Api-Key':apiKey,'Content-Type':'application/json'},
      body:JSON.stringify(buildAutocompleteRequestBody(input.input.trim(),input.sessionToken)),
    })
    const body=await response.json().catch(()=>null) as (GoogleAutocompleteResponse&{error?:{message?:string}})|null
    if(!response.ok)throw new ProviderError(response.status,body?.error?.message||null)
    const suggestions=mapAutocompleteResponse(body??{})
    return json(request,{suggestions})
  }catch(error){
    const known=error instanceof FunctionError
    const provider=error instanceof ProviderError
    const status=known?error.status:provider?(error.status===429?429:502):500
    const code=known?error.code:provider?'places_provider_error':'places_search_failed'
    const message=known?error.message:provider?'Location search is temporarily unavailable.':'Could not search locations.'
    // 'warn' for a degraded provider, not 'error' -- the request itself was handled correctly and
    // reported the right thing to the caller; it is Google's side that was unavailable.
    log(provider?'warn':'error','location_autocomplete_failed',{requestId:id,code,status})
    return json(request,{error:{code,message,requestId:id}},status)
  }
})
