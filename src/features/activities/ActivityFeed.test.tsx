import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {ActivityFeed} from './ActivityFeed'
import {ToastProvider} from '../../shared/ui/Toast'
import type {ActivityLink} from '../core/repository'

const {listActivities,createActivityWithFollowUp,listTeamMembers,capabilities}=vi.hoisted(()=>({
  listActivities:vi.fn(),createActivityWithFollowUp:vi.fn(),listTeamMembers:vi.fn(),capabilities:vi.fn(),
}))
vi.mock('../core/repository',()=>({listActivities,createActivityWithFollowUp}))
vi.mock('../core/commercialRepository',()=>({listTeamMembers}))
vi.mock('../../app/useWorkspaceCapabilities',()=>({useWorkspaceCapabilities:()=>({data:capabilities()})}))
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization:{id:'org-1',slug:'northstar'},membership:{id:'member-1'}})}))

const entry={id:'a1',activity_type:'call',direction:'outbound',subject:'Intro call',summary:'Interested, three months notice.',occurred_at:new Date().toISOString(),created_by:'user-1',profiles:{full_name:'Satya Rao'}}

/* ToastProvider is part of the harness because the component now reports a failed write as a toast as
 * well as inline. useToast deliberately throws without a provider rather than degrading to a no-op --
 * a toast that silently does nothing is the bug that policy exists to prevent -- so the provider
 * belongs here, exactly as it is mounted once around the real app in main.tsx. */
function renderFeed(links:ActivityLink[]=[{candidate_id:'cand-1'}]){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><ToastProvider><ActivityFeed links={links}/></ToastProvider></QueryClientProvider>)
}

