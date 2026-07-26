import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {AddCandidateModal} from './AddCandidateModal'
import {ToastProvider} from '../../shared/ui/Toast'

/* vi.hoisted because vi.mock is lifted above the file's own declarations: the error class has to
 * exist by the time the factory runs, and it is declared here rather than imported so the component
 * and the test agree on the identity `instanceof` is checked against -- the component reads the class
 * off this same mocked module. */
const {DuplicateCandidateError,createCandidate,updateCandidateProfile}=vi.hoisted(()=>({
  DuplicateCandidateError:class DuplicateCandidateError extends Error {
    constructor(public readonly candidateId:string,public readonly candidateName:string){super(`${candidateName} already has this email address.`)}
  },
  createCandidate:vi.fn(),
  updateCandidateProfile:vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../core/repository',()=>({createCandidate,DuplicateCandidateError}))
vi.mock('../core/commercialRepository',()=>({
  updateCandidateProfile,
  addCandidateEmployment:vi.fn(),addCandidateEducation:vi.fn(),addCandidateLanguage:vi.fn(),addCandidateSkill:vi.fn(),
}))
// The parser owns an upload, a poll and a mutation of its own; none of that is what these tests are about.
vi.mock('./CandidateCvParser',()=>({CandidateCvParser:()=><div>CV upload</div>}))

const owners=[{id:'member-1',organization_id:'org-1',user_id:'user-1',job_title:null,status:'active' as const,is_vendor_support:false,
  profiles:{full_name:'Rani Prameswari',email:'rani@ravalli.local'},member_roles:[]}]

// `ownersReady:false` rather than passing defaultOwnerMemberId:undefined -- an explicit undefined
// argument still triggers a destructuring default, which quietly made this helper untestable.
function renderModal({ownersReady=true}={}){
  const defaultOwnerMemberId=ownersReady?'member-1':undefined
  const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  const onSaved=vi.fn()
  const ui=(ownerMemberId:string|undefined)=><QueryClientProvider client={cache}><ToastProvider><MemoryRouter>
    <AddCandidateModal open onClose={vi.fn()} organizationId="org-1" organizationSlug="ravalli" userId="user-1"
      baseCurrency="IDR" salaryPeriod="monthly" owners={owners} defaultOwnerMemberId={ownerMemberId} onSaved={onSaved}/>
  </MemoryRouter></ToastProvider></QueryClientProvider>
  const {rerender}=render(ui(defaultOwnerMemberId))
  fireEvent.click(screen.getByRole('radio',{name:'Manual'}))
  return {onSaved,ownersArrive:()=>rerender(ui('member-1'))}
}

function fillRequired(){
  fireEvent.change(screen.getByLabelText('Full name'),{target:{value:'Aisha Rahman'}})
  fireEvent.change(screen.getByLabelText('Email'),{target:{value:'aisha@example.com'}})
}

describe('AddCandidateModal',()=>{
  beforeEach(()=>{createCandidate.mockReset();createCandidate.mockResolvedValue('cand-1');updateCandidateProfile.mockClear()})

  /* The whole point of the shared form: these four fields had no input on the manual path, so every
   * hand-entered candidate arrived unassigned, consent 'unknown', and -- because salary_currency was
   * submitted without ever being rendered -- with its expected salary silently denominated wrong. */
  it('writes owner, status, consent and currency that manual entry could not previously set',async()=>{
    renderModal()
    fillRequired()
    fireEvent.change(screen.getByLabelText('Consent status'),{target:{value:'granted'}})
    fireEvent.change(screen.getByLabelText('Expected salary (per month)'),{target:{value:'42000000'}})
    fireEvent.click(screen.getByRole('button',{name:'Create candidate'}))
    await waitFor(()=>expect(createCandidate).toHaveBeenCalled())
    expect(createCandidate).toHaveBeenCalledWith('org-1','user-1',expect.objectContaining({
      full_name:'Aisha Rahman',email:'aisha@example.com',owner_member_id:'member-1',
      status:'active',consent_status:'granted',salary_currency:'IDR',expected_salary:42000000,
    }))
  },10000)

  /* The team list is a query. On the first open of a session the dialog wins the race, and seeding the
   * owner only at open time meant that candidate was created unassigned -- the defect this form is
   * here to fix, surviving in the one case nobody re-tests. */
  it('still defaults the owner when the team list resolves after the dialog is already open',async()=>{
    const {ownersArrive}=renderModal({ownersReady:false})
    expect((screen.getByLabelText('Owner') as HTMLSelectElement).value).toBe('')
    ownersArrive()
    await waitFor(()=>expect((screen.getByLabelText('Owner') as HTMLSelectElement).value).toBe('member-1'))

    fillRequired()
    fireEvent.click(screen.getByRole('button',{name:'Create candidate'}))
    await waitFor(()=>expect(createCandidate).toHaveBeenCalledWith('org-1','user-1',expect.objectContaining({owner_member_id:'member-1'})))
  },10000)

  it('offers the colliding record and saves onto it instead of refusing the duplicate',async()=>{
    createCandidate.mockRejectedValue(new DuplicateCandidateError('cand-9','Aisha Rahman'))
    renderModal()
    fillRequired()
    fireEvent.click(screen.getByRole('button',{name:'Create candidate'}))
    // Names the record rather than reporting an anonymous collision, and links straight to it.
    const link=await screen.findByRole('link',{name:'Open existing record'})
    expect(link).toHaveAttribute('href','/app/ravalli/candidates/cand-9')
    expect(screen.getByRole('status')).toHaveTextContent('Aisha Rahman already has this email address.')

    fireEvent.click(screen.getByRole('button',{name:'Save as update'}))
    await waitFor(()=>expect(updateCandidateProfile).toHaveBeenCalled())
    expect(updateCandidateProfile).toHaveBeenCalledWith('org-1','cand-9',
      expect.objectContaining({full_name:'Aisha Rahman'}),
      expect.objectContaining({email:'aisha@example.com'}))
  },10000)
})
