import {describe,expect,it} from 'vitest'
import type {JobHealth} from '../../shared/types/domain'
import {filterJobHealth,filterJobStatus,nextActionDetail,nextActionHref,phaseSegments} from './jobHealth'

const job=(input:Partial<JobHealth>={}):JobHealth=>({id:'job',company_id:'company',pipeline_id:'pipeline',title:'Role',company_name:'Client',location:null,priority:'normal',status:'open',owner_member_id:'member',owner_name:'Owner',opened_at:'2026-07-01',days_open:17,candidate_count:2,waiting_count:0,phase_counts:{screening:1,interview:1},salary_min:null,salary_max:null,currency:'USD',fee_percentage:null,fixed_fee:null,expected_fee:null,fee_source:null,next_action:null,last_activity_at:'2026-07-17T00:00:00Z',already_in_job:false,updated_at:'2026-07-17T00:00:00Z',...input})

describe('job health filters',()=>{
  it('finds owner and pipeline gaps',()=>{expect(filterJobHealth([job(),job({id:'gap',owner_member_id:null,candidate_count:0})],'unowned').map((item)=>item.id)).toEqual(['gap']);expect(filterJobHealth([job(),job({id:'gap',candidate_count:0})],'empty').map((item)=>item.id)).toEqual(['gap'])})
  it('uses phase counts for active delivery filters',()=>{expect(filterJobHealth([job(),job({id:'offer',phase_counts:{offer:1}})],'offer').map((item)=>item.id)).toEqual(['offer']);expect(phaseSegments(job())).toEqual([{key:'screening',count:1},{key:'interview',count:1}])})
})

describe('job status filter',()=>{
  const all=[job({id:'open',status:'open'}),job({id:'draft',status:'draft'}),job({id:'hold',status:'on_hold'}),job({id:'filled',status:'filled'}),job({id:'closed',status:'closed'}),job({id:'cancelled',status:'cancelled'})]
  it('groups the statuses a consultant actually asks about',()=>{
    expect(filterJobStatus(all,'active').map((item)=>item.id)).toEqual(['open','draft','hold'])
    expect(filterJobStatus(all,'filled').map((item)=>item.id)).toEqual(['filled'])
    // Cancelled travels with closed: both answer "what did we stop working on".
    expect(filterJobStatus(all,'closed').map((item)=>item.id)).toEqual(['closed','cancelled'])
  })
  // The regression this exists for: filled and closed jobs were unreachable from the list entirely.
  it('reaches every job under All',()=>expect(filterJobStatus(all,'all')).toHaveLength(6))
})

describe('next action links',()=>{
  it('routes each action to the surface that performs it',()=>{
    expect(nextActionHref('/jobs/1',{next_action:'Assign an owner'})).toBe('/jobs/1?open=edit')
    expect(nextActionHref('/jobs/1',{next_action:'Add candidates'})).toBe('/jobs/1?open=add')
    expect(nextActionHref('/jobs/1',{next_action:'Log first activity'})).toBe('/jobs/1?view=activity')
  })
  it('falls back to the board when the action is already there or absent',()=>{
    expect(nextActionHref('/jobs/1',{next_action:'Review waiting candidates'})).toBe('/jobs/1')
    expect(nextActionHref('/jobs/1',{next_action:null})).toBe('/jobs/1')
  })

  /* The list's link and the workspace's button read the same model, so a phrase can never route one
   * way in the list and another in the workspace. */
  it('gives the workspace the same surface it gives the list a link to',()=>{
    expect(nextActionDetail(job({next_action:'Assign an owner'}))?.surface).toBe('edit')
    expect(nextActionDetail(job({next_action:'Add candidates'}))?.surface).toBe('add')
    expect(nextActionDetail(job({next_action:null}))).toBeNull()
  })
  it('explains a waiting count in the plural it actually is',()=>{
    expect(nextActionDetail(job({next_action:'Review waiting candidates',waiting_count:1}))?.explain).toContain('1 candidate has')
    expect(nextActionDetail(job({next_action:'Review waiting candidates',waiting_count:3}))?.explain).toContain('3 candidates have')
  })
})
