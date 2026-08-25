import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {CandidateQualityStrip} from './CandidateQualityStrip'
import type {CandidateListFilters} from '../core/repository'

/* The counts and the filter are one control, and these tests are mostly about that: pressing a count
 * applies it, pressing it again clears it, and the counts themselves never move as a result. */

const {candidateQualitySummary}=vi.hoisted(()=>({candidateQualitySummary:vi.fn()}))
vi.mock('../core/repository',()=>({candidateQualitySummary}))

const summary=[
  {issue_code:'missing_cv',candidate_count:12},
  {issue_code:'missing_skills',candidate_count:30},
]

function renderStrip({issue=null,filters={},onIssue=vi.fn()}:{
  issue?:string|null;filters?:CandidateListFilters;onIssue?:(next:string|null)=>void
}={}){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  const result=render(<QueryClientProvider client={client}>
    <CandidateQualityStrip organizationId="org-1" filters={filters} issue={issue} onIssue={onIssue}/>
  </QueryClientProvider>)
  return {onIssue,...result}
}

describe('CandidateQualityStrip',()=>{
  beforeEach(()=>{vi.clearAllMocks();candidateQualitySummary.mockResolvedValue(summary)})

  it('names every issue with its count, in definition order',async()=>{
    renderStrip()
    expect(await screen.findByRole('button',{name:/No CV/})).toBeInTheDocument()
    const labels=screen.getAllByRole('button').map((button)=>button.textContent)
    expect(labels[0]).toBe('All issues')
    // Definition order, not count order: a control whose buttons move is one people stop aiming at.
    expect(labels.slice(1)).toEqual(['No current role 0','No location 0','No skills tagged 30','No CV 12','No way to reach them 0'])
  })

  /* Renders nothing at all rather than a row of zeroes or an error banner. This refines a queue that
   * is already on screen and usable without it; a failed count must leave the queue exactly as it was
   * before the strip existed. */
  it('stays out of the way while loading and when the count fails',async()=>{
    candidateQualitySummary.mockImplementation(()=>new Promise(()=>{/* never settles */}))
    const {container,unmount}=renderStrip()
    expect(container.firstChild).toBeNull()
    unmount()

    candidateQualitySummary.mockRejectedValue(new Error('Could not count data-quality issues'))
    const failed=renderStrip()
    await waitFor(()=>expect(candidateQualitySummary).toHaveBeenCalledTimes(2))
    expect(failed.container.firstChild).toBeNull()
  })

  it('applies an issue when its count is pressed',async()=>{
    const {onIssue}=renderStrip()
    fireEvent.click(await screen.findByRole('button',{name:/No CV/}))
    expect(onIssue).toHaveBeenCalledWith('missing_cv')
  })

  /* Pressing the choice you already made clears it. The alternative -- a press that does nothing --
   * leaves All issues as the only way out, which people find by accident rather than by aiming. */
  it('clears the issue when the same count is pressed again',async()=>{
    const {onIssue}=renderStrip({issue:'missing_cv'})
    fireEvent.click(await screen.findByRole('button',{name:/No CV/}))
    expect(onIssue).toHaveBeenCalledWith(null)
  })

  it('clears through All issues',async()=>{
    const {onIssue}=renderStrip({issue:'missing_cv'})
    fireEvent.click(await screen.findByRole('button',{name:'All issues'}))
    expect(onIssue).toHaveBeenCalledWith(null)
  })

  it('marks exactly one button as the current choice',async()=>{
    renderStrip({issue:'missing_skills'})
    const chosen=await screen.findByRole('button',{name:/No skills tagged/})
    expect(chosen).toHaveAttribute('aria-pressed','true')
    expect(screen.getByRole('button',{name:'All issues'})).toHaveAttribute('aria-pressed','false')
  })

  /* Zero is shown, not hidden -- "No CV (0)" is a useful thing to learn about a talent database --
   * but it cannot be pressed, because that would produce an empty list looking like a broken filter. */
  it('shows a zero count and refuses to filter on it',async()=>{
    renderStrip()
    const empty=await screen.findByRole('button',{name:/No location/})
    expect(empty).toHaveTextContent('0')
    expect(empty).toBeDisabled()
  })

  /* The one exception: a filter already applied stays pressable even at zero, or the only way out of
   * an empty result would be the All button the user cannot see the point of yet. */
  it('keeps the active issue pressable even when its count is zero',async()=>{
    renderStrip({issue:'missing_location'})
    const active=await screen.findByRole('button',{name:/No location/})
    expect(active).not.toBeDisabled()
  })

  /* The counts are taken WITHOUT the issue filter, and the query key must not include it either --
   * a strip that refetched every time you pressed one of its own buttons would read as the numbers
   * being recalculated against the choice. */
  it('never sends the issue to the count, and does not refetch when it changes',async()=>{
    const {rerender}=render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
      <CandidateQualityStrip organizationId="org-1" filters={{queue:'needs_enrichment',issue:'missing_cv',query:'ana'}}
        issue="missing_cv" onIssue={vi.fn()}/>
    </QueryClientProvider>)
    await screen.findByRole('button',{name:/No CV/})
    expect(candidateQualitySummary).toHaveBeenCalledTimes(1)
    const sent=candidateQualitySummary.mock.calls[0]?.[1]
    expect(sent).not.toHaveProperty('issue')
    expect(sent).not.toHaveProperty('queue')
    expect(sent).toMatchObject({query:'ana'})

    rerender(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
      <CandidateQualityStrip organizationId="org-1" filters={{queue:'needs_enrichment',issue:'missing_skills',query:'ana'}}
        issue="missing_skills" onIssue={vi.fn()}/>
    </QueryClientProvider>)
    await waitFor(()=>expect(screen.getByRole('button',{name:/No skills tagged/})).toHaveAttribute('aria-pressed','true'))
    expect(candidateQualitySummary).toHaveBeenCalledTimes(1)
  })

  it('recounts when a shared filter changes',async()=>{
    const {rerender}=render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
      <CandidateQualityStrip organizationId="org-1" filters={{query:'ana'}} issue={null} onIssue={vi.fn()}/>
    </QueryClientProvider>)
    await screen.findByRole('button',{name:/No CV/})
    rerender(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
      <CandidateQualityStrip organizationId="org-1" filters={{query:'budi'}} issue={null} onIssue={vi.fn()}/>
    </QueryClientProvider>)
    await waitFor(()=>expect(candidateQualitySummary).toHaveBeenCalledTimes(2))
    expect(candidateQualitySummary.mock.calls[1]?.[1]).toMatchObject({query:'budi'})
  })

  /* A rule the server gained before this build knows about it is appended rather than dropped -- a
   * missing button is a count the reader cannot reconcile with the list they are looking at. */
  it('shows a code it has never heard of rather than losing its count',async()=>{
    candidateQualitySummary.mockResolvedValue([...summary,{issue_code:'missing_visa',candidate_count:4}])
    renderStrip()
    const unknown=await screen.findByRole('button',{name:/missing_visa/})
    expect(unknown).toHaveTextContent('4')
    // Appended, never interleaved with the known ones.
    const labels=screen.getAllByRole('button').map((button)=>button.textContent)
    expect(labels[labels.length-1]).toBe('missing_visa 4')
  })
})
