import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {JobRequirementsPanel} from './JobRequirementsPanel'

/* The rule this panel exists to enforce is that a model never authors the criteria a candidate is
 * scored against. Drafting proposes into local state and saving is a separate, explicit act -- so the
 * tests that matter are the ones asserting that drafting writes nothing, and that a re-draft cannot
 * delete a requirement the consultant typed themselves.
 */

const {listJobRequirements,listJobDescriptionDocuments,saveJobRequirements,draftJobRequirements,uploadJobDescription,success,error}=vi.hoisted(()=>({
  listJobRequirements:vi.fn(),listJobDescriptionDocuments:vi.fn(),saveJobRequirements:vi.fn(),
  draftJobRequirements:vi.fn(),uploadJobDescription:vi.fn(),success:vi.fn(),error:vi.fn(),
}))
vi.mock('../core/commercialRepository',()=>({listJobRequirements,listJobDescriptionDocuments,saveJobRequirements,draftJobRequirements,uploadJobDescription}))
vi.mock('../../shared/ui/Toast',()=>({useToast:()=>({success,error,info:vi.fn()})}))

const requirement=(label:string,overrides={})=>({
  id:'11111111-1111-1111-1111-111111111111',label,requirement_level:'nice_to_have' as const,
  category:'skill' as const,weight:1,evidence_expected:null,source:'manual' as const,...overrides,
})

/* Draft stays disabled until the attachment list has loaded, so that a click cannot silently draft
 * from the job fields while ignoring an attached JD. Every drafting test goes through here. */
async function clickDraft(){
  const button=await screen.findByRole('button',{name:/Draft from JD/i})
  await waitFor(()=>expect(button).toBeEnabled())
  fireEvent.click(button)
}

function renderPanel(canWrite=true){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}>
    <JobRequirementsPanel organizationId="org-1" jobId="job-1" userId="user-1" canWrite={canWrite}/>
  </QueryClientProvider>)
}

