import {describe,expect,it} from 'vitest'
import {membershipRowSchema} from './organizationProviderSchemas'

describe('membershipRowSchema',()=>{
  it('accepts a membership row with a singular organization_settings embed (its real 1:1 shape)',()=>{
    const row={
      id:'m1',organization_id:'o1',user_id:'u1',status:'active',
      organizations:{id:'o1',name:'Acme Agency',slug:'acme',base_currency:'IDR',salary_period:'monthly',timezone:'Asia/Makassar',pilot_status:'active',
        organization_settings:{primary_color:'#123456',logo_path:null,settings:{}}},
    }
    expect(membershipRowSchema.safeParse(row).success).toBe(true)
  })

  it('accepts an array-wrapped organization_settings embed too (defensive, matches existing Array.isArray handling)',()=>{
    const row={
      id:'m1',organization_id:'o1',user_id:'u1',status:'active',
      organizations:{id:'o1',name:'Acme Agency',slug:'acme',base_currency:'IDR',salary_period:'monthly',timezone:'Asia/Makassar',pilot_status:'active',
        organization_settings:[{primary_color:'#123456',logo_path:null,settings:{}}]},
    }
    expect(membershipRowSchema.safeParse(row).success).toBe(true)
  })

  it('accepts a null organization_settings embed (no settings row yet)',()=>{
    const row={
      id:'m1',organization_id:'o1',user_id:'u1',status:'active',
      organizations:{id:'o1',name:'Acme Agency',slug:'acme',base_currency:'IDR',salary_period:'monthly',timezone:'Asia/Makassar',pilot_status:'active',organization_settings:null},
    }
    expect(membershipRowSchema.safeParse(row).success).toBe(true)
  })
})
