import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../shared/lib/supabase'
import { configureFormat } from '../shared/lib/format'
import { rows } from '../shared/lib/rows'
import { membershipRowSchema } from './organizationProviderSchemas'
import type { Membership, Organization } from '../shared/types/domain'
import { useAuth } from './AuthProvider'

type Value={memberships:Membership[];organization:Organization|null;loading:boolean;error:Error|null;setOrganization:(organization:Organization)=>void;refresh:()=>Promise<unknown>}
const Context=createContext<Value|null>(null)

export function OrganizationProvider({children}:{children:ReactNode}){
  const {user}=useAuth(); const [selected,setSelected]=useState<Organization|null>(null)
  const query=useQuery({queryKey:['memberships',user?.id],enabled:Boolean(user),queryFn:async()=>{
    const {data,error}=await supabase.from('organization_members').select('id, organization_id, user_id, status, organizations!inner(id,name,slug,base_currency,salary_period,timezone,seat_limit,pilot_status,organization_settings(primary_color,logo_path,settings))').eq('status','active')
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
      return {...membership,organizations:{id:raw.id,name:raw.name,slug:raw.slug,base_currency:raw.base_currency,salary_period:raw.salary_period,timezone:raw.timezone,seat_limit:raw.seat_limit,pilot_status:raw.pilot_status,primary_color:settings?.primary_color,logo_path:settings?.logo_path,logo_url:logoUrl,profile_footer_banner_path:footerBannerPath,profile_footer_banner_url:publicUrl(footerBannerPath),profile_enabled:settings?.settings?.profile_v1===true,consultant_first_enabled:settings?.settings?.consultant_first_v1!==false}} as Membership
    })
  }})
  useEffect(()=>{if(!query.data?.length){setSelected(null);return}if(selected&&query.data.some((item)=>item.organizations.id===selected.id))return;const stored=localStorage.getItem('agency_active_org');const match=query.data.find((membership)=>membership.organizations.slug===stored)??query.data[0];if(match)setSelected(match.organizations)},[query.data,selected])
  const setOrganization=(organization:Organization)=>{setSelected(organization);localStorage.setItem('agency_active_org',organization.slug)}
  // Deliberately not an effect. Effects run after children have painted, so the first render of any
  // money or date would use format.ts's en-GB/USD defaults and then flip once the effect landed.
  // Setting it during render means children below are already formatting against the right org.
  // Safe as a render-phase side effect only because it is idempotent and derived purely from
  // `selected` -- a double invocation under StrictMode or a discarded concurrent render writes the
  // identical config, so there is nothing to tear.
  if(selected)configureFormat({locale:navigator.language,timeZone:selected.timezone,currency:selected.base_currency,salaryPeriod:selected.salary_period})
  const value=useMemo<Value>(()=>({memberships:query.data??[],organization:selected,loading:query.isLoading,error:query.error instanceof Error?query.error:null,setOrganization,refresh:query.refetch}),[query.data,query.isLoading,query.error,selected])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useOrganization(){const value=useContext(Context);if(!value)throw new Error('useOrganization must be used inside OrganizationProvider');return value}
