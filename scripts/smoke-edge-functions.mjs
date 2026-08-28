const baseUrl=(process.env.SUPABASE_URL||'http://127.0.0.1:55321').replace(/\/$/,'')
const functions=['calendar-auth-callback','calendar-auth-start','calendar-disconnect','calendar-sync','execute-import','fetch-meet-transcript','generate-candidate-profile','generate-interview-rubric','ingest-interview-transcript','process-interview-analysis','request-interview-analysis','location-autocomplete','parse-candidate-cv','parse-linkedin-profile','public-review','scheduled-maintenance','send-invitation','send-submission']

// The local functions-serve gateway boots each function's isolate on first request rather than
// eagerly at startup, and under CI's constrained runner a request that lands mid-boot can get an
// immediate 502 from the gateway itself (not a function error -- nothing is ever logged for it)
// instead of queueing. A short retry absorbs that boot race without hiding a real failure: a
// genuine compile/import error in the function keeps failing every retry the same way.
async function preflight(name){
  let lastFailure='no response'
  for(let attempt=1;attempt<=5;attempt++){
    try{
      const response=await fetch(`${baseUrl}/functions/v1/${name}`,{method:'OPTIONS',signal:AbortSignal.timeout(30_000)})
      if(response.ok)return response.status
      lastFailure=`HTTP ${response.status}`
    }catch(error){
      lastFailure=error instanceof Error?error.message:String(error)
    }
    if(attempt<5)await new Promise((resolve)=>setTimeout(resolve,attempt*500))
  }
  throw new Error(`${name} preflight failed after 5 attempts: ${lastFailure}`)
}

for(const name of functions){
  const status=await preflight(name)
  console.log(`${name} ${status}`)
}
