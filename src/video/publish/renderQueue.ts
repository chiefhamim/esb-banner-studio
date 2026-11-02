// The render queue: several sizes of one video, rendered one after another in the background while the editor keeps
// working. Each output is the project as it was when it was queued (a snapshot), in its own shape (sizes.ts). Progress is
// per output; an output can be cancelled; a finished one is a render registered in main by id, ready to show in its folder
// and to publish. The list is kept on this PC; a render cut off by closing the app is marked interrupted (its snapshot lived
// in memory, so it is queued again from the open project), never shown as done.
import { create } from 'zustand'
import type { AspectRatio, VideoProject } from '../timeline'
import { flattenCompounds } from '../timeline'
import { variantFor } from '../sizes'
import { exportBlocker, exportFilename, exportTimelineVideo } from '../exportVideo'
import { useVideoStore } from '../videoStore'
import { videoBridge } from '../media'

export type OutputStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'
export interface QueueOutput { id: string; aspect: AspectRatio; fileName: string; status: OutputStatus; progress: number; error?: string; renderId?: string; size?: number; startedAt?: number; finishedAt?: number }
export interface QueueJob { id: string; name: string; at: number; outputs: QueueOutput[] }

const KEY = 'esb-banner-studio/video/queue/v1'
const MAX_JOBS = 30

function load(): QueueJob[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.slice(0, MAX_JOBS).map((j: QueueJob) => ({
      ...j,
      // whatever was queued or running when the app closed has no snapshot any more
      outputs: (j.outputs ?? []).map((o) => (o.status === 'queued' || o.status === 'running' ? { ...o, status: 'interrupted' as const, progress: 0, error: 'The app was closed before this finished. Queue it again from the open project.' } : o)),
    }))
  } catch { return [] }
}

const snapshots = new Map<string, VideoProject>() // output id → the project to render (memory only)
const controllers = new Map<string, AbortController>()
let pumping = false

interface QueueState {
  jobs: QueueJob[]
  /** True while an output is rendering (the Export sheet waits for it, since both write through one export writer). */
  busy: boolean
  enqueue: (project: VideoProject, aspects: AspectRatio[]) => { queued: number; refused?: string }
  cancel: (outputId: string) => void
  remove: (jobId: string) => void
  clearFinished: () => void
}

