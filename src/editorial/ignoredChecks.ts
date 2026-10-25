// The checks an editor has set aside, per story, kept on this computer so a restart does not bring them back.

import { create } from 'zustand'

const KEY = 'esb-banner-studio/editorial/ignored-checks'
type Map = Record<string, string[]>
const load = (): Map => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Map } catch { return {} } }
const save = (m: Map) => { try { localStorage.setItem(KEY, JSON.stringify(m)) } catch { /* ignore */ } }

export const useIgnoredChecks = create<{
  byStory: Map
  ignore: (story: string, ids: string[]) => void
  restore: (story: string, ids?: string[]) => void
}>((set, get) => ({
  byStory: load(),
  ignore: (story, ids) => { const next = { ...get().byStory, [story]: Array.from(new Set([...(get().byStory[story] ?? []), ...ids])) }; save(next); set({ byStory: next }) },
  restore: (story, ids) => {
    const cur = get().byStory[story] ?? []
    const left = ids ? cur.filter((x) => !ids.includes(x)) : []
    const next = { ...get().byStory }
    if (left.length) next[story] = left; else delete next[story]
    save(next); set({ byStory: next })
  },
}))
