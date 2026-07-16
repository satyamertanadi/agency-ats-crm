import {PDFDocument,StandardFonts,rgb,type PDFFont,type PDFPage} from 'pdf-lib'
import type {CandidateProfileViewModel} from './candidateProfileViewModel'

const PAGE={width:612,height:792,margin:54};const CONTENT=PAGE.width-PAGE.margin*2
function color(hex:string){const value=hex.replace('#','');return rgb(parseInt(value.slice(0,2),16)/255,parseInt(value.slice(2,4),16)/255,parseInt(value.slice(4,6),16)/255)}
function safe(value:string){return [...value.replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"')].map((character)=>{const code=character.charCodeAt(0);return code===9||code===10||code===13||(code>=32&&code<=255)?character:'?'}).join('')}
function wrap(text:string,font:PDFFont,size:number,width:number){const words=safe(text).split(/\s+/);const lines:string[]=[];let line='';for(const word of words){const next=line?`${line} ${word}`:word;if(font.widthOfTextAtSize(next,size)<=width)line=next;else{if(line)lines.push(line);line=word}}if(line)lines.push(line);return lines.length?lines:['']}

export async function buildCandidateProfilePdf(view:CandidateProfileViewModel){
  const doc=await PDFDocument.create();const regular=await doc.embedFont(StandardFonts.Helvetica);const bold=await doc.embedFont(StandardFonts.HelveticaBold);const accent=color(view.accent);let page:PDFPage=doc.addPage([PAGE.width,PAGE.height]);let y=0;doc.removePage(0)
  const addPage=()=>{page=doc.addPage([PAGE.width,PAGE.height]);y=PAGE.height-PAGE.margin;page.drawText(safe(view.organizationName),{x:PAGE.margin,y,size:9,font:regular,color:rgb(.42,.45,.49)});page.drawText(safe(view.confidentialLabel),{x:PAGE.margin,y:28,size:8,font:regular,color:rgb(.42,.45,.49)});page.drawText(String(doc.getPageCount()),{x:PAGE.width-PAGE.margin-8,y:28,size:8,font:regular,color:rgb(.42,.45,.49)});y-=32}
  const ensure=(height:number)=>{if(y-height<PAGE.margin+18)addPage()}
  const paragraph=(text:string,options:{size?:number;font?:PDFFont;color?:ReturnType<typeof rgb>;indent?:number;after?:number}={})=>{const size=options.size||10;const font=options.font||regular;const indent=options.indent||0;const lines=wrap(text,font,size,CONTENT-indent);ensure(lines.length*(size+3)+(options.after??7));for(const line of lines){page.drawText(line,{x:PAGE.margin+indent,y,size,font,color:options.color||rgb(.12,.15,.18)});y-=size+3}y-=options.after??7}
  const heading=(text:string)=>{ensure(34);y-=8;page.drawText(safe(text.toUpperCase()),{x:PAGE.margin,y,size:13,font:bold,color:accent});y-=7;page.drawLine({start:{x:PAGE.margin,y},end:{x:PAGE.width-PAGE.margin,y},thickness:1.4,color:accent});y-=16}
  addPage()
  if(view.logo){try{const image=view.logo.type==='png'?await doc.embedPng(view.logo.bytes):await doc.embedJpg(view.logo.bytes);const scale=Math.min(112/image.width,48/image.height);page.drawImage(image,{x:PAGE.margin,y:y-image.height*scale,width:image.width*scale,height:image.height*scale});y-=70}catch{paragraph(view.organizationName,{size:11,font:bold,color:accent,after:36})}}else paragraph(view.organizationName,{size:11,font:bold,color:accent,after:36})
  paragraph(view.candidateName.toUpperCase(),{size:20,font:bold,color:accent,after:8});paragraph(`${view.language==='id'?'UNTUK POSISI':'FOR THE ROLE OF'} ${view.jobTitle.toUpperCase()}`,{size:13,font:bold,after:3});paragraph(`${view.language==='id'?'DI':'AT'} ${view.companyName.toUpperCase()}`,{size:13,font:bold,after:26});paragraph(`${view.language==='id'?'Disiapkan oleh':'Prepared by'}: ${view.preparedBy}`,{font:bold,after:3});paragraph(`${view.language==='id'?'Tanggal':'Date'}: ${view.preparedDate}`,{font:bold,after:24});heading(view.language==='id'?'Catatan kerahasiaan':'Confidentiality notice');paragraph(view.confidentialityText);paragraph(view.confidentialLabel,{font:bold,color:accent})
  addPage()
  for(const section of view.sectionOrder){heading(section.label)
    if(section.key==='information'){for(const [label,value] of view.information){const labelLines=wrap(label,bold,9,141);const valueLines=wrap(value,regular,9,CONTENT-169);const rowHeight=Math.max(labelLines.length,valueLines.length)*12+12;ensure(rowHeight+6);page.drawRectangle({x:PAGE.margin,y:y-rowHeight+6,width:155,height:rowHeight,color:rgb(.94,.96,.95)});page.drawRectangle({x:PAGE.margin+155,y:y-rowHeight+6,width:CONTENT-155,height:rowHeight,borderColor:rgb(.82,.84,.85),borderWidth:.5});labelLines.forEach((line,index)=>page.drawText(line,{x:PAGE.margin+7,y:y-7-index*12,size:9,font:bold,color:rgb(.12,.15,.18)}));valueLines.forEach((line,index)=>page.drawText(line,{x:PAGE.margin+162,y:y-7-index*12,size:9,font:regular,color:rgb(.12,.15,.18)}));y-=rowHeight}y-=8}
    if(section.key==='summary')view.summary.forEach((value)=>paragraph(value))
    if(section.key==='experience')view.employment.forEach((item)=>{paragraph(`${item.title} - ${item.companyName}`,{font:bold,after:2});paragraph(item.date,{size:9,color:rgb(.35,.39,.43),after:4});(item.relevance.length?item.relevance:[view.language==='id'?'Relevansi perlu dikonfirmasi.':'Relevance to be confirmed.']).forEach((value)=>paragraph(`- ${value}`,{indent:10,after:3}));y-=5})
    if(section.key==='education')view.education.forEach((value)=>paragraph(`- ${value}`,{indent:10}))
    if(section.key==='strengths')paragraph(view.strengths)
    if(section.key==='risks')paragraph(view.risks)
    if(section.key==='questions')view.questions.forEach((value)=>paragraph(`- ${value}`,{indent:10}))
  }
  const bytes=await doc.save({useObjectStreams:false});return new Blob([new Uint8Array(bytes)],{type:'application/pdf'})
}
