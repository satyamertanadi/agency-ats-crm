import {afterEach,describe,expect,it} from 'vitest'
import {isRowInteractive} from './candidateRowInteraction'

/* The guard that decides whether a click on a candidate row opens Quick View or belongs to a control
 * inside it. Every one of these was a real click target on the row before the drawer existed, and
 * every one of them fails silently if the guard drops it: the drawer opens, the intended action does
 * not happen, and nothing says why. */

const html=(markup:string)=>{
  const row=document.createElement('tr')
  row.innerHTML=markup
  document.body.append(row)
  return row
}
afterEach(()=>{document.body.innerHTML=''})

describe('isRowInteractive',()=>{
  it('lets a press on the dead space in a cell through',()=>{
    const row=html('<td><span class="cell-quiet">Not in a pipeline</span></td>')
    expect(isRowInteractive(row.querySelector('span'))).toBe(false)
    expect(isRowInteractive(row.querySelector('td'))).toBe(false)
    expect(isRowInteractive(row)).toBe(false)
  })

  /* The candidate name is a link to the full record and stays the accessible route to it. If the row
   * swallowed this click, the only keyboard-and-screen-reader path to the record would be gone. */
  it('yields to the record link, including a press on the text inside it',()=>{
    const row=html('<td><a href="/app/acme/candidates/c1"><strong>Ni Putu Widya</strong></a></td>')
    expect(isRowInteractive(row.querySelector('a'))).toBe(true)
    expect(isRowInteractive(row.querySelector('strong'))).toBe(true)
  })

  it('yields to the selection checkbox and its label',()=>{
    const row=html('<td><label><input type="checkbox"/><span>Select</span></label></td>')
    expect(isRowInteractive(row.querySelector('input'))).toBe(true)
    expect(isRowInteractive(row.querySelector('label'))).toBe(true)
    // The label forwards its own click to the input, so a press on the words counts too.
    expect(isRowInteractive(row.querySelector('label span'))).toBe(true)
  })

  it('yields to the row menu trigger and to anything inside the open menu',()=>{
    const row=html('<td><button type="button" class="row-menu-trigger"><svg/></button>'
      +'<div role="menu"><button role="menuitem">Quick view</button></div></td>')
    expect(isRowInteractive(row.querySelector('.row-menu-trigger'))).toBe(true)
    expect(isRowInteractive(row.querySelector('svg'))).toBe(true)
    expect(isRowInteractive(row.querySelector('[role="menuitem"]'))).toBe(true)
  })

  it('yields to form controls a cell might hold',()=>{
    const row=html('<td><select><option>a</option></select><textarea></textarea>'
      +'<span role="button">Custom</span><span role="checkbox">Custom</span></td>')
    for(const selector of ['select','textarea','[role="button"]','[role="checkbox"]']){
      expect(isRowInteractive(row.querySelector(selector))).toBe(true)
    }
  })

  /* Called from a React synthetic event, whose target is whatever the user pressed -- which under
   * jsdom and in a browser is always an element, but the signature admits anything an EventTarget
   * can be. A throw here would take the whole list down on a stray click. */
  it('treats a target that is not an element as not interactive',()=>{
    expect(isRowInteractive(null)).toBe(false)
    expect(isRowInteractive(document)).toBe(false)
    expect(isRowInteractive(new EventTarget())).toBe(false)
  })
})
