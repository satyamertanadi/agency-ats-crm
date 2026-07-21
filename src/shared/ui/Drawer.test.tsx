import {useState} from 'react'
import {fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {Drawer} from './Drawer'

// A controlled input inside the drawer re-renders its parent on every keystroke, which recreates
// the inline onClose arrow below on every render -- exactly the shape every real caller uses.
function Harness(){
  const [open,setOpen]=useState(true)
  const [name,setName]=useState('')
  return <Drawer title="Add client" open={open} onClose={()=>setOpen(false)}>
    <input aria-label="Client name" value={name} onChange={(event)=>setName(event.target.value)}/>
  </Drawer>
}

describe('Drawer',()=>{
  beforeEach(()=>{
    // The focus-management effect schedules its initial focus via requestAnimationFrame; running
    // it synchronously keeps this test deterministic instead of racing real animation-frame timing.
    vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(0);return 0})
  })
  afterEach(()=>vi.unstubAllGlobals())

  it('keeps focus on a controlled input while typing, even though onClose is a new closure every render',()=>{
    render(<Harness/>)
    const input=screen.getByLabelText('Client name')
    input.focus()
    expect(document.activeElement).toBe(input)
    fireEvent.change(input,{target:{value:'A'}})
    fireEvent.change(input,{target:{value:'Ay'}})
    fireEvent.change(input,{target:{value:'Ayu'}})
    expect(input).toHaveValue('Ayu')
    expect(document.activeElement).toBe(input)
  })
})
