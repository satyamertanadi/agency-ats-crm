import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {render,screen,waitFor} from '@testing-library/react'
import type {ReactNode} from 'react'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {InterviewIntelligenceCard} from './InterviewIntelligenceCard'
import {ToastProvider} from '../../shared/ui/Toast'
import type {Interview} from '../../shared/types/domain'

/* The client half of the coaching boundary. RLS is the real gate (tests/rls/interview-intelligence),
 * but a section that renders an empty shell, or a query that fires and gets filtered, both tell a
 * consultant that a review of them exists. Neither should happen. */

const {getTranscript,getNotes,getCoaching,analyze,startTranscript}=vi.hoisted(()=>({
  getTranscript:vi.fn(),getNotes:vi.fn(),getCoaching:vi.fn(),analyze:vi.fn(),startTranscript:vi.fn(),
}))

vi.mock('../core/commercialRepository',()=>({
  getInterviewTranscript:getTranscript,
  getInterviewNotes:getNotes,
  getInterviewCoachingReview:getCoaching,
  analyzeInterview:analyze,
  startInterviewTranscript:startTranscript,
  acceptInterviewNotes:vi.fn(),
}))

const interview={
  id:'interview-1',job_candidate_id:'jc-1',starts_at:'2026-07-29T02:00:00Z',ends_at:'2026-07-29T02:45:00Z',
  timezone:'Asia/Singapore',meeting_url:'https://meet.google.com/abc-defg-hij',status:'completed',
} as Interview

const notes={
  id:'notes-1',interview_id:'interview-1',version:1,status:'accepted' as const,score:75,language:'en-US',
  degraded_reason:null,accepted_at:'2026-07-29T04:00:00Z',created_at:'2026-07-29T03:00:00Z',reviewed_content:null,
  generated_content:{
    detected_language:'en-US',
    summary:{headline:'Four years leading a regional team.',key_points:[],topics_covered:[],candidate_stated_facts:[],
      logistics:{notice_period:'',salary_expectation:'',location_preference:'',availability:''}},
    candidate_assessment:{requirement_evidence:[],strengths:[],concerns:[],open_questions:[],recommendation_note:''},
    consultant_assessment:{rubric:[],missed_topics:[]},
    score:75,rating_summary:{strong:0,adequate:0,needs_work:0,not_observed:8,index:0},
  },
}

const coaching={
  id:'coach-1',interview_id:'interview-1',interview_ai_notes_id:'notes-1',subject_member_id:'member-1',
  rubric:[{criterion:'role_and_process_explained',rating:'strong' as const,evidence_quote:'Let me explain the role.',coaching_note:'Keep doing this.'}],
  rating_summary:{strong:1,adequate:0,needs_work:0,not_observed:7,index:100},
  missed_topics:['salary expectations'],created_at:'2026-07-29T03:00:00Z',
}

function wrapper({children}:{children:ReactNode}){
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  return <QueryClientProvider client={client}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
}

const renderCard=(canViewCoaching:boolean)=>render(
  <InterviewIntelligenceCard organizationId="org-1" interview={interview} candidateName="Amara Chen"
    canManage canViewCoaching={canViewCoaching} onUpdated={()=>Promise.resolve()}/>,
  {wrapper},
)

beforeEach(()=>{
  vi.clearAllMocks()
  getTranscript.mockResolvedValue({id:'t-1',interview_id:'interview-1',status:'ready',language:'en-US',
    talk_time:{consultant_ms:6000,candidate_ms:14000,other_ms:0},duration_seconds:1200,entry_count:2,attempts:1,
    next_attempt_at:'2026-07-29T03:00:00Z',failure_code:null,failure_message:null,fetched_at:'2026-07-29T03:00:00Z'})
  getNotes.mockResolvedValue(notes)
  getCoaching.mockResolvedValue(coaching)
})

describe('coaching visibility',()=>{
  it('shows the review to a member who holds the permission',async()=>{
    renderCard(true)
    expect(await screen.findByText('Interviewing performance')).toBeInTheDocument()
    expect(screen.getByText('Explained the role and the process')).toBeInTheDocument()
  })

  it('renders nothing about the review, and never requests it, without the permission',async()=>{
    renderCard(false)
    // Wait for the notes to land so the absence below is a real absence, not a race.
    expect(await screen.findByText('Four years leading a regional team.')).toBeInTheDocument()
    expect(screen.queryByText('Interviewing performance')).not.toBeInTheDocument()
    expect(getCoaching).not.toHaveBeenCalled()
  })
})

describe('transcript states',()=>{
  it('explains an absent transcript as a host setting rather than a failure',async()=>{
    getTranscript.mockResolvedValue({id:'t-1',interview_id:'interview-1',status:'unavailable',language:null,
      talk_time:{consultant_ms:0,candidate_ms:0,other_ms:0},duration_seconds:0,entry_count:0,attempts:6,
      next_attempt_at:'2026-07-30T03:00:00Z',failure_code:'transcript_not_available',failure_message:'No Meet transcript exists for this call yet.',fetched_at:null})
    getNotes.mockResolvedValue(null)
    renderCard(true)
    expect(await screen.findByText(/Transcription is started by the meeting host/)).toBeInTheDocument()
    // Nothing to read means nothing to pay a model to read.
    await waitFor(()=>expect(analyze).not.toHaveBeenCalled())
  })

  it('points a stale Google connection at reconnecting rather than at a retry',async()=>{
    getTranscript.mockResolvedValue({id:'t-1',interview_id:'interview-1',status:'failed',language:null,
      talk_time:{consultant_ms:0,candidate_ms:0,other_ms:0},duration_seconds:0,entry_count:0,attempts:1,
      next_attempt_at:'2026-07-30T03:00:00Z',failure_code:'calendar_reauthorization_required',
      failure_message:'Reconnect Google Calendar to grant Meet transcript access.',fetched_at:null})
    getNotes.mockResolvedValue(null)
    renderCard(true)
    expect(await screen.findByText(/reconnect Google Calendar in workspace settings/)).toBeInTheDocument()
  })

  it('generates notes once when a transcript lands with none, and not again',async()=>{
    getNotes.mockResolvedValue(null)
    analyze.mockResolvedValue({notesId:'notes-1',version:1,status:'draft'})
    renderCard(true)
    await waitFor(()=>expect(analyze).toHaveBeenCalledTimes(1))
    expect(analyze).toHaveBeenCalledWith('org-1','interview-1',false)
    // The card keeps polling and re-rendering; a second dispatch would be a second bill.
    await new Promise((resolve)=>setTimeout(resolve,50))
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('does not generate notes when the interview already has them',async()=>{
    renderCard(true)
    expect(await screen.findByText('Four years leading a regional team.')).toBeInTheDocument()
    expect(analyze).not.toHaveBeenCalled()
  })
})
