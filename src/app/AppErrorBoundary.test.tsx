import {render,screen} from '@testing-library/react'
import {describe,expect,it,vi} from 'vitest'
import {AppErrorBoundary} from './AppErrorBoundary'

const {captureError}=vi.hoisted(()=>({captureError:vi.fn()}))
vi.mock('../shared/lib/observability',()=>({captureError}))

function Broken({fail}:{fail:boolean}){if(fail)throw new Error('render exploded');return <p>Recovered workspace</p>}

describe('AppErrorBoundary',()=>{
  it('replaces a render failure with recovery actions and an error reference',()=>{
    render(<AppErrorBoundary context={{workspaceSlug:'northstar',route:'/app/northstar/admin/finance'}}><Broken fail/></AppErrorBoundary>)
    expect(screen.getByRole('heading',{name:'This view could not be opened'})).toBeInTheDocument()
    expect(screen.getByText(/^ATS-/)).toBeInTheDocument()
    expect(screen.getByRole('link',{name:'Return to Today'})).toHaveAttribute('href','/app/northstar/today')
    expect(captureError).toHaveBeenCalledWith(expect.any(Error),expect.objectContaining({area:'render_boundary',route:'/app/northstar/admin/finance'}))
  })

  it('resets after navigation changes the boundary key',()=>{
    const view=render(<AppErrorBoundary resetKey="finance"><Broken fail/></AppErrorBoundary>)
    expect(screen.getByRole('heading',{name:'This view could not be opened'})).toBeInTheDocument()
    view.rerender(<AppErrorBoundary resetKey="today"><Broken fail={false}/></AppErrorBoundary>)
    expect(screen.getByText('Recovered workspace')).toBeInTheDocument()
  })
})
