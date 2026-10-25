// Getting a picture ready for the story: scaled to the site's working size and encoded small enough for the upload
// limit (the Studio may send 4 MB; the site re-encodes everything as WebP anyway).

const MAX_EDGE = 2200
const LIMIT = 3.6 * 1024 * 1024

const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q))

export async function prepareImage(file: Blob): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|gif|avif|bmp)$/.test(file.type)) throw new Error('That file is not a picture the site can use (use JPEG, PNG or WebP).')
  const bmp = await createImageBitmap(file).catch(() => null)
  if (!bmp) throw new Error('That picture could not be opened.')
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k))
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  for (const q of [0.88, 0.8, 0.7, 0.6]) {
    const b = (await toBlob(c, 'image/webp', q)) ?? (await toBlob(c, 'image/jpeg', q))
    if (b && b.size <= LIMIT) return b
  }
  throw new Error('That picture is too large even after shrinking it.')
}

/** A readable alt text from a file name: "IMG_2041-gas-field.jpg" → "gas field". */
export const altFromName = (name: string) => name.replace(/\.[a-z0-9]+$/i, '').replace(/^(img|dsc|pxl|image|photo)[-_ ]*\d*/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
