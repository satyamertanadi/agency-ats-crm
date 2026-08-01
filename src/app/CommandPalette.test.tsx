import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {CommandPalette} from './CommandPalette'

const {searchWorkspace,navigate}=vi.hoisted(()=>({searchWorkspace:vi.fn(),navigate:vi.fn()}))
vi.mock('../features/core/repository',()=>({searchWorkspace}))
vi.mock('react-router',async()=>({...await vi.importActual<typeof import('react-router')>('react-router'),useNavigate:()=>navigate}))

const onClose=vi.fn()
function renderPalette(){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><MemoryRouter><CommandPalette open onClose={onClose} organizationId="org-1" organizationSlug="northstar"/></MemoryRouter></QueryClientProvider>)
  return screen.getByLabelText('Search workspace')
}
const selected=()=>document.querySelector('[aria-selected="true"]')?.textContent

describe('CommandPalette keyboard navigation',()=>{
  beforeEach(()=>{vi.clearAllMocks();searchWorkspace.mockResolvedValue([])})

  it('advertises the keys it actually supports',()=>{
    renderPalette()
    expect(screen.getByText('Browse').textContent).toContain('↑')
    expect(screen.getByText('Browse').textContent).not.toContain('Tab')
  })

  it('selects the first option so Enter always has a target',()=>{
    renderPalette()
    expect(selected()).toContain('Add candidate')
  })

  it('moves the selection with the arrow keys',()=>{
    const input=renderPalette()
    fireEvent.keyDown(input,{key:'ArrowDown'})
    expect(selected()).toContain('Add client')
    fireEvent.keyDown(input,{key:'ArrowUp'})
    expect(selected()).toContain('Add candidate')
  })

  it('wraps around at both ends rather than dead-ending',()=>{
    const input=renderPalette()
    fireEvent.keyDown(input,{key:'ArrowUp'})
    expect(selected()).toContain('Open my settings')
    fireEvent.keyDown(input,{key:'ArrowDown'})
    expect(selected()).toContain('Add candidate')
  })

  it('opens the selected option on Enter',()=>{
    const input=renderPalette()
    fireEvent.keyDown(input,{key:'ArrowDown'})
    fireEvent.keyDown(input,{key:'Enter'})
    expect(navigate).toHaveBeenCalledWith('/app/northstar/clients?new=1')
    expect(onClose).toHaveBeenCalled()
  })

  // Actions carry ?new=1 so the destination opens its create form rather than just listing records.
  it('starts an action instead of only navigating to its page',()=>{
    const input=renderPalette()
    fireEvent.keyDown(input,{key:'Enter'})
    expect(navigate).toHaveBeenCalledWith('/app/northstar/candidates?new=1')
  })

  it('exposes the active option to assistive technology',()=>{
    const input=renderPalette()
    expect(input).toHaveAttribute('role','combobox')
    expect(input).toHaveAttribute('aria-activedescendant','command-option-0')
    fireEvent.keyDown(input,{key:'ArrowDown'})
    expect(input).toHaveAttribute('aria-activedescendant','command-option-1')
  })

  it('keeps the selection inside the list when results narrow it',async()=>{
    const input=renderPalette()
    fireEvent.keyDown(input,{key:'End'})
    fireEvent.change(input,{target:{value:'settings'}})
    // Only "Open my settings" survives the filter; the old End index would point past the list.
    await waitFor(()=>expect(selected()).toContain('Open my settings'))
    fireEvent.keyDown(input,{key:'Enter'})
    expect(navigate).toHaveBeenCalledWith('/app/northstar/admin/personal')
  })

  it('puts workspace results above the built-in commands',async()=>{
    searchWorkspace.mockResolvedValue([{entity_type:'candidate',entity_id:'c1',title:'Ada Lovelace',subtitle:'Engineer',rank:1}])
    const input=renderPalette()
    fireEvent.change(input,{target:{value:'ada'}})
    await waitFor(()=>expect(selected()).toContain('Ada Lovelace'))
    fireEvent.keyDown(input,{key:'Enter'})
    expect(navigate).toHaveBeenCalledWith('/app/northstar/candidates/c1')
  })
})
