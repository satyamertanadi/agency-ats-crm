import {AlignmentType,BorderStyle,Document,ExternalHyperlink,Footer,HeadingLevel,ImageRun,Packer,Paragraph,ShadingType,Table,TableCell,TableLayoutType,TableRow,TextRun,VerticalAlign,WidthType,type IBorderOptions,type ParagraphChild} from 'docx'
import type {CandidateProfileViewModel} from './candidateProfileViewModel'

/* Renders the agency's mandatory client template. Every geometry number here was measured from the
 * approved .docx rather than chosen, because a consultant may not send anything that deviates from
 * it -- see candidateProfileDocx.test.ts, which asserts these against the same measurements.
 *
 * The document order is hard-coded on purpose. The template's `sections` array still exists and is
 * still validated as seven entries, but a mandatory format has no configurable order by definition,
 * so `sectionLabels` is consumed for bilingual wording only. Education, strengths, risks and points
 * to validate are no longer sections at all: the first three are rows in the information table and
 * the last is the closing summary bullet. */
const PAGE={width:11910,height:16840} as const
const MARGIN={top:1220,right:1260,bottom:0,left:1320,header:720,footer:720} as const
const BODY_MARGIN={top:1580,right:1260,bottom:2780,left:1320,header:0,footer:2595} as const
const CONTENT_WIDTH=PAGE.width-MARGIN.left-MARGIN.right   // 9330
const LABEL_WIDTH=2900;const VALUE_WIDTH=CONTENT_WIDTH-LABEL_WIDTH
// Cover logo 12.00x4.23cm and footer banner 17.01x4.89cm. docx takes pixels at 96 DPI, not cm.
const COVER_LOGO={width:454,height:160} as const
const FOOTER_BANNER={width:643,height:185} as const
const border:IBorderOptions={style:BorderStyle.SINGLE,size:4,color:'D6D9DC'};const borders={top:border,bottom:border,left:border,right:border}
const hex=(value:string)=>value.replace('#','').toUpperCase()

function textParagraph(text:string,options:{bold?:boolean;size?:number;color?:string;bullet?:boolean;after?:number}={}){return new Paragraph({spacing:{after:options.after??120,line:264},bullet:options.bullet?{level:0}:undefined,children:[new TextRun({text,bold:options.bold,size:options.size,color:options.color})]})}
function heading(text:string){return new Paragraph({heading:HeadingLevel.HEADING_1,alignment:AlignmentType.CENTER,spacing:{before:260,after:100},children:[new TextRun({text,bold:true})]})}
/* The template draws its rules as thin images. A paragraph border is the same ink at the same
 * weight without carrying two PNGs through the bundle and into every generated file. */
function rule(thick:boolean,accent:string){return new Paragraph({spacing:{after:thick?160:100},border:{bottom:{style:BorderStyle.SINGLE,size:thick?32:4,color:thick?accent:'D6D9DC',space:1}},children:[]})}
/* The name is set in faux small caps: each word's initial two points larger than the rest, which is
 * how the approved document does it -- Word's own smallCaps would render differently. */
function smallCapsName(name:string):ParagraphChild[]{
  return name.split(/\s+/).filter(Boolean).flatMap((word,index)=>{
    const spacer=index?' ':'';const initial=word.slice(0,1).toUpperCase();const rest=word.slice(1).toUpperCase()
    return [new TextRun({text:`${spacer}${initial}`,bold:true,size:40}),...(rest?[new TextRun({text:rest,bold:true,size:32})]:[])]
  })
}
function cell(children:Paragraph[],width:number,shaded:boolean){return new TableCell({width:{size:width,type:WidthType.DXA},borders,shading:shaded?{type:ShadingType.CLEAR,fill:'EAF3EF'}:undefined,margins:{top:100,bottom:100,left:120,right:120},verticalAlign:VerticalAlign.CENTER,children})}
// A label may carry more than one line -- the first information row is literally "Name" over "Photo".
function row(label:string,value:string,accent:string){return new TableRow({cantSplit:true,children:[cell(label.split('\n').map((line)=>textParagraph(line,{bold:true,color:accent,after:0})),LABEL_WIDTH,true),cell(value.split('\n').map((line)=>textParagraph(line,{after:0})),VALUE_WIDTH,false)]})}
function headerRow(label:string,accent:string){return new TableRow({tableHeader:true,cantSplit:true,children:[new TableCell({columnSpan:2,width:{size:CONTENT_WIDTH,type:WidthType.DXA},borders,shading:{type:ShadingType.CLEAR,fill:'EAF3EF'},margins:{top:100,bottom:100,left:120,right:120},children:[textParagraph(label,{bold:true,color:accent,after:0})]})]})}
function table(rows:TableRow[]){return new Table({width:{size:CONTENT_WIDTH,type:WidthType.DXA},layout:TableLayoutType.FIXED,indent:{size:0,type:WidthType.DXA},rows})}
// Omitted entirely when blank: a "To be confirmed" hyperlink is worse than no line at all.
function websiteLine(url:string){return new Paragraph({spacing:{after:60,line:264},children:[new ExternalHyperlink({link:url,children:[new TextRun({text:url,style:'Hyperlink'})]})]})}

