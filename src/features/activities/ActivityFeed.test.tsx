import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {ActivityFeed} from './ActivityFeed'
import type {ActivityLink} from '../core/repository'

const {listActivities,createActivity}=vi.hoisted(()=>({listActivities:vi.fn(),createActivity:vi.fn()}))
vi.mock('../core/repository',()=>({listActivities,createActivity}))
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization:{id:'org-1',slug:'northstar'}})}))

const entry={id:'a1',activity_type:'call',direction:'outbound',subject:'Intro call',summary:'Interested, three months notice.',occurred_at:new Date().toISOString(),created_by:'user-1',profiles:{full_name:'Satya Rao'}}

function renderFeed(links:ActivityLink[]=[{candidate_id:'cand-1'}]){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><ActivityFeed links={links}/></QueryClientProvider>)
}

describe('ActivityFeed',()=>{
  beforeEach(()=>{vi.clearAllMocks();listActivities.mockResolvedValue([]);createActivity.mockResolvedValue('new-id')})

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
    await waitFor(()=>expect(createActivity).toHaveBeenCalledWith('org-1',expect.objectContaining({activity_type:'call',direction:'outbound',summary:'Left a voicemail.'}),[{candidate_id:'cand-1'},{job_id:'job-9'}]))
  })

  it('will not submit an entry with no summary',async()=>{
    renderFeed()
    fireEvent.click(await screen.findByRole('button',{name:'Log activity'}))
    expect(screen.getByRole('button',{name:'Save activity'})).toBeDisabled()
    expect(createActivity).not.toHaveBeenCalled()
  })

  it('surfaces a rejected write instead of implying it saved',async()=>{
    createActivity.mockRejectedValue(new Error('permission_denied'))
    renderFeed()
    fireEvent.click(await screen.findByRole('button',{name:'Log activity'}))
    fireEvent.change(screen.getByLabelText('What happened'),{target:{value:'Called the client.'}})
    fireEvent.click(screen.getByRole('button',{name:'Save activity'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('permission_denied')
  })
})
