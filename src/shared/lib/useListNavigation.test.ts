import {describe,expect,it,vi} from 'vitest'
import {act,renderHook} from '@testing-library/react'
import {useListNavigation} from './useListNavigation'
import {isFormField,isTypingTarget} from './useShortcut'

const press=(key:string,target?:unknown)=>{
  const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})
  if(target)Object.defineProperty(event,'target',{value:target,writable:false})
  document.dispatchEvent(event)
  return event
}

describe('useListNavigation',()=>{
  const ids=['a','b','c']

  it('moves forward and back through the list',()=>{
    const onChange=vi.fn()
    const {result}=renderHook(()=>useListNavigation({ids,activeId:'b',onChange}))
    act(()=>result.current.next())
    expect(onChange).toHaveBeenLastCalledWith('c')
    expect(result.current.index).toBe(1)
    expect(result.current.count).toBe(3)
  })

  // j then k returns you to where you started, rather than both presses resolving off the same
  // not-yet-updated activeId and landing you one place BEHIND it.
  it('returns to the starting item when reversed',()=>{
    const onChange=vi.fn()
    const {result}=renderHook(()=>useListNavigation({ids,activeId:'b',onChange}))
    act(()=>{result.current.next();result.current.previous()})
    expect(onChange.mock.calls.map((call)=>call[0])).toEqual(['c','b'])
  })

  /* Clamping rather than wrapping is what makes the "3 of 3" counter honest: a next that silently
   * returned to the first candidate would read as a bug halfway through a review. */
  it('clamps at both ends by default',()=>{
    const onChange=vi.fn()
    const last=renderHook(()=>useListNavigation({ids,activeId:'c',onChange}))
    expect(last.result.current.hasNext).toBe(false)
    act(()=>last.result.current.next())
    expect(onChange).not.toHaveBeenCalled()

    const first=renderHook(()=>useListNavigation({ids,activeId:'a',onChange}))
    expect(first.result.current.hasPrevious).toBe(false)
    act(()=>first.result.current.previous())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('wraps only when asked',()=>{
    const onChange=vi.fn()
    const {result}=renderHook(()=>useListNavigation({ids,activeId:'c',onChange,wrap:true}))
    act(()=>result.current.next())
    expect(onChange).toHaveBeenCalledWith('a')
  })

  // Without this the keyboard is unusable until the mouse has been used once.
  it('starts at an end when nothing is active yet',()=>{
    const forward=vi.fn()
    const next=renderHook(()=>useListNavigation({ids,activeId:null,onChange:forward}))
    expect(next.result.current.index).toBe(-1)
    act(()=>next.result.current.next())
    expect(forward).toHaveBeenCalledWith('a')

    const backward=vi.fn()
    const previous=renderHook(()=>useListNavigation({ids,activeId:null,onChange:backward}))
    act(()=>previous.result.current.previous())
    expect(backward).toHaveBeenCalledWith('c')
  })

  /* Held keys. `activeId` lives in the caller (the URL, for the board), so it lags a burst of
   * key-repeat by a render. Without the pending-id ref every handler in that burst read the same
   * stale index and asked for the same neighbour -- seven presses advanced exactly one place, which
   * is what shipped before this test existed. */
  it('keeps advancing when presses outrun the state catching up',()=>{
    const onChange=vi.fn()
    const {result}=renderHook(()=>useListNavigation({ids:['a','b','c','d'],activeId:'a',onChange}))
    act(()=>{result.current.next();result.current.next();result.current.next()})
    expect(onChange.mock.calls.map((call)=>call[0])).toEqual(['b','c','d'])
  })

  it('does nothing on an empty list',()=>{
    const onChange=vi.fn()
    const {result}=renderHook(()=>useListNavigation({ids:[],activeId:null,onChange}))
    act(()=>result.current.next())
    expect(onChange).not.toHaveBeenCalled()
    expect(result.current.hasNext).toBe(false)
  })

  describe('global binding',()=>{
    it('handles j/k/arrows and Enter from the document',()=>{
      const onChange=vi.fn();const onOpen=vi.fn()
      renderHook(()=>useListNavigation({ids,activeId:'a',onChange,onOpen,global:true}))
      act(()=>{press('j')})
      expect(onChange).toHaveBeenLastCalledWith('b')
      // ArrowDown is j, so it continues from the press before rather than repeating it.
      act(()=>{press('ArrowDown')})
      expect(onChange).toHaveBeenLastCalledWith('c')
      act(()=>{press('k')})
      expect(onChange).toHaveBeenLastCalledWith('b')
      act(()=>{press('Enter')})
      expect(onOpen).toHaveBeenCalledWith('a')
    })

    it('stays out of the way while the user is typing',()=>{
      const onChange=vi.fn()
      renderHook(()=>useListNavigation({ids,activeId:'a',onChange,global:true}))
      act(()=>{press('j',{tagName:'INPUT'})})
      expect(onChange).not.toHaveBeenCalled()
    })

    /* A page shortcut acting on the list behind an open dialog would move a selection the user
     * cannot see. The drawer gets its keys the other way, via onKeyDown. */
    it('refuses to fire from inside a dialog',()=>{
      const onChange=vi.fn()
      renderHook(()=>useListNavigation({ids,activeId:'a',onChange,global:true}))
      act(()=>{press('j',{tagName:'DIV',closest:(selector:string)=>selector.includes('dialog')?{}:null})})
      expect(onChange).not.toHaveBeenCalled()
    })

    it('leaves browser and OS chords alone',()=>{
      const onChange=vi.fn()
      renderHook(()=>useListNavigation({ids,activeId:'a',onChange,global:true}))
      act(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'j',ctrlKey:true,bubbles:true}))})
      expect(onChange).not.toHaveBeenCalled()
    })

    it('does not listen when disabled',()=>{
      const onChange=vi.fn()
      renderHook(()=>useListNavigation({ids,activeId:'a',onChange,global:true,enabled:false}))
      act(()=>{press('j')})
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  /* The scoped path is why the drawer can have shortcuts at all: it is already inside a dialog, so
   * judging it by isTypingTarget would reject every key it receives. */
  describe('scoped binding via onKeyDown',()=>{
    it('moves on j even though the event comes from inside a dialog',()=>{
      const onChange=vi.fn()
      const {result}=renderHook(()=>useListNavigation({ids,activeId:'a',onChange}))
      act(()=>result.current.onKeyDown({key:'j',metaKey:false,ctrlKey:false,altKey:false,
        target:{tagName:'DIV',closest:()=>({})},preventDefault:vi.fn()} as never))
      expect(onChange).toHaveBeenCalledWith('b')
    })

    it('still refuses while typing into a field in that dialog',()=>{
      const onChange=vi.fn()
      const {result}=renderHook(()=>useListNavigation({ids,activeId:'a',onChange}))
      act(()=>result.current.onKeyDown({key:'j',metaKey:false,ctrlKey:false,altKey:false,
        target:{tagName:'TEXTAREA'},preventDefault:vi.fn()} as never))
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  /* A widget nearer the event may already own the key.
   *
   * The document binding sees every keystroke on the page, including ones a focused control has
   * acted on -- and preventDefault stops the browser's default action WITHOUT stopping the event
   * reaching document. A SegmentedControl moves between its options on the arrow keys, so without
   * this one ArrowDown would move the control and the row cursor at once. */
  describe('deferring to a handled event',()=>{
    it('ignores an arrow key a focused widget has already claimed',()=>{
      const onChange=vi.fn()
      renderHook(()=>useListNavigation({ids,activeId:'a',onChange,global:true}))
      act(()=>{
        const event=new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})
        event.preventDefault() // what SegmentedControl does before this listener runs
        document.dispatchEvent(event)
      })
      expect(onChange).not.toHaveBeenCalled()
    })

    it('still moves on an arrow key nothing else claimed',()=>{
      const onChange=vi.fn()
      renderHook(()=>useListNavigation({ids,activeId:'a',onChange,global:true}))
      act(()=>{press('ArrowDown')})
      expect(onChange).toHaveBeenCalledWith('b')
    })
  })
})

/* The split that makes the two bindings possible; isTypingTarget must stay a superset of isFormField
 * or a page shortcut starts firing inside dialogs. */
describe('typing guards',()=>{
  it('separates form fields from dialogs',()=>{
    const field={tagName:'INPUT'} as unknown as EventTarget
    expect(isFormField(field)).toBe(true)
    expect(isTypingTarget(field)).toBe(true)

    const inDialog={tagName:'DIV',closest:(selector:string)=>selector.includes('dialog')?{}:null} as unknown as EventTarget
    expect(isFormField(inDialog)).toBe(false)
    expect(isTypingTarget(inDialog)).toBe(true)

    const plain={tagName:'DIV',closest:()=>null} as unknown as EventTarget
    expect(isFormField(plain)).toBe(false)
    expect(isTypingTarget(plain)).toBe(false)
  })
})
