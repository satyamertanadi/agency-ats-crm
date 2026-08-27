import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {Interview} from '../../shared/types/domain'
import {ToastProvider} from '../../shared/ui/Toast'
import {JobCandidateLifecycle} from './JobCandidateLifecycle'

const {cancelInterviewWithNotifications,completeInterview,listStageHistory,listSubmissionFeedback,updateOfferStatus}=vi.hoisted(()=>(
  {cancelInterviewWithNotifications:vi.fn(),completeInterview:vi.fn(),listStageHistory:vi.fn(),listSubmissionFeedback:vi.fn(),updateOfferStatus:vi.fn()}
))
vi.mock('../core/commercialRepository',()=>({cancelInterviewWithNotifications}))
vi.mock('../core/repository',()=>({completeInterview,listStageHistory,listSubmissionFeedback,updateOfferStatus}))

const interview=(overrides:Partial<Interview>={}):Interview=>({
  id:'interview-1',job_candidate_id:'job-candidate-1',interview_type:'client_interview',stage_label:null,
  starts_at:'2026-10-01T09:00:00Z',ends_at:'2026-10-01T10:00:00Z',timezone:'UTC',location:null,meeting_url:null,
  status:'scheduled',organizer_member_id:null,attendee_emails:['client@example.com'],create_google_meet:false,
  calendar_event_id:null,calendar_event_url:null,calendar_sync_status:'not_requested',calendar_last_error:null,
  calendar_last_synced_at:null,calendar_retry_count:0,calendar_sync_version:1,calendar_synced_version:0,...overrides,
})

function renderLifecycle(interviews:Interview[]){
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  const onUpdated=vi.fn().mockResolvedValue(undefined)
  render(<QueryClientProvider client={client}><ToastProvider><JobCandidateLifecycle
    organizationId="org-1" jobCandidateId="job-candidate-1" candidateId="cand-1" candidateName="Ana Chen"
    interviews={interviews} offers={[]} canManageInterviews canManageOffers readOnly={false}
    canUseInterviewIntelligence={false}
    onUpdated={onUpdated} onReschedule={vi.fn()}/></ToastProvider></QueryClientProvider>)
  return onUpdated
}

describe('JobCandidateLifecycle interview cancellation',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();listStageHistory.mockResolvedValue([]);listSubmissionFeedback.mockResolvedValue([])
    cancelInterviewWithNotifications.mockResolvedValue({status:'cancelled',calendarStatus:'not_required',notificationStatus:'sent',recipientCount:1,failedRecipientCount:0})
  })

  it('confirms that attendees are notified and uses the atomic cancellation path',async()=>{
    const onUpdated=renderLifecycle([interview()])
    fireEvent.click(screen.getByRole('button',{name:'Cancel'}))
    expect(screen.getByText(/Every recorded attendee will be notified automatically/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Cancel interview'}))
    await waitFor(()=>expect(cancelInterviewWithNotifications).toHaveBeenCalledWith('org-1','interview-1'))
    await waitFor(()=>expect(onUpdated).toHaveBeenCalled())
    expect(screen.getByText('Interview cancelled for Ana Chen.')).toBeInTheDocument()
  })

  it('offers a safe retry only when a cancelled interview still has an external issue',async()=>{
    renderLifecycle([interview({status:'cancelled',calendar_sync_status:'failed',calendar_last_error:'Reconnect Calendar',cancellation_delivery_issues:1})])
    fireEvent.click(screen.getByRole('button',{name:'Retry cancellation'}))
    expect(screen.getByText(/Failed or pending notifications/)).toBeInTheDocument()
    const retryButtons=screen.getAllByRole('button',{name:'Retry cancellation'})
    fireEvent.click(retryButtons[retryButtons.length-1]!)
    await waitFor(()=>expect(cancelInterviewWithNotifications).toHaveBeenCalledWith('org-1','interview-1'))
  })
})
