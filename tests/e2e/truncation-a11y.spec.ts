import {expect,test} from '@playwright/test'

/* TruncatedText announces its value once.
 *
 * The full value exists three times on a truncated cell: the element's own text node, the `title`
 * attribute, and the `::after` tooltip's generated content. Screen readers expose CSS generated
 * content, so the third one made a name be read out twice in a row -- measured, before the fix, as
 * an aria snapshot reading "Bambang Sutrisno Wijayakusuma Bambang Sutrisno Wijayakusuma".
 *
 * The fix is CSS alt text (`content: attr(data-full) / ""`), which keeps the tooltip visible and
 * gives the accessibility tree an empty alternative for it. These tests pin both halves, because
 * either one alone is a regression: no announcement at all would lose the value for screen-reader
 * users, and no tooltip would lose it for everyone else.
 *
 * Runs against the real stylesheet the same way layout-contract.spec.ts does. This is an
 * accessibility-TREE check; it is not a substitute for listening to a screen reader, which has not
 * been done for this change.
 */
const cell=(text:string,width:number,truncated:boolean)=>`
<div style="width:${width}px">
  <span id="probe" class="truncate-reveal"${truncated?` data-truncated="true" data-full="${text}" title="${text}"`:''}>${text}</span>
</div>`

const NAME='Bambang Sutrisno Wijayakusuma'

test('a truncated value is announced once, not twice',async({page})=>{
  await page.goto('/login')
  await page.setViewportSize({width:400,height:600})
  await page.evaluate((markup:string)=>{document.body.innerHTML=markup},cell(NAME,120,true))
  const snapshot=await page.locator('#probe').ariaSnapshot()
  const occurrences=snapshot.split(NAME).length-1
  expect(occurrences,`the name appears ${occurrences} times in the accessibility tree`).toBe(1)
})

test('the truncated value keeps its visible tooltip and its title',async({page})=>{
  await page.goto('/login')
  await page.setViewportSize({width:400,height:600})
  await page.evaluate((markup:string)=>{document.body.innerHTML=markup},cell(NAME,120,true))
  const result=await page.evaluate(()=>{
    const node=document.getElementById('probe') as HTMLElement
    return {content:getComputedStyle(node,'::after').content,title:node.getAttribute('title')}
  })
  // The tooltip still renders the value; only its accessible alternative is empty.
  expect(result.content).toContain(NAME)
  // title is the floor: touch long-press and assistive technology both still reach the full value.
  expect(result.title).toBe(NAME)
})

/* Text that fits must carry no tooltip and no title at all -- a tooltip on fully visible text trains
 * the reader to ignore the affordance, so the one value that IS cut off gets ignored too. */
test('a value that fits announces once and offers no tooltip',async({page})=>{
  await page.goto('/login')
  await page.setViewportSize({width:800,height:600})
  await page.evaluate((markup:string)=>{document.body.innerHTML=markup},cell('Ari',600,false))
  const snapshot=await page.locator('#probe').ariaSnapshot()
  expect(snapshot.split('Ari').length-1).toBe(1)
  const result=await page.evaluate(()=>{
    const node=document.getElementById('probe') as HTMLElement
    return {content:getComputedStyle(node,'::after').content,title:node.getAttribute('title')}
  })
  expect(result.title).toBeNull()
  expect(['none','normal','""']).toContain(result.content)
})

/* No new tab stops. The component deliberately adds none -- on a 50-row table with three truncated
 * values per row that would be 150 stops between the search box and the first action. */
test('truncation adds no tab stops',async({page})=>{
  await page.goto('/login')
  await page.setViewportSize({width:400,height:600})
  await page.evaluate((markup:string)=>{document.body.innerHTML=markup},cell(NAME,120,true))
  const tabIndex=await page.evaluate(()=>document.getElementById('probe')?.getAttribute('tabindex'))
  expect(tabIndex).toBeNull()
})
