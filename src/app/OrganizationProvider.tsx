import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../shared/lib/supabase'
import { configureFormat } from '../shared/lib/format'
import { rows } from '../shared/lib/rows'
import { membershipRowSchema } from './organizationProviderSchemas'
import type { Membership, Organization } from '../shared/types/domain'
import { useAuth } from './AuthProvider'

/* One organization per deployment. Each client gets their own Supabase project, so this provider
 * resolves the single membership once instead of maintaining a selection across an array -- the
 * sidebar used to render a <select> with exactly one option, and `changeOrganization`,
 * `setOrganization` and the localStorage-backed active-org memory existed to serve it.
 *
 * Org-scoping stays everywhere it is enforced: RLS policies, every RPC's p_organization_id, and the
 * /app/:organizationSlug URL. That is already written and RLS-tested, costs nothing at runtime, and
 * is the backstop if a client is ever consolidated onto shared infrastructure. What went is the UI
 * for switching, not the isolation.
 *
 * `membership` is the caller's own row -- most consumers wanted exactly that and were re-deriving it
 * with memberships.find(m => m.organization_id === organization.id && m.user_id === user.id). */
type Value={membership:Membership|null;organization:Organization|null;loading:boolean;error:Error|null;refresh:()=>Promise<unknown>}
const Context=createContext<Value|null>(null)

export function OrganizationProvider({children}:{children:ReactNode}){
  const {user}=useAuth()
  const query=useQuery({queryKey:['memberships',user?.id],enabled:Boolean(user),queryFn:async()=>{
    const {data,error}=await supabase.from('organization_members').select('id, organization_id, user_id, status, organizations!inner(id,name,slug,base_currency,salary_period,timezone,pilot_status,organization_settings(primary_color,logo_path,settings,migration_complete))').eq('status','active')
    if(error)throw error
    const validated=rows(data,membershipRowSchema,'Membership rows did not match the expected shape')
    return validated.map((membership)=>{
      const raw=membership.organizations
      const settings=Array.isArray(raw.organization_settings)?raw.organization_settings[0]:raw.organization_settings
      const publicUrl=(path?:string|null)=>path?supabase.storage.from('organization-assets').getPublicUrl(path).data.publicUrl:null
      const logoUrl=publicUrl(settings?.logo_path)
      // The mandatory client template prints a banner across the footer of every page. It lives in
      // the settings blob rather than its own column so it needs no schema change.
      const footerBannerPath=typeof settings?.settings?.profile_footer_banner_path==='string'?settings.settings.profile_footer_banner_path as string:null
      return {...membership,organizations:{id:raw.id,name:raw.name,slug:raw.slug,base_currency:raw.base_currency,salary_period:raw.salary_period,timezone:raw.timezone,pilot_status:raw.pilot_status,primary_color:settings?.primary_color,logo_path:settings?.logo_path,logo_url:logoUrl,migration_complete:settings?.migration_complete===true,profile_footer_banner_path:footerBannerPath,profile_footer_banner_url:publicUrl(footerBannerPath),profile_enabled:settings?.settings?.profile_v1===true,whatsapp_country_code:typeof settings?.settings?.whatsapp_country_code==='string'?settings.settings.whatsapp_country_code as string:null,whatsapp_template:typeof settings?.settings?.whatsapp_template==='string'?settings.settings.whatsapp_template as string:null}} as Membership
    })
  }})
  /* RLS already restricts this query to the caller's own active memberships, and a dedicated
   * instance holds one organization -- so the first row is the workspace. Taking [0] rather than
   * asserting length keeps a mis-provisioned project (two orgs seeded by accident) rendering the
   * first one instead of white-screening. */
  const membership=query.data?.[0]??null
  const organization=membership?.organizations??null
  // Deliberately not an effect. Effects run after children have painted, so the first render of any
  // money or date would use format.ts's en-GB/USD defaults and then flip once the effect landed.
  // Setting it during render means children below are already formatting against the right org.
  // Safe as a render-phase side effect only because it is idempotent and derived purely from
  // `organization` -- a double invocation under StrictMode or a discarded concurrent render writes
  // the identical config, so there is nothing to tear.
  if(organization)configureFormat({locale:navigator.language,timeZone:organization.timezone,currency:organization.base_currency,salaryPeriod:organization.salary_period})
  const value=useMemo<Value>(()=>({membership,organization,loading:query.isLoading,error:query.error instanceof Error?query.error:null,refresh:query.refetch}),[membership,organization,query.isLoading,query.error,query.refetch])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useOrganization(){const value=useContext(Context);if(!value)throw new Error('useOrganization must be used inside OrganizationProvider');return value}
