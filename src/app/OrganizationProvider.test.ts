import {describe,expect,it} from 'vitest'
import {selectOwnMembership} from './OrganizationProvider'
import type {Membership} from '../shared/types/domain'

/* Regression guard for the "my work shows the owner's queue" bug: the membership query returns every
 * active member of the org (RLS lets members see each other), so the caller's own row must be chosen
 * by user_id, not by position. A prior `query.data?.[0]` mis-scoped Today's "My work"/"My active
 * jobs" and JobsPage's default owner for every non-first consultant. */
const member=(id:string,userId:string):Membership=>({
  id,organization_id:'org1',user_id:userId,status:'active',
  organizations:{id:'org1',name:'Acme',slug:'acme',base_currency:'IDR',salary_period:'monthly',timezone:'Asia/Makassar',
    pilot_status:'active',primary_color:undefined,logo_path:undefined,logo_url:null,migration_complete:false,
    profile_footer_banner_path:null,profile_footer_banner_url:null,profile_enabled:false,whatsapp_country_code:null,whatsapp_template:null},
} as unknown as Membership)

describe('selectOwnMembership',()=>{
  const owner=member('m-owner','u-owner')
  const consultant=member('m-consultant','u-consultant')
  const rows=[owner,consultant] // owner sorts first, as it is created first

  it("returns the caller's own row, not the first row, for a non-first member",()=>{
    const picked=selectOwnMembership(rows,'u-consultant')
    expect(picked?.id).toBe('m-consultant')
    expect(picked?.user_id).toBe('u-consultant')
  })

  it("returns the owner's own row when the owner is the caller",()=>{
    expect(selectOwnMembership(rows,'u-owner')?.id).toBe('m-owner')
  })

  it('falls back to the first row when the caller is not in the set (mis-provisioned project)',()=>{
    expect(selectOwnMembership(rows,'u-stranger')?.id).toBe('m-owner')
  })

  it('returns null for an empty or missing result',()=>{
    expect(selectOwnMembership([],'u-owner')).toBeNull()
    expect(selectOwnMembership(undefined,'u-owner')).toBeNull()
  })
})
