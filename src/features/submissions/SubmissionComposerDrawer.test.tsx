import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {SubmissionComposerDrawer} from './SubmissionComposerDrawer'
import {ToastProvider} from '../../shared/ui/Toast'
import type {Job} from '../../shared/types/domain'

/* create_submission_package has taken a jsonb ARRAY since the initial schema and the UI sent exactly
 * one candidate, so putting three people in front of a client meant three packages, three emails and
 * three links. These pin the two things that makes true: that N candidates leave as ONE package, and
 * that the nine long-dead candidate_submissions columns are actually written. */

const {sendClientSubmission,listSubmissionCandidateDocuments,listContacts}=vi.hoisted(()=>({
  sendClientSubmission:vi.fn(),listSubmissionCandidateDocuments:vi.fn(),listContacts:vi.fn(),
}))
vi.mock('../core/commercialRepository',()=>({sendClientSubmission,listSubmissionCandidateDocuments}))
vi.mock('../core/repository',()=>({listContacts}))

const job={id:'job-1',title:'Head of Brand',company_id:'co-1',currency:'IDR',status:'open',
  companies:{id:'co-1',name:'Sembada Pangan'}} as Job

const candidateRow=(id:string,name:string,consent='granted',status='active')=>({
  id,candidate_id:`cand-${id}`,
  candidates:{id:`cand-${id}`,full_name:name,current_company:'Acme',current_position:'Brand Manager',status,
    candidate_private_details:{consent_status:consent},
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
  render(<QueryClientProvider client={cache}><ToastProvider>
    <SubmissionComposerDrawer open onClose={vi.fn()} job={job} organizationId="org-1" candidates={candidates} onSent={onSent}/>
  </ToastProvider></QueryClientProvider>)
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

  it('writes the pitch columns that nothing has ever written',async()=>{
    renderComposer([{jobCandidateId:'jc-1',name:'Ana Chen'}])
    await waitFor(()=>expect(screen.getByLabelText('Recipient email')).toBeInTheDocument())
    // Each candidate is a disclosure, so the pitch fields only exist once it is opened.
    expandCandidate('Ana Chen')
    fireEvent.change(screen.getByLabelText('Why they fit'),{target:{value:'Ran the exact rebrand this role needs'}})
    fireEvent.change(screen.getByLabelText('Notice period'),{target:{value:'One month'}})
    fireEvent.change(screen.getByLabelText('Recipient email'),{target:{value:'rani@sembada.example'}})
    fireEvent.click(screen.getByRole('button',{name:'Send 1 candidate'}))

    await waitFor(()=>expect(sendClientSubmission).toHaveBeenCalled())
    expect(sentItems()[0]).toMatchObject({
      suitability_assessment:'Ran the exact rebrand this role needs',notice_period:'One month',
    })
  })

  it('falls back to a generated summary rather than sending a blank heading',async()=>{
    renderComposer([{jobCandidateId:'jc-1',name:'Ana Chen'}])
    await waitFor(()=>expect(screen.getByLabelText('Recipient email')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Recipient email'),{target:{value:'rani@sembada.example'}})
    fireEvent.click(screen.getByRole('button',{name:'Send 1 candidate'}))
    await waitFor(()=>expect(sendClientSubmission).toHaveBeenCalled())
    expect(sentItems()[0]!.candidate_summary).toBe('Ana Chen — Brand Manager at Acme.')
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
