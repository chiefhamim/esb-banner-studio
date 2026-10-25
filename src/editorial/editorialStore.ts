// Editorial Desk Zustand store with undo, fact tracking, banner coordination,
// and full live integration with esbpowerline.com CMS.
import { create } from 'zustand'
import type { ExtractedArticle, ExtractedImage, ExtractionMeta } from './extract'
import { extractFactTable, verifyDraftAgainstSource } from './facts'
import type { FactItem, DiscrepancyFlag } from './facts'
import { detectCategory, suggestHighlight } from '../core/newsroom'
import { CATEGORIES } from '../core/tokens'
import { generateSlug, buildSeoFromEnglishStory, stripSiteSuffix } from './translator'
import { loadAiSettings, saveAiSettings } from './aiProviders'
import { relinkCaptions } from './aiDesk'
import type { AiProviderId, AiSettings } from './aiProviders'
import { syncArticlePhotosToBanner, importImageToBanner } from './automation'
import { useStore } from '../store'
import { useShellStore } from '../shell/shellStore'
import { autoDesk } from './deskFlag'
import {
  probeSite,
  fetchLiveArticles,
  fetchLiveArticleBody,
  checkSlugAvailability,
  getStoredStaffSession,
  authenticateStaff,
  signOutStaff,
  type SiteStatus,
  type StaffSession,
  type LiveArticleSummary,
} from './siteApi'

export interface EditorialDraft {
  headline: string          // strictly <= 104 characters
  deck: string              // strictly <= 200 characters
  slug: string              // strictly <= 80 characters
  focusKeywords: string     // comma-separated tags (sent to the CMS as tags)
  /** The one phrase this story should rank for (CMS "Focus keyword"); the SEO checks measure against it. */
  focusKeyphrase: string
  metaTitle: string         // SEO meta title
  metaDescription: string   // SEO meta description
  body: string              // full English story body
  byline: string
  /** Credit the story to "ESB News Desk" instead of the signed-in editor (the CMS's tick option). */
  postAsNewsDesk: boolean
  credit: string
  /** Alt text for the featured image (seo.heroImage.alt): what the photo shows, in English. */
  imageAlt: string
  /** Caption printed under the photo on the site (seo.heroImage.caption); empty prints none. */
  imageCaption: string
  tags: string[]
  social: {
    facebook: string
    x: string
    linkedin: string
    telegram: string
  }
}

export interface EditorialChecklist {
  sourcesVerified: boolean
  figuresChecked: boolean
  quotesChecked: boolean
  namesChecked: boolean
  attributionKept: boolean
  imagesCleared: boolean
}

export function matchCategoryNameToId(catName: string): string {
  if (!catName) return '01'
  const norm = catName.toLowerCase()
  const found = CATEGORIES.find(
    (c) => c.name.toLowerCase() === norm || norm.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(norm)
  )
  if (found) return found.id
  if (norm.includes('fossil') || norm.includes('oil') || norm.includes('gas') || norm.includes('commodity')) return '03'
  if (norm.includes('renew') || norm.includes('solar') || norm.includes('wind')) return '04'
  if (norm.includes('transmission') || norm.includes('grid')) return '05'
  if (norm.includes('nuclear')) return '06'
  if (norm.includes('generation') || norm.includes('power')) return '02'
  if (norm.includes('policy') || norm.includes('regulat')) return '01'
  return '01'
}

interface EditorialState {
  source: {
    url: string | null
    title: string
    deck: string
    rawText: string
    paragraphs: string[]
    images: ExtractedImage[]
    factTable: FactItem[]
    /** How the story was recovered from the page (method, language, warnings); absent for pasted text. */
    extraction?: ExtractionMeta
  } | null

  draft: EditorialDraft
  discrepancies: DiscrepancyFlag[]
  checklist: EditorialChecklist
  /** Per-provider keys and models, which provider does which job, and the editor's translation prompt (aiProviders.ts). */
  ai: AiSettings
  /** Live link: headline / credit / caption stay identical in the Editorial draft and the Graphics banner, both ways. */
  bannerLink: boolean
  /** True while the sector desk is auto-detected from the story; picking a desk by hand turns it off. */
  deskAuto: boolean
  translationProvider: AiProviderId | 'neural' | 'offline' | null
  modelUsed: string | null