const persist = (jobs: QueueJob[]) => { try { localStorage.setItem(KEY, JSON.stringify(jobs.slice(0, MAX_JOBS))) } catch { /* storage full or off */ } }
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export const useRenderQueue = create<QueueState>((set, get) => {
  const patchOutput = (id: string, patch: Partial<QueueOutput>) => set((s) => {
    const jobs = s.jobs.map((j) => (j.outputs.some((o) => o.id === id) ? { ...j, outputs: j.outputs.map((o) => (o.id === id ? { ...o, ...patch } : o)) } : j))
    persist(jobs)
    return { jobs }
  })

  async function renderOne(out: QueueOutput) {
    const snap = snapshots.get(out.id)
    const b = videoBridge()
    if (!snap) { patchOutput(out.id, { status: 'interrupted', error: 'This render has no project to work from. Queue it again.' }); return }
    const project = flattenCompounds(variantFor(snap, out.aspect))
    const blocked = exportBlocker(project)
    if (blocked) { patchOutput(out.id, { status: 'failed', error: blocked }); return }
    if (!b?.videoRenderBegin || !b.videoExportWrite || !b.videoExportEnd) { patchOutput(out.id, { status: 'failed', error: 'The render queue needs the desktop app.' }); return }
    // one writer for the whole app: wait while the Export sheet is rendering
    while (useVideoStore.getState().exporting) await new Promise((r) => setTimeout(r, 500))
    const ctl = new AbortController()
    controllers.set(out.id, ctl)
    const container = project.exportPreset?.container ?? 'mp4'
    let job2: { id: string; path: string } | null = null
    try { job2 = await b.videoRenderBegin(exportFilename(project, container).replace(/\.[a-z0-9]+$/i, ''), container) } catch (e) { patchOutput(out.id, { status: 'failed', error: String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }); controllers.delete(out.id); return }
    if (!job2) { patchOutput(out.id, { status: 'failed', error: 'The render could not be started.' }); controllers.delete(out.id); return }
    const id = job2.id
    patchOutput(out.id, { status: 'running', progress: 0, startedAt: Date.now(), error: undefined })
    let last = 0
    try {
      const writable = new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({ write: async (chunk) => { await b.videoExportWrite!(id, chunk.position, chunk.data) } })
      const res = await exportTimelineVideo(project, (cur, total) => {
        const now = performance.now()
        if (cur < total && now - last < 400) return
        last = now
        patchOutput(out.id, { progress: Math.round((cur / Math.max(1, total)) * 100) })
      }, { container, signal: ctl.signal, writable, fps: project.exportPreset?.fps })
      const savedTo = await b.videoExportEnd!(id, true)
      if (!savedTo) throw new Error('The file could not be finished on disk.')
      const list = await (window as unknown as { esb?: { vpubRenders?: () => Promise<{ renders?: { id: string; name: string; size: number }[] }> } }).esb?.vpubRenders?.()
      const name = savedTo.split(/[\\/]/).pop()
      const made = list?.renders?.find((r) => r.name === name)
      patchOutput(out.id, { status: 'done', progress: 100, renderId: made?.id, size: res.size, fileName: name ?? out.fileName, finishedAt: Date.now() })
    } catch (err) {
      await b.videoExportEnd!(id, false).catch(() => null)
      const aborted = (err as Error).name === 'AbortError' || ctl.signal.aborted
      patchOutput(out.id, { status: aborted ? 'cancelled' : 'failed', progress: aborted ? 0 : get().jobs.flatMap((j) => j.outputs).find((o) => o.id === out.id)?.progress ?? 0, error: aborted ? undefined : (err as Error).message || 'The render failed.' })
    } finally {
      controllers.delete(out.id)
      snapshots.delete(out.id)
    }
  }

  async function pump() {
    if (pumping) return
    pumping = true
    set({ busy: true })
    try {
      for (;;) {
        const next = get().jobs.flatMap((j) => j.outputs.map((o) => ({ j, o }))).find(({ o }) => o.status === 'queued')
        if (!next) break
        await renderOne(next.o)
      }
    } finally {
      pumping = false
      set({ busy: false })
    }
  }

  return {
    jobs: load(),
    busy: false,
    enqueue: (project, aspects) => {
      const unique = [...new Set(aspects)]
      if (!unique.length) return { queued: 0, refused: 'Choose at least one size.' }
      const blocked = exportBlocker(flattenCompounds(project))
      if (blocked) return { queued: 0, refused: blocked }
      const jobId = stamp()
      const outputs: QueueOutput[] = unique.map((aspect) => {
        const id = `${jobId}-${aspect.replace(':', 'x')}`
        snapshots.set(id, project)
        return { id, aspect, fileName: exportFilename({ ...project, aspect }, project.exportPreset?.container ?? 'mp4'), status: 'queued', progress: 0 }
      })
      set((s) => { const jobs = [{ id: jobId, name: project.name || 'Video', at: Date.now(), outputs }, ...s.jobs].slice(0, MAX_JOBS); persist(jobs); return { jobs } })
      void pump()
      return { queued: outputs.length }
    },
    cancel: (outputId) => {
      const ctl = controllers.get(outputId)
      if (ctl) { ctl.abort(); return }
      // not started yet: just take it out of the line
      snapshots.delete(outputId)
      patchOutput(outputId, { status: 'cancelled', progress: 0 })
    },
    remove: (jobId) => set((s) => { const jobs = s.jobs.filter((j) => j.id !== jobId || j.outputs.some((o) => o.status === 'running' || o.status === 'queued')); persist(jobs); return { jobs } }),
    clearFinished: () => set((s) => { const jobs = s.jobs.filter((j) => j.outputs.some((o) => o.status === 'running' || o.status === 'queued')); persist(jobs); return { jobs } }),
  }
})
