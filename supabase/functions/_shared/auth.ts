import {createClient,type User} from '@supabase/supabase-js'

export function clients(request:Request){
  const url=Deno.env.get('SUPABASE_URL');const anon=Deno.env.get('SUPABASE_ANON_KEY');const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(!url||!anon||!service)throw new Error('Supabase function environment is incomplete.')
  const authorization=request.headers.get('authorization')||''
  return {
    caller:createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}}),
    admin:createClient(url,service,{auth:{persistSession:false}}),
  }
}

/* The service-role client on its own, for workers that act for no user. Built the same way clients()
 * builds its admin half, so callers get the same inferred client type rather than a stricter one that
 * resolves every row to never. */
export function serviceClient(){
  const url=Deno.env.get('SUPABASE_URL');const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(!url||!service)throw new Error('Supabase function environment is incomplete.')
  return createClient(url,service,{auth:{persistSession:false}})
}

export async function requireUser(request:Request):Promise<{user:User;caller:ReturnType<typeof clients>['caller'];admin:ReturnType<typeof clients>['admin']}>{
  const {caller,admin}=clients(request)
  const {data:{user},error}=await caller.auth.getUser()
  if(error||!user)throw new FunctionError(401,'authentication_required','Authentication required.')
  return {user,caller,admin}
}

export async function requirePermission(request:Request,organizationId:string,permission:string){
  const context=await requireUser(request)
  const {data,error}=await context.caller.rpc('has_permission',{p_organization_id:organizationId,p_permission:permission})
  if(error||!data)throw new FunctionError(403,'permission_denied','You do not have permission to perform this action.')
  return context
}

export class FunctionError extends Error{
  constructor(public status:number,public code:string,message:string){super(message)}
}
