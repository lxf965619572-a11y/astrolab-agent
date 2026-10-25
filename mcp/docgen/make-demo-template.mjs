#!/usr/bin/env node
// 生成演示用 Word 模板 config/templates/demo-gjb438b.docx。
// 这不是部门正式模板，只用于外网演示 docgen 服务；进内网后把部门正式模板放进 config/templates 即可。
// 用法：node mcp/docgen/make-demo-template.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeZip } from '../common/zip.mjs'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

const contentTypes = `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`

const rootRels = `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`

const docRels = `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>
<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>
</Relationships>`

const core = `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>演示文档模板</dc:title><dc:creator>astrolab-agent</dc:creator></cp:coreProperties>`
const app = `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>astrolab-agent docgen</Application></Properties>`

const font = (ea, ascii = 'Times New Roman') => `<w:rFonts w:ascii="${ascii}" w:hAnsi="${ascii}" w:eastAsia="${ea}" w:cs="${ascii}"/>`
const sz = (n) => `<w:sz w:val="${n}"/><w:szCs w:val="${n}"/>`

function heading(n, size, before, after) {
  return `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>
<w:pPr><w:keepNext/><w:keepLines/><w:numPr><w:ilvl w:val="${n - 1}"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="${before}" w:after="${after}" w:line="360" w:lineRule="auto"/><w:ind w:left="0" w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="left"/><w:outlineLvl w:val="${n - 1}"/></w:pPr>
<w:rPr>${font('黑体')}${sz(size)}</w:rPr></w:style>`
}

const styles = `${DECL}<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr>${font('宋体')}${sz(24)}<w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl w:val="0"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLineChars="200" w:firstLine="480"/></w:pPr></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:semiHidden/></w:style>
${heading(1, 32, 240, 120)}
${heading(2, 28, 180, 60)}
${heading(3, 24, 120, 60)}
${heading(4, 24, 120, 0)}
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="240"/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr>${font('黑体')}${sz(44)}</w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="60" w:after="60" w:line="240" w:lineRule="auto"/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr>${font('黑体')}${sz(21)}</w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="TableText"><w:name w:val="表格文字"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:rPr>${sz(21)}</w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Code"><w:name w:val="代码"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:rPr>${font('宋体', 'Courier New')}${sz(18)}</w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="8296"/></w:tabs><w:ind w:firstLineChars="0" w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="8296"/></w:tabs><w:ind w:leftChars="200" w:left="480" w:firstLineChars="0" w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC3"><w:name w:val="toc 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="8296"/></w:tabs><w:ind w:leftChars="400" w:left="960" w:firstLineChars="0" w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr><w:tabs><w:tab w:val="center" w:pos="4153"/><w:tab w:val="right" w:pos="8306"/></w:tabs><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="right"/></w:pPr><w:rPr>${sz(18)}</w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4153"/><w:tab w:val="right" w:pos="8306"/></w:tabs><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr>${sz(18)}</w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`

function lvl(i, text) {
  return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading${i + 1}"/>${i ? '<w:isLgl/>' : ''}<w:suff w:val="space"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="0" w:firstLine="0"/></w:pPr></w:lvl>`
}
const numbering = `${DECL}<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>${lvl(0, '%1')}${lvl(1, '%1.%2')}${lvl(2, '%1.%2.%3')}${lvl(3, '%1.%2.%3.%4')}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`

const settings = `${DECL}<w:settings ${W}><w:zoom w:percent="100"/><w:defaultTabStop w:val="420"/><w:characterSpacingControl w:val="compressPunctuation"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`

const fontTable = `${DECL}<w:fonts ${W}><w:font w:name="宋体"><w:altName w:val="SimSun"/><w:charset w:val="86"/><w:family w:val="auto"/><w:pitch w:val="variable"/></w:font><w:font w:name="黑体"><w:altName w:val="SimHei"/><w:charset w:val="86"/><w:family w:val="modern"/><w:pitch w:val="fixed"/></w:font><w:font w:name="Times New Roman"><w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font></w:fonts>`

// 封面与正文
const p = (text, { jc = 'center', size, ea = '宋体', before = 0, after = 0, ind = true, newPage = false } = {}) =>
  `<w:p><w:pPr>${newPage ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="${before}" w:after="${after}" w:line="240" w:lineRule="auto"/>${ind ? '<w:ind w:firstLineChars="0" w:firstLine="0"/>' : ''}<w:jc w:val="${jc}"/></w:pPr>${text ? `<w:r><w:rPr>${font(ea)}${size ? sz(size) : ''}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>` : ''}</w:p>`
