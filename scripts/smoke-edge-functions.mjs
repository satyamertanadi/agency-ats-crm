const baseUrl=(process.env.SUPABASE_URL||'http://127.0.0.1:55321').replace(/\/$/,'')
const functions=['ai-evaluate','calendar-auth-callback','calendar-auth-start','calendar-disconnect','calendar-sync','execute-import','generate-candidate-profile','parse-candidate-cv','public-review','send-invitation','send-submission']

for(const name of functions){
  const response=await fetch(`${baseUrl}/functions/v1/${name}`,{method:'OPTIONS',signal:AbortSignal.timeout(30_000)})
  if(!response.ok)throw new Error(`${name} preflight returned ${response.status}`)
  console.log(`${name} ${response.status}`)
}
