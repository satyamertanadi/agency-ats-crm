import {useState} from 'react'
import {fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {Modal} from './Modal'

/* Covers the two guarantees useDialogShell added over the hand-written focus effects it replaced:
 * Tab cannot leave the dialog, and a dirty dialog cannot be dismissed by accident. The pre-existing
 * focus-restore contract is covered by Drawer.test.tsx against the other consumer of the same hook. */

function Harness({dirty}:{dirty?:boolean}){
  const [open,setOpen]=useState(true)
  return <>
    <button>Behind the dialog</button>
    {open&&<Modal title="Add candidate" open={open} onClose={()=>setOpen(false)} dirty={dirty}>
      <input aria-label="Full name" defaultValue=""/>
      <button>Save candidate</button>
    </Modal>}
  </>
}

describe('useDialogShell',()=>{
  beforeEach(()=>{
    // The focus effect schedules initial focus through requestAnimationFrame; running it
    // synchronously keeps these tests off real frame timing.
    vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(0);return 0})
  })
  afterEach(()=>vi.unstubAllGlobals())

  it('sends the first Tab into the dialog rather than out to the page behind',()=>{
    render(<Harness/>)
    // The dialog container holds focus on open, so without the trap the browser would walk forward
    // from it into "Behind the dialog". The close button is the dialog's first focusable in DOM
    // order -- it sits in the header, ahead of the content.
    fireEvent.keyDown(document,{key:'Tab'})
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'Close dialog'}))
    expect(document.activeElement).not.toBe(screen.getByRole('button',{name:'Behind the dialog'}))
  })

  it('wraps from the last focusable back to the first',()=>{
    render(<Harness/>)
    screen.getByRole('button',{name:'Save candidate'}).focus()
    fireEvent.keyDown(document,{key:'Tab'})
    // Close is the first focusable in DOM order (it sits in the header, before the content).
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'Close dialog'}))
  })

  it('wraps backwards from the first focusable to the last',()=>{
    render(<Harness/>)
    screen.getByRole('button',{name:'Close dialog'}).focus()
    fireEvent.keyDown(document,{key:'Tab',shiftKey:true})
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'Save candidate'}))
  })

  it('closes on Escape when nothing is unsaved',()=>{
    render(<Harness/>)
    fireEvent.keyDown(document,{key:'Escape'})
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks before discarding when the dialog is dirty, and keeps the dialog open on Escape',()=>{
    render(<Harness dirty/>)
    fireEvent.keyDown(document,{key:'Escape'})
    expect(screen.getByRole('alertdialog',{name:'Discard unsaved changes'})).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('returns to the dialog when the discard prompt is declined',()=>{
    render(<Harness dirty/>)
    fireEvent.keyDown(document,{key:'Escape'})
    fireEvent.click(screen.getByRole('button',{name:'Keep editing'}))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes only once discarding is confirmed',()=>{
    render(<Harness dirty/>)
    fireEvent.keyDown(document,{key:'Escape'})
    fireEvent.click(screen.getByRole('button',{name:'Discard changes'}))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('guards a backdrop click the same way as Escape',()=>{
    const {container}=render(<Harness dirty/>)
    const backdrop=container.querySelector('.modal-backdrop')
    if(!backdrop)throw new Error('backdrop is required')
    fireEvent.mouseDown(backdrop)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
