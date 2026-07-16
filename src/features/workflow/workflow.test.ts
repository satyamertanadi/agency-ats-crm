import {describe,expect,it} from 'vitest'
import {buildTodayWorkItems,groupPipelineStages,phaseForStage,recommendedCandidateAction} from './workflow'

const stage=(stage_key:string,stage_type='active')=>({id:stage_key,pipeline_id:'p1',name:stage_key,stage_key,stage_type,position:0,color:null,phase_key:null})

describe('consultant workflow model',()=>{
  it('maps detailed stages to seven operating phases without losing unknown stages',()=>{
    expect(phaseForStage(stage('submitted_to_client'))).toBe('client_review')
    expect(phaseForStage(stage('custom_client_gate'))).toBe('other')
    expect(groupPipelineStages([stage('sourced'),stage('screening'),stage('offer')]).map((item)=>item.label)).toEqual(['Sourcing','Screening','Offer'])
  })

  it('recommends the next human-controlled milestone',()=>{
    expect(recommendedCandidateAction({stage:stage('shortlisted'),hasSubmission:false,interviews:[],offers:[],hasPlacement:false}).key).toBe('submit')
    expect(recommendedCandidateAction({stage:stage('offer'),hasSubmission:true,interviews:[],offers:[],hasPlacement:false}).key).toBe('record_offer')
  })

  it('ranks blocked work before overdue and recommended work',()=>{
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),currentMemberId:'m1',jobs:[],tasks:[{id:'t1',title:'Call client',description:null,status:'open',priority:'normal',due_at:'2026-07-15T10:00:00Z',owner_member_id:'m1',created_at:'2026-07-14T10:00:00Z',task_links:[]}],offers:[],interviews:[{id:'i1',job_candidate_id:'jc1',interview_type:null,stage_label:null,starts_at:'2026-07-17T10:00:00Z',ends_at:'2026-07-17T11:00:00Z',timezone:'UTC',location:null,meeting_url:null,status:'scheduled',organizer_member_id:'m1',attendee_emails:[],create_google_meet:false,calendar_event_id:null,calendar_event_url:null,calendar_sync_status:'failed',calendar_last_error:'Reconnect Calendar',calendar_last_synced_at:null,calendar_retry_count:1,calendar_sync_version:1,calendar_synced_version:0}]})
    expect(items.map((item)=>item.kind)).toEqual(['blocked','overdue'])
  })

  it('surfaces failed delivery once even when its submission link is also expired',()=>{
    const items=buildTodayWorkItems({base:'/app/northstar',now:new Date('2026-07-16T10:00:00Z'),jobs:[],tasks:[],offers:[],interviews:[],deliveryIssues:[{id:'d1',status:'bounced',email_type:'client_submission',related_entity_id:'p1',error_message:'Mailbox rejected the message',updated_at:'2026-07-15T10:00:00Z'}],submissions:[{id:'p1',job_id:'j1',title:'Engineer shortlist',public_submission_links:[{id:'l1',expires_at:'2026-07-14T10:00:00Z',revoked_at:null}]}]})
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({kind:'blocked',title:'Resolve bounced delivery',href:'/app/northstar/jobs/j1'})
  })
})
