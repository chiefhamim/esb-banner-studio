// List → Download list format: an empty workbook in exactly the shape the importer reads, with a second sheet of plain
// instructions an editor can hand to an AI or an agent. Built here, so no spreadsheet library is needed to write one file.

export const LIST_COLUMNS = ['Email', 'Person Name', 'Designation', 'Organization', 'Sector Group', 'Purpose', 'Phone', 'Deliverability Status']

export const LIST_INSTRUCTIONS = [
  'ESB Outreach mailing list format',
  'Hand this workbook and your own list to your AI or agent, and say: "Compile my contacts into the Contacts sheet of this workbook, following the Instructions sheet exactly."',
  '',
  'THE RULES',
  'Keep the first row of the Contacts sheet exactly as it is. One contact per row, starting on row 2. Save as .xlsx.',
  'Never invent anything. A detail the source does not give stays empty.',
  'Email (required): one address per row. A person with two addresses gets two rows. Lower case, no spaces, no "mailto:".',
  'Person Name: only the name as it should read after "Dear". No serial number, employee ID, phone number or anything in brackets. Write মোঃ মাহফুজার রহমান, never মোঃ মাহফুজার রহমান (২০৩৯৯). If the name is unknown leave it empty, and the letter says Sir/Madam.',
  'Designation: the post, as the source writes it. Leave empty if unknown.',
  'Organization: the office or company, as the source writes it. Leave empty if unknown.',
  'Sector Group: optional. A short group name such as Power Generation, used to choose part of a list.',
  'Purpose: optional. One or more words in capitals, separated by commas, such as MAGAZINE or EVENT_INVITE.',
  'Phone: optional.',
  'Deliverability Status: SAFE_TO_SEND means the address is checked and may be sent to. REVIEW_REQUIRED waits for the editor. EXCLUDED is never sent to. DEAD_NO_DNS means the domain has no mail server, and it is never sent to. Empty also waits for the editor.',
  'Bangla must be Unicode. Bijoy or SutonnyMJ text will appear as garbage in the letter, so convert it first.',
  'No merged cells, totals, blank rows between contacts, or meaning carried only by a colour.',
  'Any extra column is kept, and a letter can use it as a placeholder: a column named Project becomes {project}.',
  '',
  'WHEN IT IS DONE',
  'In Outreach, press Import list and choose the file. Anything that still needs a decision appears under Review.',
]

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

/** A .zip of uncompressed entries: all an .xlsx needs for a file this small. */
function zipStored(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  const le = (bytes: number, v: number) => { const a = new Uint8Array(bytes); for (let i = 0; i < bytes; i++) a[i] = (v >>> (8 * i)) & 255; return a }
  const join = (list: Uint8Array[]) => { const o = new Uint8Array(list.reduce((n, a) => n + a.length, 0)); let at = 0; for (const a of list) { o.set(a, at); at += a.length } return o }
  let offset = 0
  for (const [name, text] of files) {
    const n = enc.encode(name)
    const data = enc.encode(text)
    const crc = crc32(data)
    // version 20, UTF-8 names, stored, a fixed 1980-01-01 date so the same file is always the same bytes
    const common = [le(2, 20), le(2, 0x0800), le(2, 0), le(2, 0), le(2, 33), le(4, crc), le(4, data.length), le(4, data.length), le(2, n.length), le(2, 0)]
    const local = join([le(4, 0x04034b50), ...common, n, data])
    central.push(join([le(4, 0x02014b50), le(2, 20), ...common, le(2, 0), le(2, 0), le(2, 0), le(4, 0), le(4, offset), n]))
    parts.push(local)
    offset += local.length
  }
  const dir = join(central)
  return join([...parts, dir, le(4, 0x06054b50), le(2, 0), le(2, 0), le(2, files.length), le(2, files.length), le(4, dir.length), le(4, offset), le(2, 0)])
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cell = (ref: string, text: string, style: number) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG = 'http://schemas.openxmlformats.org/package/2006'
const SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml'

export function listTemplateBytes(): Uint8Array {
  const contacts = `${HEAD}<worksheet ${NS}><cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="4" width="30" customWidth="1"/><col min="5" max="7" width="20" customWidth="1"/><col min="8" max="8" width="24" customWidth="1"/></cols><sheetData><row r="1">${LIST_COLUMNS.map((c, i) => cell(`${String.fromCharCode(65 + i)}1`, c, 1)).join('')}</row></sheetData></worksheet>`
  const rows = LIST_INSTRUCTIONS.map((t, i) => (t ? `<row r="${i + 1}">${cell(`A${i + 1}`, t, i === 0 || /^[A-Z ]+$/.test(t) ? 1 : 2)}</row>` : '')).join('')
  const help = `${HEAD}<worksheet ${NS}><cols><col min="1" max="1" width="120" customWidth="1"/></cols><sheetData>${rows}</sheetData></worksheet>`
  return zipStored([
    ['[Content_Types].xml', `${HEAD}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${SHEET}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${SHEET}.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="${SHEET}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${SHEET}.styles+xml"/></Types>`],
    ['_rels/.rels', `${HEAD}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${HEAD}<workbook ${NS} xmlns:r="${R}"><sheets><sheet name="Contacts" sheetId="1" r:id="rId1"/><sheet name="Instructions" sheetId="2" r:id="rId2"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${HEAD}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${R}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `${HEAD}<styleSheet ${NS}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`],
    ['xl/worksheets/sheet1.xml', contacts],
    ['xl/worksheets/sheet2.xml', help],
  ])
}

export function downloadListTemplate() {
  const url = URL.createObjectURL(new Blob([listTemplateBytes() as BlobPart], { type: `${SHEET}.sheet` }))
  const a = Object.assign(document.createElement('a'), { href: url, download: 'ESB-Outreach-list-format.xlsx' })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
