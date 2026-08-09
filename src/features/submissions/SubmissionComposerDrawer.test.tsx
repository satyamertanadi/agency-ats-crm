import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {SubmissionComposerDrawer} from './SubmissionComposerDrawer'
import {ToastProvider} from '../../shared/ui/Toast'
import type {Job} from '../../shared/types/domain'

/* One composer handles both a single candidate and a shortlist. These tests pin the commercial
 * outcome: one client package, useful defaults from the candidate record, and no mandatory admin
 * wall before a consultant can send it. */

const {sendClientSubmission,listSubmissionCandidateDocuments,listContacts}=vi.hoisted(()=>({
  sendClientSubmission:vi.fn(),listSubmissionCandidateDocuments:vi.fn(),listContacts:vi.fn(),
}))
vi.mock('../core/commercialRepository',()=>({sendClientSubmission,listSubmissionCandidateDocuments}))
vi.mock('../core/repository',()=>({listContacts}))
// The composer links salary/notice/availability back to the candidate record that owns them.
vi.mock('../../app/OrganizationProvider',()=>({useOrganization:()=>({organization:{id:'org-1',slug:'sembada'}})}))

const job={id:'job-1',title:'Head of Brand',company_id:'co-1',currency:'IDR',status:'open',
  companies:{id:'co-1',name:'Sembada Pangan'}} as Job

const candidateRow=(id:string,name:string,consent='granted',status='active')=>({
  id,candidate_id:`cand-${id}`,
  candidates:{id:`cand-${id}`,full_name:name,current_company:'Acme',current_position:'Brand Manager',status,
    availability:'Within 2 weeks',notice_period_days:30,
    candidate_private_details:{consent_status:consent,expected_salary:45_000_000,salary_currency:'IDR'},
    document_links:[{documents:{id:`doc-${id}`,file_name:'cv.pdf',original_filename:`${name}-cv.pdf`,mime_type:'application/pdf',storage_path:'p',size_bytes:1024,created_at:'2026-07-01T00:00:00Z',deleted_at:null}}]},
})

/* <details>/<summary> does not toggle from a synthetic click in jsdom, so the open state is set the
 * way the browser would and the toggle event fired to match. */
function expandCandidate(name:string){
  const summary=screen.getByText(name).closest('summary') as HTMLElement
  const details=summary.closest('details') as HTMLDetailsElement
  details.open=true
  fireEvent(details,new Event('toggle',{bubbles:false}))
}

const sentItems=()=>(sendClientSubmission.mock.calls[0]![0] as {items:Array<Record<string,string>>}).items

function renderComposer(candidates:Array<{jobCandidateId:string;name:string}>){
  const onSent=vi.fn().mockResolvedValue(undefined)
  const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  render(<MemoryRouter><QueryClientProvider client={cache}><ToastProvider>
    <SubmissionComposerDrawer open onClose={vi.fn()} job={job} organizationId="org-1" candidates={candidates} onSent={onSent}/>
  </ToastProvider></QueryClientProvider></MemoryRouter>)
  return onSent
}