  // Live site communication & staff session
  siteStatus: SiteStatus
  staffSession: StaffSession | null
  liveArticles: LiveArticleSummary[]
  siteCategories: string[]
  slugStatus: 'idle' | 'checking' | 'available' | 'taken'

  // CMS surface navigation & filters
  cmsSurfaceTab: 'editor' | 'stories' | 'dashboard'
  feedFilterCategory: string
  feedSearchQuery: string

  setCmsSurfaceTab: (tab: 'editor' | 'stories' | 'dashboard') => void
  setFeedFilterCategory: (cat: string) => void
  setFeedSearchQuery: (query: string) => void

  checkConnection: () => Promise<void>
  syncFromLiveFeed: () => Promise<void>
  loginStaff: (email: string, pass: string) => Promise<{ success: boolean; error?: string }>
  logoutStaff: () => void
  checkSlug: (slug: string) => Promise<void>

  loadLiveArticleForEdit: (article: LiveArticleSummary) => Promise<void>
  pushLiveArticleToGraphics: (article: LiveArticleSummary) => Promise<void>

  setSourceArticle: (article: ExtractedArticle, url?: string) => void
  updateSourceManual: (title: string, deck: string, paragraphs: string[]) => void
  setDraftField: <K extends keyof EditorialDraft>(key: K, value: EditorialDraft[K]) => void
  setSocialCaption: (platform: keyof EditorialDraft['social'], text: string) => void
  toggleChecklist: (key: keyof EditorialChecklist) => void
  setAiSettings: (s: AiSettings) => void
  setBannerLink: (on: boolean) => void
  setDeskAuto: (on: boolean) => void
  /** Pick the sector desk by hand (updates the banner chip and stops auto-detection). */
  setDesk: (categoryId: string) => void
  /** Re-detect the desk from the current story. */
  autoDetectDesk: () => string
  setTranslationMeta: (provider: AiProviderId | 'neural' | 'offline' | null, modelUsed?: string | null) => void
  reverify: () => void
  applyDraftToBanner: () => void
  clear: () => void
}

const DEFAULT_DRAFT: EditorialDraft = {
  headline: '',
  deck: '',
  slug: '',
  focusKeywords: '',
  focusKeyphrase: '',
  metaTitle: '',
  metaDescription: '',
  body: '',
  byline: '',
  postAsNewsDesk: false,
  credit: '',
  imageAlt: '',
  imageCaption: '',
  tags: [],
  social: {
    facebook: '',
    x: '',
    linkedin: '',
    telegram: '',
  },
}

const DEFAULT_CHECKLIST: EditorialChecklist = {
  sourcesVerified: false,
  figuresChecked: false,
  quotesChecked: false,
  namesChecked: false,
  attributionKept: false,
  imagesCleared: false,
}

const PERSIST_KEY = 'esb-banner-studio/editorial/v1'

interface Persisted {
  source: EditorialState['source']
  draft: EditorialDraft
  checklist: EditorialChecklist
  bannerLink: boolean
  deskAuto: boolean
  translationProvider: EditorialState['translationProvider']
  modelUsed: string | null
}

function loadPersisted(): Partial<Persisted> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PERSIST_KEY) : null
    if (!raw) return {}
    const p = JSON.parse(raw) as Partial<Persisted>
    if (p.draft) p.draft = { ...DEFAULT_DRAFT, ...p.draft, social: { ...DEFAULT_DRAFT.social, ...(p.draft.social || {}) } }
    // drafts saved before the site dropped the title suffix still carry " | ESB PowerLine"
    if (p.draft) p.draft.metaTitle = stripSiteSuffix(p.draft.metaTitle)
    if (p.checklist) p.checklist = { ...DEFAULT_CHECKLIST, ...p.checklist }
    return p
  } catch {
    return {}
  }
}

const restored = loadPersisted()
/** True when the last session's draft was brought back on launch (the workspace tells the editor once). */
export const restoredDraftOnLaunch = !!(restored.draft?.headline || restored.source)

