import {describe,expect,it} from 'vitest'
import type {JobHealth} from '../../shared/types/domain'
import {filterJobHealth,phaseSegments} from './jobHealth'

const job=(input:Partial<JobHealth>={}):JobHealth=>({id:'job',company_id:'company',pipeline_id:'pipeline',title:'Role',company_name:'Client',location:null,priority:'normal',status:'open',owner_member_id:'member',owner_name:'Owner',opened_at:'2026-07-01',days_open:17,candidate_count:2,waiting_count:0,phase_counts:{screening:1,interview:1},salary_min:null,salary_max:null,currency:'USD',fee_percentage:null,fixed_fee:null,expected_fee:null,fee_source:null,next_action:null,last_activity_at:'2026-07-17T00:00:00Z',already_in_job:false,updated_at:'2026-07-17T00:00:00Z',...input})

describe('job health filters',()=>{
  it('finds owner and pipeline gaps',()=>{expect(filterJobHealth([job(),job({id:'gap',owner_member_id:null,candidate_count:0})],'unowned').map((item)=>item.id)).toEqual(['gap']);expect(filterJobHealth([job(),job({id:'gap',candidate_count:0})],'empty').map((item)=>item.id)).toEqual(['gap'])})
  it('uses phase counts for active delivery filters',()=>{expect(filterJobHealth([job(),job({id:'offer',phase_counts:{offer:1}})],'offer').map((item)=>item.id)).toEqual(['offer']);expect(phaseSegments(job())).toEqual([{key:'screening',count:1},{key:'interview',count:1}])})
})
