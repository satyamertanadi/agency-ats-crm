import {act,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {ToastProvider,useToast} from './Toast'

function Harness({onReady}:{onReady?:(toast:ReturnType<typeof useToast>)=>void}){
  const toast=useToast()
  return <button onClick={()=>onReady?.(toast)}>fire</button>
}

const fire=(action:(toast:ReturnType<typeof useToast>)=>void)=>{
  render(<ToastProvider><Harness onReady={action}/></ToastProvider>)
  fireEvent.click(screen.getByRole('button',{name:'fire'}))
}

describe('ToastProvider',()=>{
  beforeEach(()=>vi.useFakeTimers())
  afterEach(()=>vi.useRealTimers())

  it('announces a confirmation politely and retires it on its own',()=>{
    fire((toast)=>toast.success('Ayu was added to Senior Project Manager.'))
    const live=screen.getByText('Ayu was added to Senior Project Manager.').closest('[aria-live]')
    expect(live).toHaveAttribute('aria-live','polite')
    act(()=>{vi.advanceTimersByTime(4000)})
    expect(screen.queryByText('Ayu was added to Senior Project Manager.')).not.toBeInTheDocument()
  })

  it('gives a failure an assertive region and states the recovery that already happened',()=>{
    fire((toast)=>toast.error(new Error('Could not move candidate'),'The card was returned to Screening.'))
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live','assertive')
    expect(screen.getByText('The card was returned to Screening.')).toBeInTheDocument()
    // Errors outlive confirmations: they have to be read, not just noticed.
    act(()=>{vi.advanceTimersByTime(4000)})
    expect(screen.getByText('Could not move candidate')).toBeInTheDocument()
  })

  /* A bulk action fires one mutation per row. Without this, tagging ten candidates stacked ten
   * identical lines and pushed everything else off screen. */
  it('refreshes an identical live toast instead of stacking duplicates',()=>{
    fire((toast)=>{toast.success('Candidate updated.');toast.success('Candidate updated.');toast.success('Candidate updated.')})
    expect(screen.getAllByText('Candidate updated.')).toHaveLength(1)
  })

  it('keeps an error with a recovery action on screen until it is dealt with',()=>{
    const retry=vi.fn()
    fire((toast)=>toast.error(new Error('Save failed'),undefined,{label:'Try again',onClick:retry}))
    act(()=>{vi.advanceTimersByTime(60000)})
    expect(screen.getByText('Save failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Try again'}))
    expect(retry).toHaveBeenCalled()
    // Acting on it is what dismisses it -- leaving it up after the retry would misreport the state.
    expect(screen.queryByText('Save failed')).not.toBeInTheDocument()
  })

  it('caps the stack so the newest is never the one hidden',()=>{
    fire((toast)=>{for(let index=1;index<=6;index+=1)toast.success(`Update ${index}`)})
    expect(screen.queryByText('Update 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Update 2')).not.toBeInTheDocument()
    expect(screen.getByText('Update 6')).toBeInTheDocument()
  })

  it('can be dismissed by hand',()=>{
    fire((toast)=>toast.info('Import is still processing.'))
    fireEvent.click(screen.getByRole('button',{name:'Dismiss: Import is still processing.'}))
    expect(screen.queryByText('Import is still processing.')).not.toBeInTheDocument()
  })
})
