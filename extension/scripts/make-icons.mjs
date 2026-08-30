// Generates the extension's toolbar/marketplace icons into extension/icons.
//
// Rendered and screenshotted with Playwright's Chromium, which the repo already depends on
// (@playwright/test) and already has installed -- so this adds no packages and no image library. Run
// it by hand when the mark changes; it is deliberately NOT part of `npm run build`, so CI never has to
// download a browser to build the extension.
//
//   node scripts/make-icons.mjs
//
// Two variants per size: the teal mark for an active sourcing session, and a desaturated one for idle.
// The toolbar button is the only always-visible trace of this extension, so it carries that state.
import {chromium} from '@playwright/test'
import {mkdirSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

const here=dirname(fileURLToPath(import.meta.url))
const out=join(here,'..','icons')
const SIZES=[16,32,48,128]
const ACTIVE='#287A72' // the same teal the panel and buttons use
const IDLE='#8a9299'

// A monogram, sized to fill the square: at 16px there is no room for anything more detailed, and an
// icon that only reads at 128px is the wrong icon.
const markup=(size,background)=>`<!doctype html><meta charset="utf-8">
<body style="margin:0;background:transparent">
  <div id="mark" style="
    width:${size}px;height:${size}px;box-sizing:border-box;
    border-radius:${Math.round(size*0.22)}px;background:${background};
    display:flex;align-items:center;justify-content:center;
  ">
    <span style="
      font:700 ${Math.round(size*0.68)}px/1 'Segoe UI',system-ui,-apple-system,Arial,sans-serif;
      color:#fff;letter-spacing:-0.02em;transform:translateY(${size>=48?'-2':'-1'}%);
    ">A</span>
  </div>
</body>`

mkdirSync(out,{recursive:true})
const browser=await chromium.launch()
const page=await browser.newPage({viewport:{width:256,height:256},deviceScaleFactor:1})

for(const [suffix,background] of [['',ACTIVE],['-idle',IDLE]]){
  for(const size of SIZES){
    await page.setContent(markup(size,background))
    const mark=page.locator('#mark')
    const file=join(out,`icon-${size}${suffix}.png`)
    await mark.screenshot({path:file,omitBackground:true})
    console.log(`  ${file}`)
  }
}

await browser.close()
console.log(`\nWrote ${SIZES.length*2} icons -> ${out}`)
