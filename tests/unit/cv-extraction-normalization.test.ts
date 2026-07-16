import {describe,expect,it} from 'vitest'
import {normalizeCvExtraction} from '../../supabase/functions/_shared/cv-schema'

const base={
  full_name:'Ayu',current_company:null,current_position:null,location:null,linkedin_url:null,portfolio_url:null,source:null,availability:null,notice_period_days:null,
  private:{email:null,phone:null,current_salary:null,expected_salary:null,salary_currency:null,work_authorization:null},
  skills:[],languages:[],field_evidence:[],uncertainties:[],
}

describe('CV extraction date normalization',()=>{
  it('removes provider prose and impossible values from date fields',()=>{
    const value=normalizeCvExtraction({...base,
      employment:[{company_name:'Acme',title:'Lead',started_on:'2024-02-30',started_on_precision:'day',ended_on:'Present',ended_on_precision:'month',is_current:true}],
      education:[{institution:'UI',started_on:'2018-01-01',started_on_precision:'year',ended_on:'2022-13-01',ended_on_precision:'year'}],
    })
    expect(value.employment[0]).toMatchObject({started_on:null,started_on_precision:null,ended_on:null,ended_on_precision:null})
    expect(value.education[0]).toMatchObject({started_on:'2018-01-01',started_on_precision:'year',ended_on:null,ended_on_precision:null})
  })
})
