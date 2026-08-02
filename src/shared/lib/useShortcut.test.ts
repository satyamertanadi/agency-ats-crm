import {describe,expect,it} from 'vitest'
import {isTypingTarget} from './useShortcut'

/* Single-letter shortcuts and text entry compete for the same keys, so this guard is the whole
 * feature: get it wrong and typing a candidate's name into a search box starts toggling the board. */
describe('isTypingTarget',()=>{
  const make=(html:string)=>{const host=document.createElement('div');host.innerHTML=html;document.body.append(host);return host}

  it('claims nothing typed into a field',()=>{
    const host=make('<input/><textarea></textarea><select></select>')
    for(const node of host.children)expect(isTypingTarget(node),node.tagName).toBe(true)
  })

  it('claims contenteditable, including a child of one',()=>{
    const host=make('<div contenteditable="true"><span>note</span></div>')
    expect(isTypingTarget(host.firstElementChild)).toBe(true)
    expect(isTypingTarget(host.querySelector('span'))).toBe(true)
  })

  /* A shortcut firing behind an open dialog acts on a surface the user cannot see -- and every modal
   * in this app is a `role="dialog"`. */
  it('claims anything inside a dialog',()=>{
    const host=make('<div role="dialog"><button>Save</button></div>')
    expect(isTypingTarget(host.querySelector('button'))).toBe(true)
  })

  it('leaves ordinary page content alone',()=>{
    const host=make('<div><button>Add</button><p>text</p></div>')
    expect(isTypingTarget(host.querySelector('button'))).toBe(false)
    expect(isTypingTarget(host.querySelector('p'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
