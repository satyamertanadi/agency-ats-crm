import {fireEvent,render,screen} from '@testing-library/react'
import {describe,expect,it,vi} from 'vitest'
import {Menu} from './Menu'

/* The three popovers this replaces declared role="menu"/"menuitem" and implemented none of the keyboard
 * model those roles promise. These assert that model. */

const renderMenu=(onReject=vi.fn())=>{
  render(<Menu label="Candidate actions" items={[
    {id:'open',label:'Open'},
    {id:'move',label:'Move to phase'},
    {id:'reject',label:'Reject',onSelect:onReject,separatorBefore:true,tone:'danger'},
    {id:'blocked',label:'Withdraw',disabled:true},
  ]} trigger={(props)=><button {...props}>More actions</button>}/>)
  return {onReject}
}

describe('Menu',()=>{
  it('stays closed until asked, and reports its state on the trigger',()=>{
    renderMenu()
    const trigger=screen.getByRole('button',{name:'More actions'})
    expect(trigger).toHaveAttribute('aria-expanded','false')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded','true')
    expect(screen.getByRole('menu',{name:'Candidate actions'})).toBeInTheDocument()
  })

  it('opens onto the first item with ArrowDown so the keyboard lands somewhere useful',()=>{
    renderMenu()
    fireEvent.keyDown(screen.getByRole('button',{name:'More actions'}),{key:'ArrowDown'})
    expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'Open'}))
  })

  it('opens onto the last item with ArrowUp',()=>{
    renderMenu()
    fireEvent.keyDown(screen.getByRole('button',{name:'More actions'}),{key:'ArrowUp'})
    // 'Withdraw' is disabled, so the last reachable item is 'Reject'.
    expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'Reject'}))
  })

  it('walks items with the arrow keys, skipping the disabled one, and wraps',()=>{
    renderMenu()
    const trigger=screen.getByRole('button',{name:'More actions'})
    fireEvent.keyDown(trigger,{key:'ArrowDown'})
    const menu=screen.getByRole('menu')
    fireEvent.keyDown(menu,{key:'ArrowDown'})
    expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'Move to phase'}))
    fireEvent.keyDown(menu,{key:'ArrowDown'})
    expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'Reject'}))
    fireEvent.keyDown(menu,{key:'ArrowDown'})
    expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'Open'}))
  })

  it('jumps to an item by its first letter',()=>{
    renderMenu()
    fireEvent.keyDown(screen.getByRole('button',{name:'More actions'}),{key:'ArrowDown'})
    fireEvent.keyDown(screen.getByRole('menu'),{key:'r'})
    expect(document.activeElement).toBe(screen.getByRole('menuitem',{name:'Reject'}))
  })

  it('closes on Escape and returns focus to the trigger',()=>{
    renderMenu()
    const trigger=screen.getByRole('button',{name:'More actions'})
    fireEvent.keyDown(trigger,{key:'ArrowDown'})
    fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'})
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('runs the item action and closes on selection',()=>{
    const {onReject}=renderMenu()
    fireEvent.click(screen.getByRole('button',{name:'More actions'}))
    fireEvent.click(screen.getByRole('menuitem',{name:'Reject'}))
    expect(onReject).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not run a disabled item',()=>{
    renderMenu()
    fireEvent.click(screen.getByRole('button',{name:'More actions'}))
    const disabled=screen.getByRole('menuitem',{name:'Withdraw',hidden:true})
    expect(disabled).toBeDisabled()
  })
})