describe('JobRequirementsPanel',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    listJobRequirements.mockResolvedValue([])
    listJobDescriptionDocuments.mockResolvedValue([])
    saveJobRequirements.mockResolvedValue(1)
    draftJobRequirements.mockResolvedValue([])
    uploadJobDescription.mockResolvedValue({id:'doc-1',file_name:'jd.pdf',mime_type:'application/pdf',storage_path:'p'})
  })

  /* An empty set is not a neutral state: it silently changes how the candidate assessment is scored,
   * so the panel has to say so rather than just showing nothing. */
  it('names the consequence of having no requirements',async()=>{
    renderPanel()
    expect(await screen.findByText(/fall back to the job description/i)).toBeInTheDocument()
  })

  it('loads and lists the saved set',async()=>{
    listJobRequirements.mockResolvedValue([requirement('10+ years commercial leadership',{requirement_level:'must_have'})])
    renderPanel()
    expect(await screen.findByDisplayValue('10+ years commercial leadership')).toBeInTheDocument()
    expect(screen.getByText(/1 requirement, 1 must-have/)).toBeInTheDocument()
  })

  it('marks the set unsaved as soon as it is edited, and saves only when asked',async()=>{
    listJobRequirements.mockResolvedValue([requirement('Energy sector experience')])
    renderPanel()
    const input=await screen.findByDisplayValue('Energy sector experience')
    fireEvent.change(input,{target:{value:'Renewable energy sector experience'}})

    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument()
    expect(saveJobRequirements).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button',{name:'Save requirements'}))
    await waitFor(()=>expect(saveJobRequirements).toHaveBeenCalledWith('org-1','job-1',[
      expect.objectContaining({label:'Renewable energy sector experience'}),
    ]))
  })

  /* The central guarantee. A drafted set is a proposal sitting in local state; nothing reaches the
   * database until the recruiter presses Save. */
  it('never writes what the model drafted',async()=>{
    draftJobRequirements.mockResolvedValue([requirement('Regional team leadership',{id:undefined,source:'ai_draft'})])
    renderPanel()
    await clickDraft()

    expect(await screen.findByDisplayValue('Regional team leadership')).toBeInTheDocument()
    expect(saveJobRequirements).not.toHaveBeenCalled()
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument()
  })

  /* Re-drafting after editing the description is normal. Replacing the list would delete the
   * requirements a consultant took off a phone call -- exactly what the JD does not contain. */
  it('keeps the recruiter’s own requirements when a draft is merged in',async()=>{
    listJobRequirements.mockResolvedValue([requirement('Willing to relocate to Lombok')])
    draftJobRequirements.mockResolvedValue([
      requirement('Willing to relocate to Lombok',{id:undefined,source:'ai_draft'}),
      requirement('Regional team leadership',{id:undefined,source:'ai_draft'}),
    ])
    renderPanel()
    await screen.findByDisplayValue('Willing to relocate to Lombok')
    await clickDraft()

    await screen.findByDisplayValue('Regional team leadership')
    expect(screen.getByDisplayValue('Willing to relocate to Lombok')).toBeInTheDocument()
    // Reported honestly: one genuinely new, one already listed.
    await waitFor(()=>expect(success).toHaveBeenCalledWith(expect.stringContaining('1 requirement proposed, 1 already listed')))
  })

  it('says so plainly when a draft adds nothing new',async()=>{
    listJobRequirements.mockResolvedValue([requirement('Energy sector experience')])
    draftJobRequirements.mockResolvedValue([requirement('Energy sector experience',{id:undefined,source:'ai_draft'})])
    renderPanel()
    await screen.findByDisplayValue('Energy sector experience')
    await clickDraft()
    await waitFor(()=>expect(success).toHaveBeenCalledWith(expect.stringContaining('Nothing new')))
  })

  it('passes the attached JD to the drafter when there is one',async()=>{
    listJobDescriptionDocuments.mockResolvedValue([{id:'doc-9',file_name:'brief.pdf',mime_type:'application/pdf',storage_path:'p',created_at:'2026-08-01T00:00:00Z'}])
    renderPanel()
    // Waiting for the filename is the point: the button stays disabled until the attachment list has
    // loaded, so a click before then cannot draft from the job fields alone.
    expect(await screen.findByText('brief.pdf')).toBeInTheDocument()
    await clickDraft()
    await waitFor(()=>expect(draftJobRequirements).toHaveBeenCalledWith('org-1','job-1','doc-9'))
  })

  it('adds and removes rows',async()=>{
    renderPanel()
    fireEvent.click(await screen.findByRole('button',{name:'Add requirement'}))
    expect(await screen.findByLabelText('Requirement 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Remove requirement 1'}))
    await waitFor(()=>expect(screen.queryByLabelText('Requirement 1')).not.toBeInTheDocument())
  })

  it('reorders a row without losing the others',async()=>{
    listJobRequirements.mockResolvedValue([requirement('First',{id:'a'}),requirement('Second',{id:'b'})])
    renderPanel()
    await screen.findByDisplayValue('First')
    fireEvent.click(screen.getByRole('button',{name:'Move requirement 2 up'}))
    await waitFor(()=>{
      const labels=screen.getAllByRole('textbox').map((input)=>(input as HTMLInputElement).value)
      expect(labels).toEqual(['Second','First'])
    })
  })

  it('shows a read-only member the set but no way to change it',async()=>{
    listJobRequirements.mockResolvedValue([requirement('Energy sector experience')])
    renderPanel(false)
    expect(await screen.findByDisplayValue('Energy sector experience')).toBeDisabled()
    expect(screen.queryByRole('button',{name:'Save requirements'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Add requirement'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:/Draft from JD/i})).not.toBeInTheDocument()
  })

  it('reports a failed save and keeps the edit on screen',async()=>{
    saveJobRequirements.mockRejectedValue(new Error('This requirement is already listed.'))
    listJobRequirements.mockResolvedValue([requirement('Energy sector experience')])
    renderPanel()
    await screen.findByDisplayValue('Energy sector experience')
    fireEvent.change(screen.getByDisplayValue('Energy sector experience'),{target:{value:'Renewables experience'}})
    fireEvent.click(screen.getByRole('button',{name:'Save requirements'}))
    await waitFor(()=>expect(error).toHaveBeenCalled())
    expect(screen.getByDisplayValue('Renewables experience')).toBeInTheDocument()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })
})
