import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../shared/lib/supabase'
import type { Membership, Organization } from '../shared/types/domain'
import { useAuth } from './AuthProvider'

type Value={memberships:Membership[];organization:Organization|null;loading:boolean;setOrganization:(organization:Organization)=>void;refresh:()=>Promise<unknown>}
const Context=createContext<Value|null>(null)

export function OrganizationProvider({children}:{children:ReactNode}){
  const {user}=useAuth(); const [selected,setSelected]=useState<Organization|null>(null)
  const query=useQuery({queryKey:['memberships',user?.id],enabled:Boolean(user),queryFn:async()=>{
    const {data,error}=await supabase.from('organization_members').select('id, organization_id, user_id, status, organizations!inner(id,name,slug,base_currency,timezone,organization_settings(primary_color,logo_path))').eq('status','active')
    if(error)throw error
    return (data??[]).map((membership)=>{
      const raw=membership.organizations as unknown as Organization&{organization_settings?:{primary_color:string;logo_path:string|null}|Array<{primary_color:string;logo_path:string|null}>}
      const settings=Array.isArray(raw.organization_settings)?raw.organization_settings[0]:raw.organization_settings
      const logoUrl=settings?.logo_path?supabase.storage.from('organization-assets').getPublicUrl(settings.logo_path).data.publicUrl:null
      return {...membership,organizations:{id:raw.id,name:raw.name,slug:raw.slug,base_currency:raw.base_currency,timezone:raw.timezone,primary_color:settings?.primary_color,logo_path:settings?.logo_path,logo_url:logoUrl}} as unknown as Membership
    })
  }})
  useEffect(()=>{if(!query.data?.length){setSelected(null);return}if(selected&&query.data.some((item)=>item.organizations.id===selected.id))return;const stored=localStorage.getItem('agency_active_org');const match=query.data.find((membership)=>membership.organizations.slug===stored)??query.data[0];if(match)setSelected(match.organizations)},[query.data,selected])
  const setOrganization=(organization:Organization)=>{setSelected(organization);localStorage.setItem('agency_active_org',organization.slug)}
  const value=useMemo<Value>(()=>({memberships:query.data??[],organization:selected,loading:query.isLoading,setOrganization,refresh:query.refetch}),[query.data,query.isLoading,selected])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useOrganization(){const value=useContext(Context);if(!value)throw new Error('useOrganization must be used inside OrganizationProvider');return value}