describe('SubmissionComposerDrawer',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    sendClientSubmission.mockResolvedValue({packageId:'pkg-1',expiresAt:'2026-08-01',deliveryStatus:'sent'})
    listContacts.mockResolvedValue([{id:'contact-1',company_id:'co-1',full_name:'Rani Prameswari',email:'rani@sembada.example',position:'HR Director',contact_status:'active'}])
    listSubmissionCandidateDocuments.mockResolvedValue([candidateRow('jc-1','Ana Chen'),candidateRow('jc-2','Budi Hartono')])
  })

  it('sends every candidate as one package with one link',async()=>{
    renderComposer([{jobCandidateId:'jc-1',name:'Ana Chen'},{jobCandidateId:'jc-2',name:'Budi Hartono'}])
    await waitFor(()=>expect(screen.getByLabelText('Recipient email')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Recipient email'),{target:{value:'rani@sembada.example'}})
    fireEvent.click(screen.getByRole('button',{name:'Send 2 candidates'}))

    await waitFor(()=>expect(sendClientSubmission).toHaveBeenCalledTimes(1))
    const payload=sendClientSubmission.mock.calls[0]![0] as {items:Array<Record<string,string>>;title:string}
    expect(payload.items).toHaveLength(2)
    expect(payload.items.map((item)=>item.job_candidate_id)).toEqual(['jc-1','jc-2'])
    // The title names what the client is about to open, rather than saying "Submission".
    expect(payload.title).toBe('2 candidates · Head of Brand')
  })

  /* Three inputs per candidate, not ten. Why-they-fit, relevant experience, motivation and
   * relocation were four free-text boxes restating the CV and the summary; salary, notice and
   * availability come from the candidate record and are shown read-only so the package cannot
   * disagree with the source. */
  it('offers only summary and comments, and shows the record facts read-only',async()=>{
    renderComposer([{jobCandidateId:'jc-1',name:'Ana Chen'}])
    await waitFor(()=>expect(screen.getByLabelText('Recipient email')).toBeInTheDocument())
    expandCandidate('Ana Chen')

    expect(screen.getByLabelText('Summary the client sees first')).toBeInTheDocument()
    expect(screen.getByLabelText('Your comments')).toBeInTheDocument()
    for(const gone of ['Why they fit','Relevant experience','What is motivating them','Relocation','Notice period','Expected salary']){
      expect(screen.queryByLabelText(gone)).toBeNull()
    }
    /* Seeded from the candidate record once the roster query resolves. Scoped to the facts list --
     * "30 days" is also one of the link-expiry options further down the drawer. */
    await waitFor(()=>expect(screen.getByText('45000000 IDR')).toBeInTheDocument())
    const facts=document.querySelector('.composer-facts') as HTMLElement
    expect(facts).toHaveTextContent('30 days')
    expect(facts).toHaveTextContent('Within 2 weeks')
    expect(screen.getByRole('link',{name:"Edit these on Ana Chen's record"})).toHaveAttribute('href','/app/sembada/candidates/cand-jc-1')

    fireEvent.change(screen.getByLabelText('Recipient email'),{target:{value:'rani@sembada.example'}})
    fireEvent.click(screen.getByRole('button',{name:'Send 1 candidate'}))
    await waitFor(()=>expect(sendClientSubmission).toHaveBeenCalled())
    expect(sentItems()[0]).not.toHaveProperty('suitability_assessment')
    expect(sentItems()[0]).not.toHaveProperty('motivation')
  })

  it('falls back to a generated summary rather than sending a blank heading',async()=>{
    renderComposer([{jobCandidateId:'jc-1',name:'Ana Chen'}])
    await waitFor(()=>expect(screen.getByLabelText('Recipient email')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Recipient email'),{target:{value:'rani@sembada.example'}})
    fireEvent.click(screen.getByRole('button',{name:'Send 1 candidate'}))
    await waitFor(()=>expect(sendClientSubmission).toHaveBeenCalled())
    expect(sentItems()[0]!.candidate_summary).toBe('Ana Chen — Brand Manager at Acme.')
  })

  it('opens the essential single-candidate pitch and sends existing terms without retyping them',async()=>{
    renderComposer([{jobCandidateId:'jc-1',name:'Ana Chen'}])
    await waitFor(()=>expect(screen.getByLabelText('Recipient email')).toBeInTheDocument())
    const candidateSection=screen.getByText('Ana Chen').closest('details') as HTMLDetailsElement
    expect(candidateSection.open).toBe(true)
    await waitFor(()=>expect(screen.getByLabelText('Summary the client sees first')).toHaveValue('Ana Chen — Brand Manager at Acme.'))

    fireEvent.change(screen.getByLabelText('Recipient email'),{target:{value:'rani@sembada.example'}})
    fireEvent.click(screen.getByRole('button',{name:'Send 1 candidate'}))
    await waitFor(()=>expect(sendClientSubmission).toHaveBeenCalled())
    expect(sentItems()[0]).toMatchObject({expected_salary:'45000000',currency:'IDR',notice_period:'30 days',availability:'Within 2 weeks'})
  })

  /* Consent is per candidate, so it has to gate per candidate. Silently dropping someone from a
   * shortlist would be worse than refusing: the consultant would believe they had been sent. */
  it('excludes a candidate without consent, names them, and still sends the rest',async()=>{
    listSubmissionCandidateDocuments.mockResolvedValue([candidateRow('jc-1','Ana Chen'),candidateRow('jc-2','Budi Hartono','unknown')])
    renderComposer([{jobCandidateId:'jc-1',name:'Ana Chen'},{jobCandidateId:'jc-2',name:'Budi Hartono'}])
    await waitFor(()=>expect(screen.getByText('1 candidate cannot be sent')).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Budi Hartono')

    fireEvent.change(screen.getByLabelText('Recipient email'),{target:{value:'rani@sembada.example'}})
    fireEvent.click(screen.getByRole('button',{name:'Send 1 candidate'}))
    await waitFor(()=>expect(sendClientSubmission).toHaveBeenCalled())
    expect(sentItems()).toHaveLength(1)
    expect(sentItems()[0]!.job_candidate_id).toBe('jc-1')
  })

  it('refuses to send when nobody in the package has consent',async()=>{
    listSubmissionCandidateDocuments.mockResolvedValue([candidateRow('jc-1','Ana Chen','withdrawn')])
    renderComposer([{jobCandidateId:'jc-1',name:'Ana Chen'}])
    await waitFor(()=>expect(screen.getByLabelText('Recipient email')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Recipient email'),{target:{value:'rani@sembada.example'}})
    expect(screen.getByRole('button',{name:'Send 0 candidates'})).toBeDisabled()
  })
})