describe('ActivityFeed',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    listActivities.mockResolvedValue([])
    createActivityWithFollowUp.mockResolvedValue({activity_id:'new-id',task_id:null})
    listTeamMembers.mockResolvedValue([{id:'member-1',user_id:'user-1',status:'active',profiles:{full_name:'Satya Rao'}}])
    capabilities.mockReturnValue({readOnly:false})
  })

  it('reads the feed for the record it is mounted on',async()=>{
    renderFeed([{candidate_id:'cand-1'}])
    await waitFor(()=>expect(listActivities).toHaveBeenCalledWith('org-1',{candidate_id:'cand-1'}))
  })

  it('invites the first entry when the record has no history',async()=>{
    renderFeed()
    expect(await screen.findByText('No activity yet')).toBeInTheDocument()
  })

  it('renders a logged entry with its author',async()=>{
    listActivities.mockResolvedValue([entry])
    renderFeed()
    expect(await screen.findByText('Intro call')).toBeInTheDocument()
    expect(screen.getByText('Interested, three months notice.')).toBeInTheDocument()
    expect(screen.getByText(/Satya Rao/)).toBeInTheDocument()
  })

  it('uses the historical author snapshot before an explicit former-user fallback',async()=>{
    listActivities.mockResolvedValue([{...entry,profiles:null,actor_name_snapshot:'Former Consultant'}])
    renderFeed()
    expect(await screen.findByText(/Former Consultant/)).toBeInTheDocument()
  })

  // Mirrors log_manual_activity, which rejects system types: status_change, submission, placement
  // and client_feedback must remain provable system output that a consultant cannot forge.
  it('offers only hand-recordable types',async()=>{
    renderFeed()
    fireEvent.click(await screen.findByRole('button',{name:'Log activity'}))
    const options=Array.from(screen.getByLabelText('Type').querySelectorAll('option')).map((option)=>option.getAttribute('value'))
    expect(options).toEqual(['call','email','whatsapp','meeting','other'])
    expect(options).not.toContain('status_change')
    expect(options).not.toContain('placement')
  })

  // One activity, many link rows: logging from a pipeline files against candidate and vacancy at once.
  it('files a new entry against every linked record',async()=>{
    renderFeed([{candidate_id:'cand-1'},{job_id:'job-9'}])
    fireEvent.click(await screen.findByRole('button',{name:'Log activity'}))
    fireEvent.change(screen.getByLabelText('What happened'),{target:{value:'Left a voicemail.'}})
    fireEvent.click(screen.getByRole('button',{name:'Save activity'}))
    await waitFor(()=>expect(createActivityWithFollowUp).toHaveBeenCalledWith('org-1',expect.objectContaining({activity_type:'call',direction:'outbound',summary:'Left a voicemail.'}),[{candidate_id:'cand-1'},{job_id:'job-9'}],undefined))
  })

  it('will not submit an entry with no summary',async()=>{
    renderFeed()
    fireEvent.click(await screen.findByRole('button',{name:'Log activity'}))
    expect(screen.getByRole('button',{name:'Save activity'})).toBeDisabled()
    expect(createActivityWithFollowUp).not.toHaveBeenCalled()
  })

  it('surfaces a rejected write instead of implying it saved',async()=>{
    createActivityWithFollowUp.mockRejectedValue(new Error('permission_denied'))
    renderFeed()
    fireEvent.click(await screen.findByRole('button',{name:'Log activity'}))
    fireEvent.change(screen.getByLabelText('What happened'),{target:{value:'Called the client.'}})
    fireEvent.click(screen.getByRole('button',{name:'Save activity'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('permission_denied')
  })
})

/* The follow-up half.
 *
 * The behaviour that matters is not the fields -- it is that the two writes are ONE write. Two calls
 * can half-succeed, and the half that survives is the note claiming a follow-up exists. So the tests
 * below check that exactly one request is made, that a refusal reports both halves as unsaved, and
 * that the optional section stays genuinely optional.
 */
describe('ActivityFeed follow-up',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    listActivities.mockResolvedValue([])
    createActivityWithFollowUp.mockResolvedValue({activity_id:'new-id',task_id:'task-1'})
    listTeamMembers.mockResolvedValue([{id:'member-1',user_id:'user-1',status:'active',profiles:{full_name:'Satya Rao'}}])
    capabilities.mockReturnValue({readOnly:false})
  })

  const openComposer=async()=>{fireEvent.click(await screen.findByRole('button',{name:'Log activity'}))}

  it('leaves the follow-up closed by default',async()=>{
    renderFeed()
    await openComposer()
    expect(screen.queryByLabelText('What needs to happen next?')).toBeNull()
    expect(screen.getByRole('button',{name:'Save activity'})).toBeInTheDocument()
  })

  it('sends no follow-up when the section was never opened',async()=>{
    renderFeed()
    await openComposer()
    fireEvent.change(screen.getByLabelText('What happened'),{target:{value:'Left a voicemail.'}})
    fireEvent.click(screen.getByRole('button',{name:'Save activity'}))
    await waitFor(()=>expect(createActivityWithFollowUp).toHaveBeenCalled())
    expect(createActivityWithFollowUp.mock.calls.at(-1)?.[3]).toBeUndefined()
  })

  /* One request, carrying both. If this ever becomes two calls, the failure mode this whole design
   * exists to prevent is back. */
  it('saves the activity and the follow-up in a single request',async()=>{
    renderFeed([{candidate_id:'cand-1'}])
    await openComposer()
    fireEvent.change(screen.getByLabelText('What happened'),{target:{value:'Discussed the counter-offer.'}})
    fireEvent.click(screen.getByLabelText(/Schedule a follow-up/))
    fireEvent.change(screen.getByLabelText('What needs to happen next?'),{target:{value:'Call back Friday'}})
    fireEvent.click(screen.getByRole('button',{name:'Save activity and follow-up'}))
    await waitFor(()=>expect(createActivityWithFollowUp).toHaveBeenCalledTimes(1))
    const [organizationId,activity,links,followUp]=createActivityWithFollowUp.mock.calls[0]!
    expect(organizationId).toBe('org-1')
    expect(activity).toEqual(expect.objectContaining({summary:'Discussed the counter-offer.'}))
    expect(links).toEqual([{candidate_id:'cand-1'}])
    expect(followUp).toEqual(expect.objectContaining({title:'Call back Friday',priority:'normal',ownerMemberId:'member-1'}))
  })

  /* Asked for and left unnamed is not "no follow-up" -- it is an unfinished form, and dropping it
   * quietly on the way to the server would save an activity the user thinks has a task attached. */
  it('will not submit an opened follow-up with no title',async()=>{
    renderFeed()
    await openComposer()
    fireEvent.change(screen.getByLabelText('What happened'),{target:{value:'Called the client.'}})
    fireEvent.click(screen.getByLabelText(/Schedule a follow-up/))
    expect(screen.getByRole('button',{name:'Save activity and follow-up'})).toBeDisabled()
    expect(createActivityWithFollowUp).not.toHaveBeenCalled()
  })

  /* The message has to cover both halves, because one transaction wrote neither. A failure naming
   * only the activity would leave the consultant to guess about the task. */
  it('reports both halves as unsaved when the write is refused',async()=>{
    createActivityWithFollowUp.mockRejectedValue(new Error('permission_denied'))
    renderFeed()
    await openComposer()
    fireEvent.change(screen.getByLabelText('What happened'),{target:{value:'Called the client.'}})
    fireEvent.click(screen.getByLabelText(/Schedule a follow-up/))
    fireEvent.change(screen.getByLabelText('What needs to happen next?'),{target:{value:'Call back Friday'}})
    fireEvent.click(screen.getByRole('button',{name:'Save activity and follow-up'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('permission_denied')
    expect(screen.getByText(/If the follow-up cannot be created, neither is saved/)).toBeInTheDocument()
  })

  /* task_links reaches candidates, companies, contacts and jobs and nothing else. Rather than offer
   * the section and let the server refuse it, a feed with no valid target does not offer it. */
  it('does not offer a follow-up where a task cannot be attached',async()=>{
    renderFeed([{candidate_submission_id:'sub-1'}])
    await openComposer()
    expect(screen.queryByLabelText(/Schedule a follow-up/)).toBeNull()
  })

  it('does not offer a follow-up to a read-only member',async()=>{
    capabilities.mockReturnValue({readOnly:true})
    renderFeed()
    await openComposer()
    expect(screen.queryByLabelText(/Schedule a follow-up/)).toBeNull()
  })

  // A closed section must not cost a team request on every record a consultant opens.
  it('loads the team only once the section is opened',async()=>{
    renderFeed()
    await openComposer()
    expect(listTeamMembers).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText(/Schedule a follow-up/))
    await waitFor(()=>expect(listTeamMembers).toHaveBeenCalled())
  })
})
