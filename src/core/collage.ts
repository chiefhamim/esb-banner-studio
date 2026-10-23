export interface Rect { x: number; y: number; w: number; h: number }

export interface CollagePreset {
  id: string
  name: string
  count: number
  /** returns the slot rectangles inside a (w x h) area, separated by `gap` px */
  layout: (w: number, h: number, g: number) => Rect[]
}

const halves = (total: number, g: number): [number, number] => {
  const a = (total - g) / 2
  return [a, a]
}
const split = (total: number, g: number, ratio: number): [number, number] => {
  const a = (total - g) * ratio
  return [a, total - g - a]
}

export const COLLAGES: CollagePreset[] = [
  { id: 'single', name: 'Single photo', count: 1, layout: (w, h) => [{ x: 0, y: 0, w, h }] },
  {
    id: 'two-cols', name: 'Two side by side', count: 2,
    layout: (w, h, g) => { const [a, b] = halves(w, g); return [{ x: 0, y: 0, w: a, h }, { x: a + g, y: 0, w: b, h }] },
  },
  {
    id: 'two-rows', name: 'Two stacked', count: 2,
    layout: (w, h, g) => { const [a, b] = halves(h, g); return [{ x: 0, y: 0, w, h: a }, { x: 0, y: a + g, w, h: b }] },
  },
  {
    id: 'big-left-2', name: 'Big left + 2 right', count: 3,
    layout: (w, h, g) => {
      const [a, b] = split(w, g, 0.62); const [c, d] = halves(h, g)
      return [{ x: 0, y: 0, w: a, h }, { x: a + g, y: 0, w: b, h: c }, { x: a + g, y: c + g, w: b, h: d }]
    },
  },
  {
    id: 'big-right-2', name: 'Big right + 2 left', count: 3,
    layout: (w, h, g) => {
      const [a, b] = split(w, g, 0.38); const [c, d] = halves(h, g)
      return [{ x: 0, y: 0, w: a, h: c }, { x: 0, y: c + g, w: a, h: d }, { x: a + g, y: 0, w: b, h }]
    },
  },
  {
    id: 'big-top-2', name: 'Big top + 2 below', count: 3,
    layout: (w, h, g) => {
      const [a, b] = split(h, g, 0.62); const [c, d] = halves(w, g)
      return [{ x: 0, y: 0, w, h: a }, { x: 0, y: a + g, w: c, h: b }, { x: c + g, y: a + g, w: d, h: b }]
    },
  },
  {
    id: 'big-bottom-2', name: 'Big bottom + 2 above', count: 3,
    layout: (w, h, g) => {
      const [a, b] = split(h, g, 0.38); const [c, d] = halves(w, g)
      return [{ x: 0, y: 0, w: c, h: a }, { x: c + g, y: 0, w: d, h: a }, { x: 0, y: a + g, w, h: b }]
    },
  },
  {
    id: 'three-cols', name: 'Three columns', count: 3,
    layout: (w, h, g) => { const c = (w - 2 * g) / 3; return [0, 1, 2].map((i) => ({ x: i * (c + g), y: 0, w: c, h })) },
  },
  {
    id: 'grid-2x2', name: 'Grid 2 × 2', count: 4,
    layout: (w, h, g) => {
      const [a, b] = halves(w, g); const [c, d] = halves(h, g)
      return [{ x: 0, y: 0, w: a, h: c }, { x: a + g, y: 0, w: b, h: c }, { x: 0, y: c + g, w: a, h: d }, { x: a + g, y: c + g, w: b, h: d }]
    },
  },
  {
    id: 'big-left-3', name: 'Big left + 3 right', count: 4,
    layout: (w, h, g) => {
      const [a, b] = split(w, g, 0.6); const r = (h - 2 * g) / 3
      return [{ x: 0, y: 0, w: a, h }, ...[0, 1, 2].map((i) => ({ x: a + g, y: i * (r + g), w: b, h: r }))]
    },
  },
  {
    id: 'big-top-3', name: 'Big top + 3 below', count: 4,
    layout: (w, h, g) => {
      const [a, b] = split(h, g, 0.64); const c = (w - 2 * g) / 3
      return [{ x: 0, y: 0, w, h: a }, ...[0, 1, 2].map((i) => ({ x: i * (c + g), y: a + g, w: c, h: b }))]
    },
  },
]

export const getCollage = (id: string): CollagePreset => COLLAGES.find((c) => c.id === id) ?? COLLAGES[0]
