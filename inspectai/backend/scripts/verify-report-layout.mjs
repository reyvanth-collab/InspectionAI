import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D })
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
for (const name of [
  'completed',
  'long-multipage',
  ...((await fs.access('.env.pdf-checks/live-acceptance.pdf').then(
    () => true,
    () => false,
  ))
    ? ['live-acceptance']
    : []),
]) {
  const bytes = new Uint8Array(await fs.readFile(`.env.pdf-checks/${name}.pdf`))
  const document = await getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false })
    .promise
  let allText = ''
  for (let n = 1; n <= document.numPages; n++) {
    const page = await document.getPage(n),
      content = await page.getTextContent()
    allText += content.items.map((i) => i.str).join(' ') + '\n'
    if (n === 1 || n === 2 || n === document.numPages) {
      const viewport = page.getViewport({ scale: 1.25 }),
        canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise
      await fs.writeFile(`.env.pdf-checks/${name}-page-${n}.png`, canvas.toBuffer('image/png'))
    }
  }
  assert(allText.includes('Completed inspection report'))
  assert(allText.includes('Snapshot SHA-256'))
  if (name === 'long-multipage') {
    assert(document.numPages > 3)
    assert(allText.includes('30'))
    assert(allText.includes('do not execute'))
  }
  console.log(
    `PASS ${name}: ${document.numPages} A4 pages; text parsed and representative pages rendered`,
  )
}
