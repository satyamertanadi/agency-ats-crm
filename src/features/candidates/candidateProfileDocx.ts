import {AlignmentType,BorderStyle,Document,Footer,Header,ImageRun,PageBreak,PageNumber,Packer,Paragraph,ShadingType,Table,TableCell,TableLayoutType,TableRow,TextRun,VerticalAlign,WidthType,type IBorderOptions,type ParagraphChild} from 'docx'
import type {CandidateProfileViewModel} from './candidateProfileViewModel'

const CONTENT_WIDTH=9360;const LABEL_WIDTH=2900;const VALUE_WIDTH=CONTENT_WIDTH-LABEL_WIDTH
const border:IBorderOptions={style:BorderStyle.SINGLE,size:4,color:'D6D9DC'};const borders={top:border,bottom:border,left:border,right:border}
const hex=(value:string)=>value.replace('#','').toUpperCase()

function textParagraph(text:string,options:{bold?:boolean;size?:number;color?:string;bullet?:boolean;after?:number}={}){return new Paragraph({spacing:{after:options.after??120,line:264},bullet:options.bullet?{level:0}:undefined,children:[new TextRun({text,bold:options.bold,size:options.size,color:options.color})]})}
function heading(text:string,accent:string){return new Paragraph({heading:'Heading2',spacing:{before:260,after:100},border:{bottom:{style:BorderStyle.SINGLE,size:10,color:accent,space:4}},children:[new TextRun({text,bold:true,size:26,color:accent})]})}
function row(label:string,value:string,accent:string){return new TableRow({cantSplit:true,children:[new TableCell({width:{size:LABEL_WIDTH,type:WidthType.DXA},borders,shading:{type:ShadingType.CLEAR,fill:'EAF3EF'},margins:{top:100,bottom:100,left:120,right:120},verticalAlign:VerticalAlign.CENTER,children:[textParagraph(label,{bold:true,color:accent,after:0})]}),new TableCell({width:{size:VALUE_WIDTH,type:WidthType.DXA},borders,margins:{top:100,bottom:100,left:120,right:120},children:[textParagraph(value,{after:0})]})]})}
function sectionChildren(view:CandidateProfileViewModel,key:string,accent:string):(Paragraph|Table)[]{
  if(key==='information')return [new Table({width:{size:CONTENT_WIDTH,type:WidthType.DXA},layout:TableLayoutType.FIXED,indent:{size:0,type:WidthType.DXA},rows:view.information.map(([label,value])=>row(label,value,accent))})]
  if(key==='summary')return view.summary.map((value)=>textParagraph(value))
  if(key==='experience')return view.employment.length?view.employment.flatMap((item,index)=>[textParagraph(`${item.title} - ${item.companyName}`,{bold:true,after:40}),textParagraph(item.date,{color:'59636E',after:60}),...(item.relevance.length?item.relevance.map((value)=>textParagraph(value,{bullet:true,after:50})):[textParagraph(view.language==='id'?'Relevansi perlu dikonfirmasi.':'Relevance to be confirmed.',{bullet:true,after:50})]),...(index<view.employment.length-1?[textParagraph('',{after:60})]:[])]):[textParagraph(view.language==='id'?'Perlu dikonfirmasi':'To be confirmed')]
  if(key==='education')return view.education.map((value)=>textParagraph(value,{bullet:true}))
  if(key==='strengths')return [textParagraph(view.strengths)]
  if(key==='risks')return [textParagraph(view.risks)]
  if(key==='questions')return view.questions.map((value)=>textParagraph(value,{bullet:true}))
  return []
}

export function buildProfileDocument(view:CandidateProfileViewModel){
  const accent=hex(view.accent);const logo:ParagraphChild[]=view.logo?[new ImageRun({data:view.logo.bytes,type:view.logo.type,transformation:{width:112,height:48},altText:{title:`${view.organizationName} logo`,description:'Organization logo',name:'Organization logo'}})]:[new TextRun({text:view.organizationName,bold:true,size:22,color:accent})]
  const cover=[new Paragraph({spacing:{after:520},children:logo}),new Paragraph({spacing:{after:80},children:[new TextRun({text:view.candidateName.toUpperCase(),bold:true,size:38,color:accent})]}),new Paragraph({spacing:{after:40},children:[new TextRun({text:`${view.language==='id'?'UNTUK POSISI':'FOR THE ROLE OF'} ${view.jobTitle.toUpperCase()}`,bold:true,size:26})]}),new Paragraph({spacing:{after:380},children:[new TextRun({text:`${view.language==='id'?'DI':'AT'} ${view.companyName.toUpperCase()}`,bold:true,size:26})]}),new Table({width:{size:CONTENT_WIDTH,type:WidthType.DXA},layout:TableLayoutType.FIXED,rows:[row(view.language==='id'?'Disiapkan oleh':'Prepared by',view.preparedBy,accent),row(view.language==='id'?'Tanggal':'Date',view.preparedDate,accent)]}),new Paragraph({spacing:{before:300,after:100},children:[new TextRun({text:view.language==='id'?'Catatan kerahasiaan':'Confidentiality notice',bold:true,size:24,color:accent})]}),textParagraph(view.confidentialityText),textParagraph(view.confidentialLabel,{bold:true,color:accent}),new Paragraph({children:[new PageBreak()]})]
  const body:(Paragraph|Table)[]=[]
  for(const section of view.sectionOrder){body.push(heading(section.label.toUpperCase(),accent),...sectionChildren(view,section.key,accent))}
  return new Document({styles:{default:{document:{run:{font:'Calibri',size:22},paragraph:{spacing:{after:120,line:264}}}},paragraphStyles:[{id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,run:{font:'Calibri',bold:true,size:26,color:accent},paragraph:{spacing:{before:260,after:100},keepNext:true}}]},sections:[{properties:{page:{size:{width:12240,height:15840},margin:{top:1440,right:1440,bottom:1440,left:1440,header:720,footer:720}}},headers:{default:new Header({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:view.organizationName,size:18,color:'6B7280'})]})]})},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:`${view.confidentialLabel}  |  `,size:16,color:'6B7280'}),new TextRun({children:[PageNumber.CURRENT],size:16,color:'6B7280'})]})]})},children:[...cover,...body]}]})
}

export function buildCandidateProfileDocx(view:CandidateProfileViewModel){return Packer.toBlob(buildProfileDocument(view))}
export function downloadBlob(blob:Blob,filename:string){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
