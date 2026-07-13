import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../shared/lib/supabase'
import type { Membership, Organization } from '../shared/types/domain'
import { useAuth } from './AuthProvider'

type Value={memberships:Membership[];organization:Organization|null;loading:boolean;setOrganization:(organization:Organization)=>void;refresh:()=>Promise<unknown>}
const Context=createContext<Value|null>(null)

export function OrganizationProvider({children}:{children:ReactNode}){
  const {user}=useAuth(); const [selected,setSelected]=useState<Organization|null>(null)
  const query=useQuery({queryKey:['memberships',user?.id],enabled:Boolean(user),queryFn:async()=>{const {data,error}=await supabase.from('organization_members').select('id, organization_id, status, organizations!inner(id,name,slug,base_currency,timezone)').eq('status','active');if(error)throw error;return (data??[]) as unknown as Membership[]}})
  useEffect(()=>{if(selected||!query.data?.length)return;const stored=localStorage.getItem('agency_active_org');const match=query.data.find((m)=>m.organizations.slug===stored)??query.data[0];if(match)setSelected(match.organizations)},[query.data,selected])
  const setOrganization=(organization:Organization)=>{setSelected(organization);localStorage.setItem('agency_active_org',organization.slug)}
  const value=useMemo<Value>(()=>({memberships:query.data??[],organization:selected,loading:query.isLoading,setOrganization,refresh:query.refetch}),[query.data,query.isLoading,selected])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useOrganization(){const value=useContext(Context);if(!value)throw new Error('useOrganization must be used inside OrganizationProvider');return value}

