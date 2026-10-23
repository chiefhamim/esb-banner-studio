import { describe, it, expect } from 'vitest'
import { buildScene, defaultDoc } from '../../src/core/templates'
import { getFormat } from '../../src/core/tokens'
import { renderScene } from '../../src/core/render'
import type { ImageEl } from '../../src/core/types'

describe('New Template Formats (Phase 1)', () => {
  const doc = defaultDoc()

  describe('lower-third format', () => {
    it('is registered with 1920x1080 dimensions and overlay family', () => {
      const fmt = getFormat('lower-third')
      expect(fmt.w).toBe(1920)
      expect(fmt.h).toBe(1080)
      expect(fmt.family).toBe('overlay')
    })

    it('builds a scene with transparent background', () => {
      const scene = buildScene('lower-third', doc)
      expect(scene.format).toBe('lower-third')
      expect(scene.w).toBe(1920)
      expect(scene.h).toBe(1080)
      expect(scene.background).toBe('transparent')
    })

    it('preserves exact ESB logo aspect ratio (2.875:1)', () => {
      const scene = buildScene('lower-third', doc)
      const logo = scene.elements.find((e) => e.id === 'logo') as ImageEl
      expect(logo).toBeDefined()
      expect(logo.fit).toBe('contain')
      const ratio = logo.w / logo.h
      expect(ratio).toBeCloseTo(2.875, 2)
    })

    it('renders with clear alpha 0 at corner pixels', () => {
      const scene = buildScene('lower-third', doc)
      // Test drawing onto a dummy canvas-like 2D context
      let cleared = false
      let filledTransparent = false
      const mockCtx: any = {
        save: () => {},
        restore: () => {},
        clearRect: (x: number, y: number, w: number, h: number) => {
          if (x === 0 && y === 0 && w === 1920 && h === 1080) cleared = true
        },
        fillRect: (_x: number, _y: number, _w: number, _h: number) => {
          if (mockCtx.fillStyle === 'transparent') filledTransparent = true
        },
        roundRect: () => {},
        rect: () => {},
        drawImage: () => {},
        fillText: () => {},
        measureText: () => ({ width: 0 }),
        beginPath: () => {},
        closePath: () => {},
        stroke: () => {},
        fill: () => {},
        clip: () => {},
        setTransform: () => {},
        resetTransform: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
      }

      renderScene(mockCtx, scene, {} as any)
      expect(cleared).toBe(true)
      expect(filledTransparent).toBe(false)
    })
  })

  describe('title-card format', () => {
    it('is registered with 1920x1080 dimensions and card family', () => {
      const fmt = getFormat('title-card')
      expect(fmt.w).toBe(1920)
      expect(fmt.h).toBe(1080)
      expect(fmt.family).toBe('card')
    })

    it('builds a title scene with dark graphite background and logo ratio preserved', () => {
      const scene = buildScene('title-card', doc)
      expect(scene.background).toBe('#15171c')
      const logo = scene.elements.find((e) => e.id === 'logo') as ImageEl
      expect(logo).toBeDefined()
      expect(logo.fit).toBe('contain')
      expect(logo.w / logo.h).toBeCloseTo(2.875, 2)
    })
  })

  describe('end-card format', () => {
    it('is registered with 1920x1080 dimensions and card family', () => {
      const fmt = getFormat('end-card')
      expect(fmt.w).toBe(1920)
      expect(fmt.h).toBe(1080)
      expect(fmt.family).toBe('card')
    })

    it('builds an end card scene with CTA and centered logo', () => {
      const scene = buildScene('end-card', doc)
      expect(scene.background).toBe('#15171c')
      const logo = scene.elements.find((e) => e.id === 'logo') as ImageEl
      expect(logo).toBeDefined()
      expect(logo.fit).toBe('contain')
      expect(logo.w / logo.h).toBeCloseTo(2.875, 2)
      expect(logo.x).toBe((1920 - logo.w) / 2)
    })
  })

  describe('translucent & movable headline on canvas', () => {
    it('attaches bgPill to headline and expands photo full-bleed when bandOpacity is 0', () => {
      const customDoc = defaultDoc()
      customDoc.content.headlineBg = true
      customDoc.content.headlineBgAlpha = 0.8
      customDoc.content.bandOpacity = 0
      customDoc.overrides['fb45:headline'] = { dx: 0, dy: -310 }

      const scene = buildScene('fb45', customDoc)
      const headline = scene.elements.find((e) => e.id === 'headline') as any
      const photos = scene.elements.find((e) => e.id === 'photos') as any
      const band = scene.elements.find((e) => e.id === 'band') as any

      expect(headline.bgPill).toBeDefined()
      expect(headline.bgPill.alpha).toBe(0.8)
      expect(headline.color).toBe('#ffffff')
      expect(band.opacity).toBe(0)
      expect(photos.h).toBeGreaterThan(800)
    })
  })
})
