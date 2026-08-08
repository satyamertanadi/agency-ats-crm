import {useState} from 'react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {LocationField} from './LocationField'

/* Session-token lifecycle is the part of this component that reads fine and is wrong: Combobox
 * exposes one onChange for both "typed a character" and "picked a suggestion," so LocationField has
 * to infer which one happened from the value alone (see the comment in LocationField.tsx). These pin
 * the three promised behaviours -- one token per search, reused across keystrokes, discarded on a
 * real selection -- against that inference rather than trusting it by construction. */

const {searchLocations}=vi.hoisted(()=>({searchLocations:vi.fn()}))
vi.mock('../../features/core/commercialRepository',()=>({searchLocations}))

function Harness(){
  const [value,setValue]=useState('')
  return <LocationField value={value} onChange={setValue}/>
}

function renderField(){
  const cache=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={cache}><Harness/></QueryClientProvider>)
}

const tokensUsed=()=>searchLocations.mock.calls.map((call)=>call[1] as string)

describe('LocationField',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    searchLocations.mockResolvedValue({suggestions:[
      {id:'place-jkt',label:'Jakarta, Indonesia'},
      {id:'place-jkb',label:'Jakarta Barat, Jakarta, Indonesia'},
    ]})
  })

  it('mints a session token on the first keystroke of a search',async()=>{
    renderField()
    fireEvent.change(screen.getByRole('combobox'),{target:{value:'Jak'}})
    await waitFor(()=>expect(searchLocations).toHaveBeenCalledTimes(1))
    expect(searchLocations).toHaveBeenCalledWith('Jak',expect.any(String))
    expect(tokensUsed()[0]).toBeTruthy()
  })

  it('reuses the same session token across keystrokes of one search',async()=>{
    renderField()
    const input=screen.getByRole('combobox')
    fireEvent.change(input,{target:{value:'Jak'}})
    await waitFor(()=>expect(searchLocations).toHaveBeenCalledTimes(1))
    fireEvent.change(input,{target:{value:'Jaka'}})
    await waitFor(()=>expect(searchLocations).toHaveBeenCalledTimes(2))
    const [first,second]=tokensUsed()
    expect(second).toBe(first)
  })

  it('mints a fresh token for the next search after a selection, and does not re-search the selected value itself',async()=>{
    renderField()
    const input=screen.getByRole('combobox')
    fireEvent.change(input,{target:{value:'Jak'}})
    await screen.findByText('Jakarta, Indonesia')
    const firstToken=tokensUsed()[0]

    fireEvent.keyDown(input,{key:'ArrowDown'})
    fireEvent.keyDown(input,{key:'Enter'})
    expect(input).toHaveValue('Jakarta, Indonesia')

    // The debounce window passes with nothing further typed. If the component treated the freshly
    // selected value as a new search, this is exactly when that redundant call would land.
    await new Promise((resolve)=>setTimeout(resolve,400))
    expect(searchLocations).toHaveBeenCalledTimes(1)

    fireEvent.change(input,{target:{value:'Jakarta, Indonesia Sel'}})
    await waitFor(()=>expect(searchLocations).toHaveBeenCalledTimes(2))
    expect(tokensUsed()[1]).not.toBe(firstToken)
  },10000)

  it('keeps a typed value even when the search fails, rather than becoming unusable',async()=>{
    searchLocations.mockRejectedValue(new Error('places_not_configured'))
    renderField()
    const input=screen.getByRole('combobox')
    fireEvent.change(input,{target:{value:'Somewhere unresolvable'}})
    await waitFor(()=>expect(searchLocations).toHaveBeenCalled())
    expect(input).toHaveValue('Somewhere unresolvable')
    // No suggestions, but "No matches" -- not a crash and not a blocked input.
    expect(await screen.findByText('No matches')).toBeInTheDocument()
  })

  it('does not search below the two-character floor the endpoint itself enforces',async()=>{
    renderField()
    fireEvent.change(screen.getByRole('combobox'),{target:{value:'J'}})
    await new Promise((resolve)=>setTimeout(resolve,400))
    expect(searchLocations).not.toHaveBeenCalled()
  })
})
