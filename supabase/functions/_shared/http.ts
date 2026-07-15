export function corsHeaders(request: Request) {
  const configured=(Deno.env.get('APP_ORIGIN')||'http://127.0.0.1:5173').split(',').map((value)=>value.trim())
  const origin=request.headers.get('origin')||configured[0]
  const allowed=configured.includes(origin)?origin:configured[0]
  return {
    'Access-Control-Allow-Origin':allowed,
    'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-request-id',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Vary':'Origin',
  }
}

export function json(request:Request,body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{...corsHeaders(request),'Content-Type':'application/json','Cache-Control':'no-store'}})
}

export function requestId(request:Request){return request.headers.get('x-request-id')||crypto.randomUUID()}

export function log(level:'info'|'error',message:string,context:Record<string,unknown>={}){
  const safe=Object.fromEntries(Object.entries(context).filter(([key])=>!['email','token','refreshToken','candidate','payload'].includes(key)))
  const entry={level,message,...safe,timestamp:new Date().toISOString()}
  if(level==='error')console.error(JSON.stringify(entry));else console.log(JSON.stringify(entry))
}