const signRow = (label) => `<w:tr><w:trPr><w:trHeight w:val="567"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="1400" w:type="dxa"/></w:tcPr>${p(label, { size: 24, before: 120 })}</w:tc><w:tc><w:tcPr><w:tcW w:w="2600" w:type="dxa"/></w:tcPr>${p('')}</w:tc><w:tc><w:tcPr><w:tcW w:w="1400" w:type="dxa"/></w:tcPr>${p('日期', { size: 24, before: 120 })}</w:tc><w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>${p('')}</w:tc></w:tr>`
const signTable = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="7200" w:type="dxa"/><w:jc w:val="center"/><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid><w:gridCol w:w="1400"/><w:gridCol w:w="2600"/><w:gridCol w:w="1400"/><w:gridCol w:w="1800"/></w:tblGrid>${['编写', '校对', '审核', '批准'].map(signRow).join('')}</w:tbl>`
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

const document = `${DECL}<w:document ${W}><w:body>
${p('密级：{{密级}}', { jc: 'left', size: 24 })}
${p('文件编号：{{文件编号}}', { jc: 'right', size: 24 })}
${p('（演示模板，非部门正式模板。进内网后替换为部门正式模板。）', { size: 18, before: 120 })}
${p('', { before: 1200 })}
${p('{{软件名称}}', { size: 36, ea: '黑体', after: 240 })}
${p('{{文档名称}}', { size: 44, ea: '黑体', after: 360 })}
${p('版本：{{版本}}', { size: 28, after: 960 })}
${signTable}
${p('', { before: 960 })}
${p('{{单位}}', { size: 28, after: 120 })}
${p('{{日期}}', { size: 28 })}
${p('目　录', { size: 32, ea: '黑体', after: 240, newPage: true })}
<w:p><w:pPr><w:ind w:firstLineChars="0" w:firstLine="0"/></w:pPr><w:r><w:t>{{目录}}</w:t></w:r></w:p>
${pageBreak}
<w:p><w:r><w:t>{{正文}}</w:t></w:r></w:p>
<w:sectPr><w:headerReference w:type="default" r:id="rId5"/><w:headerReference w:type="first" r:id="rId7"/><w:footerReference w:type="default" r:id="rId6"/><w:footerReference w:type="first" r:id="rId8"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/><w:cols w:space="425"/><w:titlePg/><w:docGrid w:linePitch="312"/></w:sectPr>
</w:body></w:document>`

const header = `${DECL}<w:hdr ${W}><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t xml:space="preserve">{{文件编号}}　{{文档名称}}</w:t></w:r></w:p></w:hdr>`
const footer = `${DECL}<w:ftr ${W}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t xml:space="preserve">第 </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> 页</w:t></w:r></w:p></w:ftr>`

// 封面（首页）用空白页眉页脚
const emptyHeader = `${DECL}<w:hdr ${W}><w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLineChars="0" w:firstLine="0"/></w:pPr></w:p></w:hdr>`
const emptyFooter = `${DECL}<w:ftr ${W}><w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLineChars="0" w:firstLine="0"/></w:pPr></w:p></w:ftr>`

const buf = writeZip([
  ['[Content_Types].xml', contentTypes],
  ['_rels/.rels', rootRels],
  ['docProps/core.xml', core],
  ['docProps/app.xml', app],
  ['word/document.xml', document],
  ['word/_rels/document.xml.rels', docRels],
  ['word/styles.xml', styles],
  ['word/numbering.xml', numbering],
  ['word/settings.xml', settings],
  ['word/fontTable.xml', fontTable],
  ['word/header1.xml', header],
  ['word/footer1.xml', footer],
  ['word/header2.xml', emptyHeader],
  ['word/footer2.xml', emptyFooter],
])

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'templates')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'demo-gjb438b.docx'), buf)
writeFileSync(join(outDir, 'demo-gjb438b.json'), JSON.stringify({
  description: '演示模板（非部门正式模板）：A4，正文宋体小四、1.5 倍行距、首行缩进 2 字符；标题黑体，多级自动编号 1 / 1.1 / 1.1.1；封面、目录、页眉页脚。',
  styles: {},
}, null, 2) + '\n')
console.log(`已生成 ${join(outDir, 'demo-gjb438b.docx')}`)