function coverTable(view:CandidateProfileViewModel,accent:string){
  const identity=new TableRow({cantSplit:true,children:[new TableCell({columnSpan:2,width:{size:CONTENT_WIDTH,type:WidthType.DXA},borders,margins:{top:160,bottom:160,left:120,right:120},children:[
    new Paragraph({spacing:{after:80},children:smallCapsName(view.candidateName)}),
    new Paragraph({spacing:{after:40},children:[new TextRun({text:`${forTheRole(view)} ${view.jobTitle.toUpperCase()}`,bold:true,size:32})]}),
    new Paragraph({spacing:{after:0},children:[new TextRun({text:`${atLabel(view)} ${view.companyName.toUpperCase()}`,bold:true,size:32})]}),
  ]})]})
  return table([identity,row(preparedByLabel(view),view.preparedBy,accent),row(dateLabel(view),view.preparedDate,accent),row(remarksLabel(view),`${view.confidentialityText}\n${view.confidentialLabel}`,accent)])
}
const forTheRole=(view:CandidateProfileViewModel)=>view.language==='id'?'UNTUK POSISI':'FOR THE ROLE OF'
const atLabel=(view:CandidateProfileViewModel)=>view.language==='id'?'DI':'AT'
const preparedByLabel=(view:CandidateProfileViewModel)=>view.language==='id'?'Disiapkan oleh':'Prepared by'
const dateLabel=(view:CandidateProfileViewModel)=>view.language==='id'?'Tanggal':'Date'
const remarksLabel=(view:CandidateProfileViewModel)=>view.language==='id'?'Catatan':'Remarks'
const informationLabel=(view:CandidateProfileViewModel)=>view.language==='id'?'INFORMASI':'INFORMATION'

export function buildProfileDocument(view:CandidateProfileViewModel){
  const accent=hex(view.accent)
  const cover:(Paragraph|Table)[]=[coverTable(view,accent)]
  if(view.logo)cover.push(new Paragraph({spacing:{before:200,after:200},children:[new ImageRun({data:view.logo.bytes,type:view.logo.type,transformation:COVER_LOGO,altText:{title:`${view.organizationName} logo`,description:'Organization logo',name:'Organization logo'}})]}))
  else cover.push(new Paragraph({spacing:{before:200,after:200},children:[new TextRun({text:view.organizationName,bold:true,size:22,color:accent})]}))
  cover.push(table([headerRow(informationLabel(view),accent),...view.information.map(([label,value])=>row(label,value,accent))]))
  const children:(Paragraph|Table)[]=[]
  children.push(heading(view.sectionLabels.summary.toUpperCase()),rule(true,accent))
  for(const paragraph of view.summary)children.push(textParagraph(paragraph))
  if(view.currentRoleLine)children.push(textParagraph(view.currentRoleLine))
  for(const bullet of view.summaryBullets)children.push(textParagraph(bullet,{bullet:true,after:50}))
  children.push(heading(view.sectionLabels.experience.toUpperCase()))
  if(view.employment.length)view.employment.forEach((item,index)=>{
    children.push(textParagraph(`${companyLabel(view)}: ${item.companyName}`,{bold:true,after:0}))
    children.push(textParagraph(`${titleLabel(view)}: ${item.title}`,{bold:true,after:0}))
    children.push(textParagraph(`${dateLabel(view)}: ${item.date}`,{bold:true,after:60}))
    if(item.website)children.push(websiteLine(item.website))
    for(const bullet of item.relevance)children.push(textParagraph(bullet,{bullet:true,after:50}))
    if(index<view.employment.length-1)children.push(rule(false,accent))
  })
  // No employment rows on the record -- match the old renderer's fallback rather than leaving the
  // heading with nothing under it.
  else children.push(textParagraph(view.language==='id'?'Perlu dikonfirmasi.':'To be confirmed.'))
  const footer=view.footerBanner?new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new ImageRun({data:view.footerBanner.bytes,type:view.footerBanner.type,transformation:FOOTER_BANNER,altText:{title:`${view.organizationName} footer`,description:'Organization footer banner',name:'Organization footer banner'}})]})]}):new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:view.confidentialLabel,size:16,color:'6B7280'})]})]})
  return new Document({
    /* Heading1 must be overridden via styles.default.heading1, not a custom paragraphStyles entry:
     * the docx library always constructs its own built-in Heading1 style (Word's stock blue, 16pt --
     * see Heading1Style in the library source) and merges options.heading1 into it. A same-ID entry
     * in paragraphStyles produces a second "Heading1" definition that Word ignores in favour of the
     * library's own, which is why an earlier version of this file rendered blue oversized headings
     * despite specifying `run:{bold:true}` on a paragraphStyles entry -- that entry was never read.
     * color and size are set explicitly because the library's spread-merge only overrides keys that
     * are present; omitting them here would silently keep the library's blue/32 defaults. The result
     * matches the approved template, whose Heading1 has no run-level color or size at all and so
     * inherits Normal's black, 11pt. */
    styles:{default:{document:{run:{font:'Calibri',size:22},paragraph:{spacing:{after:120,line:264}}},heading1:{run:{bold:true,color:'auto',size:22},paragraph:{indent:{left:120},outlineLevel:0,spacing:{before:260,after:100},keepNext:true}}}},
    // Two sections mirroring the approved document: the cover runs to a zero bottom margin, the body
    // reserves the deep bottom band the footer banner occupies.
    sections:[
      {properties:{page:{size:PAGE,margin:MARGIN}},footers:{default:footer},children:cover},
      {properties:{page:{size:PAGE,margin:BODY_MARGIN}},footers:{default:footer},children},
    ],
  })
}
const companyLabel=(view:CandidateProfileViewModel)=>view.language==='id'?'Perusahaan':'Company'
const titleLabel=(view:CandidateProfileViewModel)=>view.language==='id'?'Jabatan':'Job Title'

export function buildCandidateProfileDocx(view:CandidateProfileViewModel){return Packer.toBlob(buildProfileDocument(view))}
export function downloadBlob(blob:Blob,filename:string){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
