import { describe, it, expect, beforeEach } from 'vitest'
import { serializeProject, applyProject } from '../../src/project'
import { defaultDoc } from '../../src/core/templates'
import { useStore } from '../../src/store'

describe('Project Format v1 & v2', () => {
  beforeEach(() => {
    useStore.getState().newBanner(false)
  })

  it('serializes project with version 2 and graphics sub-object', async () => {
    const jsonStr = await serializeProject()
    const parsed = JSON.parse(jsonStr)

    expect(parsed.app).toBe('esb-banner-studio')
    expect(parsed.version).toBe(2)
    expect(parsed.format).toBe('fb45')
    expect(parsed.doc).toBeDefined()
    expect(parsed.graphics).toBeDefined()
    expect(parsed.graphics.format).toBe('fb45')
    expect(parsed.graphics.doc).toBeDefined()
    expect(Array.isArray(parsed.images)).toBe(true)
  })

  it('applies v1 legacy project file accurately', async () => {
    const doc = defaultDoc()
    doc.content.headline = 'Legacy Banner Headline v1'
    doc.content.categoryId = '04'

    const v1File = {
      app: 'esb-banner-studio',
      version: 1,
      savedAt: '2026-10-01T12:00:00.000Z',
      format: 'web',
      doc,
      images: [],
    }

    await applyProject(JSON.stringify(v1File), 'legacy-test', 'C:/test/legacy-test.esb')

    const currentDoc = useStore.getState().doc
    const currentFormat = useStore.getState().format
    const currentName = useStore.getState().projectName

    expect(currentFormat).toBe('web')
    expect(currentDoc.content.headline).toBe('Legacy Banner Headline v1')
    expect(currentDoc.content.categoryId).toBe('04')
    expect(currentName).toBe('legacy-test')
  })

  it('applies v2 project file accurately', async () => {
    const doc = defaultDoc()
    doc.content.headline = 'Studio Project v2 Headline'
    doc.content.categoryId = '05'

    const v2File = {
      app: 'esb-banner-studio',
      version: 2,
      savedAt: '2026-10-22T21:00:00.000Z',
      title: 'v2-test',
      format: 'lower-third',
      doc,
      graphics: {
        format: 'lower-third',
        doc,
      },
      images: [],
    }

    await applyProject(JSON.stringify(v2File), 'v2-test', 'C:/test/v2-test.esb')

    const currentDoc = useStore.getState().doc
    const currentFormat = useStore.getState().format
    const currentName = useStore.getState().projectName

    expect(currentFormat).toBe('lower-third')
    expect(currentDoc.content.headline).toBe('Studio Project v2 Headline')
    expect(currentDoc.content.categoryId).toBe('05')
    expect(currentName).toBe('v2-test')
  })

  it('rejects foreign or corrupted project files', async () => {
    const foreign = JSON.stringify({ app: 'other-app', version: 1 })
    await expect(applyProject(foreign, null, null)).rejects.toThrow('This is not an ESB Studio project file.')
  })
})
