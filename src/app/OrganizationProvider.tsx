import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../shared/lib/supabase'
import { configureFormat } from '../shared/lib/format'
import type { Membership, Organization } from '../shared/types/domain'
import { useAuth } from './AuthProvider'

type Value={memberships:Membership[];organization:Organization|null;loading:boolean;setOrganization:(organization:Organization)=>void;refresh:()=>Promise<unknown>}
const Context=createContext<Value|null>(null)

export function OrganizationProvider({children}:{children:ReactNode}){
  const {user}=useAuth(); const [selected,setSelected]=useState<Organization|null>(null)
  const query=useQuery({queryKey:['memberships',user?.id],enabled:Boolean(user),queryFn:async()=>{
    const {data,error}=await supabase.from('organization_members').select('id, organization_id, user_id, status, organizations!inner(id,name,slug,base_currency,timezone,seat_limit,pilot_status,organization_settings(primary_color,logo_path,settings))').eq('status','active')
    if(error)throw error
    return (data??[]).map((membership)=>{
      const raw=membership.organizations as unknown as Organization&{organization_settings?:{primary_color:string;logo_path:string|null;settings?:Record<string,unknown>}|Array<{primary_color:string;logo_path:string|null;settings?:Record<string,unknown>}>}
      const settings=Array.isArray(raw.organization_settings)?raw.organization_settings[0]:raw.organization_settings
      const logoUrl=settings?.logo_path?supabase.storage.from('organization-assets').getPublicUrl(settings.logo_path).data.publicUrl:null
      return {...membership,organizations:{id:raw.id,name:raw.name,slug:raw.slug,base_currency:raw.base_currency,timezone:raw.timezone,seat_limit:raw.seat_limit,pilot_status:raw.pilot_status,primary_color:settings?.primary_color,logo_path:settings?.logo_path,logo_url:logoUrl,profile_enabled:settings?.settings?.profile_v1===true,consultant_first_enabled:settings?.settings?.consultant_first_v1!==false}} as unknown as Membership
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
  if(selected)configureFormat({locale:navigator.language,timeZone:selected.timezone,currency:selected.base_currency})
  const value=useMemo<Value>(()=>({memberships:query.data??[],organization:selected,loading:query.isLoading,setOrganization,refresh:query.refetch}),[query.data,query.isLoading,selected])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useOrganization(){const value=useContext(Context);if(!value)throw new Error('useOrganization must be used inside OrganizationProvider');return value}