export const useEditorialStore = create<EditorialState>((set, get) => ({
  source: restored.source ?? null,
  draft: restored.draft ?? DEFAULT_DRAFT,
  discrepancies: [],
  checklist: restored.checklist ?? DEFAULT_CHECKLIST,
  bannerLink: restored.bannerLink ?? true,
  deskAuto: restored.deskAuto ?? true,
  ai: loadAiSettings(),
  translationProvider: restored.translationProvider ?? null,
  modelUsed: restored.modelUsed ?? null,

  siteStatus: {
    connected: false,
    latencyMs: 0,
    lastChecked: 'Never',
    statusText: 'Connecting to esbpowerline.com…',
  },
  staffSession: typeof localStorage !== 'undefined' ? getStoredStaffSession() : null,
  liveArticles: [],
  siteCategories: [],
  slugStatus: 'idle',

  cmsSurfaceTab: 'editor',
  feedFilterCategory: 'ALL',
  feedSearchQuery: '',

  setCmsSurfaceTab: (tab) => set({ cmsSurfaceTab: tab }),
  setFeedFilterCategory: (cat) => set({ feedFilterCategory: cat }),
  setFeedSearchQuery: (query) => set({ feedSearchQuery: query }),

  checkConnection: async () => {
    const status = await probeSite(get().staffSession)
    set({ siteStatus: status })
  },

  syncFromLiveFeed: async () => {
    const { articles, categories } = await fetchLiveArticles()
    if (articles.length > 0) {
      set({ liveArticles: articles, siteCategories: categories })
    }
  },

  loginStaff: async (email, pass) => {
    const res = await authenticateStaff(email, pass)
    if (res.success && res.session) {
      set({ staffSession: res.session })
      return { success: true }
    }
    return { success: false, error: res.error }
  },

  logoutStaff: () => {
    const session = get().staffSession
    set({ staffSession: null })
    // ends the session on the site's auth service and in the CMS window, not just here
    void signOutStaff(session)
    void (window as unknown as { esb?: { siteSignOut?: () => Promise<boolean> } }).esb?.siteSignOut?.()
  },

  checkSlug: async (slug) => {
    if (!slug || slug.trim().length < 3) {
      set({ slugStatus: 'idle' })
      return
    }
    set({ slugStatus: 'checking' })
    const res = await checkSlugAvailability(slug)
    set({ slugStatus: res === 'unknown' ? 'idle' : res })
  },

  loadLiveArticleForEdit: async (article) => {
    const catId = matchCategoryNameToId(article.category)
    const cleanHeadline = article.title.trim().slice(0, 104)
    const cleanDeck = (article.description || '').trim().slice(0, 200)
    const cleanSlug = (article.slug || generateSlug(cleanHeadline, 80)).slice(0, 80)
    const cleanByline = article.author || 'Mehedi Hasan Hamim'
    const cleanCredit = ''

    // Immediate draft populate
    set((s) => ({
      cmsSurfaceTab: 'editor',
      draft: {
        ...s.draft,
        headline: cleanHeadline,
        deck: cleanDeck,
        slug: cleanSlug,
        byline: cleanByline,
        credit: cleanCredit,
        body: cleanDeck, // initially fallback to excerpt
        metaTitle: cleanHeadline,
        metaDescription: cleanDeck,
      },
    }))

    // Sync to graphics store banner
    const hl = suggestHighlight(cleanHeadline)
    useStore.getState().setContent({
      headline: cleanHeadline,
      categoryId: catId,
      highlight: hl || useStore.getState().doc.content.highlight,
      credit: cleanCredit,
      caption: `${cleanHeadline}\n\n${cleanDeck}`,
    })

    // If there is an image, pull it into banner canvas
    if (article.imageUrl) {
      void importImageToBanner(article.imageUrl, `${cleanSlug}.webp`, { slotIndex: 0 })
    }

    // Asynchronously fetch full body from esbpowerline.com/articles/[slug]
    if (article.slug) {
      try {
        const fullBody = await fetchLiveArticleBody(article.slug)
        if (fullBody && fullBody.length > 50) {
          set((s) => ({
            draft: {
              ...s.draft,
              body: fullBody,
            },
          }))
        }
      } catch {}
    }
  },

  pushLiveArticleToGraphics: async (article) => {
    const catId = matchCategoryNameToId(article.category)
    const cleanHeadline = article.title.trim().slice(0, 104)
    const cleanDeck = (article.description || '').trim().slice(0, 200)
    const hl = suggestHighlight(cleanHeadline)

    useStore.getState().setContent({
      headline: cleanHeadline,
      categoryId: catId,
      highlight: hl || useStore.getState().doc.content.highlight,
      credit: '',
      caption: `${cleanHeadline}\n\n${cleanDeck}`,
    })

    if (article.imageUrl) {
      await importImageToBanner(article.imageUrl, `${article.slug || 'photo'}.webp`, { slotIndex: 0 })
    }

    useShellStore.getState().setWorkspace('graphics')
  },

  setSourceArticle: (article, url) => {
    const rawText = [article.title, article.deck, ...article.paragraphs].filter(Boolean).join('\n\n')
    const factTable = extractFactTable(rawText)

    const isBengali = /[\u0980-\u09FF]/.test(`${article.title} ${article.deck || ''} ${article.paragraphs.slice(0, 2).join(' ')}`)
    const bodyStr = article.paragraphs.join('\n\n')
    const currentDraft = get().draft

    let nextDraft: EditorialDraft = currentDraft
    // Only seed draft directly from source if the source is already English AND draft is currently empty
    if (!isBengali && !currentDraft.headline.trim()) {
      const seo = buildSeoFromEnglishStory(article.title, article.deck || '', bodyStr)
      nextDraft = {
        headline: article.title.slice(0, 104),
        deck: article.deck ? article.deck.slice(0, 200) : '',
        slug: seo.slug,
        focusKeywords: seo.focusKeywords,
        focusKeyphrase: seo.focusKeywords.split(',')[0]?.trim() ?? '',
        metaTitle: seo.metaTitle,
        metaDescription: seo.metaDescription,
        body: bodyStr,
        byline: article.byline || currentDraft.byline || '',
        postAsNewsDesk: currentDraft.postAsNewsDesk,
        credit: article.images[0]?.credit || article.publisher || currentDraft.credit || '',
        // an English source's own alt text and caption describe its photo; a Bengali one would need translating first
        imageAlt: article.images[0]?.alt && article.images[0].alt.trim() !== article.title.trim() ? article.images[0].alt.trim().slice(0, 160) : '',
        imageCaption: article.images[0]?.caption?.trim().slice(0, 240) || '',
        tags: seo.focusKeywords ? seo.focusKeywords.split(',').map((k) => k.trim()).filter(Boolean) : [],
        social: {
          facebook: `${article.title}\n\n${article.deck || ''}`,
          x: article.title.slice(0, 240),
          linkedin: `${article.title}\n\n${article.deck || ''}`,
          telegram: article.title,
        },
      }
    } else if (isBengali) {
      // Preserve any existing English draft or metadata while updating byline/credit if empty
      nextDraft = {
        ...currentDraft,
        byline: currentDraft.byline || article.byline || '',
        credit: currentDraft.credit || article.images[0]?.credit || article.publisher || '',
      }
    }

    const discrepancies = nextDraft.headline
      ? verifyDraftAgainstSource(
          `${nextDraft.headline} ${nextDraft.deck} ${nextDraft.body}`,
          rawText,
          factTable
        )
      : []

    set({
      source: {
        url: url || article.canonicalUrl || null,
        title: article.title,
        deck: article.deck || '',
        rawText,
        paragraphs: article.paragraphs,
        images: article.images,
        factTable,
        extraction: article.meta,
      },
      draft: nextDraft,
      discrepancies,
      checklist: DEFAULT_CHECKLIST,
    })

    if (article.images && article.images.length > 0) {
      void syncArticlePhotosToBanner(article.images)
    }
  },

  updateSourceManual: (title, deck, paragraphs) => {
    const rawText = [title, deck, ...paragraphs].filter(Boolean).join('\n\n')
    const factTable = extractFactTable(rawText)
    set((s) => ({
      source: {
        url: s.source?.url || null,
        title,
        deck,
        rawText,
        paragraphs,
        images: s.source?.images || [],
        factTable,
        extraction: s.source?.extraction,
      },
      discrepancies: s.draft.headline
        ? verifyDraftAgainstSource(`${s.draft.headline} ${s.draft.deck} ${s.draft.body}`, rawText, factTable)
        : [],
    }))
  },

  setDraftField: (key, value) => {
    set((s) => {
      const nextDraft = { ...s.draft, [key]: value }
      if (key === 'headline' && (!s.draft.slug || s.draft.slug === generateSlug(s.draft.headline, 80))) {
        nextDraft.slug = generateSlug(value as string, 80)
      }
      if (key === 'focusKeywords' && typeof value === 'string') {
        nextDraft.tags = value.split(',').map((k) => k.trim()).filter(Boolean)
      }
      // captions link the article by its slug: a new slug moves every caption's link with it, or the posts would
      // point at an address the story was never published under
      if (nextDraft.slug !== s.draft.slug) nextDraft.social = relinkCaptions(nextDraft.social, nextDraft.slug)
      let nextDiscrepancies = s.discrepancies
      if (s.source) {
        nextDiscrepancies = verifyDraftAgainstSource(
          `${nextDraft.headline} ${nextDraft.deck} ${nextDraft.body}`,
          s.source.rawText,
          s.source.factTable
        )
      }
      return { draft: nextDraft, discrepancies: nextDiscrepancies }
    })
  },

  setSocialCaption: (platform, text) => {
    set((s) => ({
      draft: {
        ...s.draft,
        social: {
          ...s.draft.social,
          [platform]: text,
        },
      },
    }))
  },

  toggleChecklist: (key) => {
    set((s) => ({
      checklist: {
        ...s.checklist,
        [key]: !s.checklist[key],
      },
    }))
  },

  setAiSettings: (ai) => {
    saveAiSettings(ai)
    set({ ai: loadAiSettings() })
  },

  setBannerLink: (on) => set({ bannerLink: on }),
  setDeskAuto: (on) => set({ deskAuto: on }),
  setDesk: (categoryId) => {
    set({ deskAuto: false })
    useStore.getState().setContent({ categoryId })
  },
  autoDetectDesk: () => {
    const { draft, source } = get()
    const text = `${draft.headline} ${draft.deck} ${draft.body} ${source?.title ?? ''}`
    const cat = detectCategory(text) || useStore.getState().doc.content.categoryId
    set({ deskAuto: true })
    autoDesk(() => useStore.getState().setContent({ categoryId: cat }))
    return cat
  },

  setTranslationMeta: (provider, modelUsed = null) => {
    set({ translationProvider: provider, modelUsed })
  },

  reverify: () => {
    const { source, draft } = get()
    if (!source) return
    const discrepancies = verifyDraftAgainstSource(
      `${draft.headline} ${draft.deck} ${draft.body}`,
      source.rawText,
      source.factTable
    )
    set({ discrepancies })
  },

  applyDraftToBanner: () => {
    const { draft, source } = get()
    if (draft.headline) {
      const current = useStore.getState().doc.content.categoryId
      const cat = get().deskAuto ? detectCategory(`${draft.headline} ${draft.deck} ${draft.body}`) || current : current
      const hl = suggestHighlight(draft.headline)

      const curHl = useStore.getState().doc.content.highlight
      autoDesk(() => useStore.getState().setContent({
        headline: draft.headline,
        categoryId: cat,
        highlight: curHl && draft.headline.includes(curHl) ? curHl : hl || curHl,
        credit: draft.credit || useStore.getState().doc.content.credit,
        caption: draft.social.facebook || useStore.getState().doc.content.caption,
      }))

      if (source?.images && source.images.length > 0) {
        void syncArticlePhotosToBanner(source.images)
      }

      useStore.getState().setNotice('Updated graphics banner & photos from Editorial Draft!')
    }
  },

  clear: () => {
    set({
      source: null,
      draft: DEFAULT_DRAFT,
      discrepancies: [],
      checklist: DEFAULT_CHECKLIST,
      translationProvider: null,
      modelUsed: null,
      deskAuto: true,
    })
  },
}))

// Autosave: the draft survives restarts and crashes (debounced; images are URLs so this stays small).
if (typeof localStorage !== 'undefined') {
  let timer: ReturnType<typeof setTimeout> | undefined
  useEditorialStore.subscribe((s) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        const out: Persisted = {
          source: s.source,
          draft: s.draft,
          checklist: s.checklist,
          bannerLink: s.bannerLink,
          deskAuto: s.deskAuto,
          translationProvider: s.translationProvider,
          modelUsed: s.modelUsed,
        }
        localStorage.setItem(PERSIST_KEY, JSON.stringify(out))
      } catch { /* quota or private mode: autosave is a convenience */ }
    }, 400)
  })
}

// dev-only handle for the end-to-end tests, as src/store.ts exposes __store
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') Object.assign(window, { __editorialStore: useEditorialStore })

// a refreshed sign-in (siteApi.saveStaffSession) replaces the desk's copy at once: a refresh token works only once
if (typeof window !== 'undefined') {
  window.addEventListener('esb-session', (e) => { useEditorialStore.setState({ staffSession: (e as CustomEvent).detail ?? null }) })
}
