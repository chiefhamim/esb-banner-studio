import { useState } from 'react'
import { Icon } from './Icon'
import { Check, Chip, IconButton, Scrub, Seg, Select, Slider, Switch, Toggle } from './controls'

export function ComponentGallery() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [scrubVal, setScrubVal] = useState(42)
  const [sliderVal, setSliderVal] = useState(65)
  const [switchVal, setSwitchVal] = useState(true)
  const [checkVal, setCheckVal] = useState(true)
  const [segVal, setSegVal] = useState('one')
  const [selectVal, setSelectVal] = useState('opt1')
  const [dialogOpen, setDialogOpen] = useState(false)

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    document.documentElement.dataset.theme = next
  }

  return (
    <div className="component-gallery" style={{ padding: '32px 48px', overflowY: 'auto', height: '100%', background: 'var(--surface-app)', color: 'var(--text-primary)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px', borderBottom: '1px solid var(--border-default)', paddingBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>ESB Studio — Component Gallery</h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>Design token and interactive UI primitive verification ("Quiet Studio").</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Theme: {theme}</span>
          <button type="button" className="btn sm" onClick={toggleTheme}>
            <Icon name="sun" size={14} /> Toggle {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
      </header>

      {/* Typography Scale */}
      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px', marginBottom: '16px' }}>1. Typography Scale</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '12px', alignItems: 'baseline' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Hero (24 / 28)</span>
          <div style={{ fontSize: '24px', lineHeight: '28px', fontWeight: 700 }}>Newsroom Production Studio</div>

          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Dialog (18 / 24)</span>
          <div style={{ fontSize: '18px', lineHeight: '24px', fontWeight: 700, letterSpacing: '-0.01em' }}>Export High-Resolution Broadcast Frame</div>

          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Title (15 / 20)</span>
          <div style={{ fontSize: '15px', lineHeight: '20px', fontWeight: 600 }}>Bengali Headline &amp; Typographic Bounds</div>

          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Body Medium (13 / 20)</span>
          <div style={{ fontSize: '13px', lineHeight: '20px', fontWeight: 500 }}>Editorial fact verification verified by Senior Desk Editor</div>

          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Body (13 / 20)</span>
          <div style={{ fontSize: '13px', lineHeight: '20px', fontWeight: 400 }}>Standard editorial body paragraph text for news tickers and story copy.</div>

          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Secondary (12 / 16)</span>
          <div style={{ fontSize: '12px', lineHeight: '16px', color: 'var(--text-secondary)' }}>1080 × 1350 px · Aspect ratio 4:5 · 22 Oct 2026</div>

          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Caption / Overline (11 / 16)</span>
          <div style={{ fontSize: '11px', lineHeight: '16px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>BREAKING NEWS REPORT</div>

          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Bengali Typography</span>
          <div lang="bn" className="bn" style={{ fontSize: '15px', fontWeight: 600 }}>আন্তর্জাতিক বাজারে জ্বালানি তেলের দাম আরও কমল</div>
        </div>
      </section>

      {/* Buttons */}
      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px', marginBottom: '16px' }}>2. Buttons &amp; Actions</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button type="button" className="btn primary lg"><Icon name="download" size={16} /> Export Banner</button>
            <button type="button" className="btn lg">Save Project</button>
            <button type="button" className="btn ghost lg">Cancel</button>
            <button type="button" className="btn danger lg">Delete Layer</button>
            <button type="button" className="btn lg" disabled>Disabled Action</button>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button type="button" className="btn primary"><Icon name="check" size={14} /> Commit Changes</button>
            <button type="button" className="btn">Default Secondary</button>
            <button type="button" className="btn ghost">Subtle Ghost</button>
            <button type="button" className="btn danger">Remove Item</button>
            <button type="button" className="btn" disabled>Disabled</button>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button type="button" className="btn primary sm">Small Primary</button>
            <button type="button" className="btn sm">Small Secondary</button>
            <button type="button" className="btn ghost sm">Small Ghost</button>
            <button type="button" className="btn danger sm">Small Danger</button>
            <button type="button" className="btn sm" disabled>Small Disabled</button>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <IconButton icon="text" tip="Text tool" />
            <IconButton icon="square" tip="Shape tool" active />
            <IconButton icon="alignLeft" tip="Align Left" />
            <IconButton icon="undo" tip="Undo" />
            <IconButton icon="redo" tip="Redo" disabled />
          </div>
        </div>
      </section>

      {/* Inputs & Controls */}
      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px', marginBottom: '16px' }}>3. Form Controls &amp; Scrubbers</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>Text Input</label>
            <input type="text" placeholder="Enter headline text…" defaultValue="Prime Minister addresses national assembly" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>Numeric Scrubber</label>
            <Scrub label="TRACKING" value={scrubVal} onChange={setScrubVal} unit="px" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>Range Slider ({sliderVal}%)</label>
            <Slider value={sliderVal} min={0} max={100} onChange={setSliderVal} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>Dropdown Select</label>
            <Select
              value={selectVal}
              options={[
                { value: 'opt1', label: '1080 × 1350 (Facebook 4:5)' },
                { value: 'opt2', label: '1080 × 1920 (Story 9:16)' },
                { value: 'opt3', label: '1920 × 1080 (Landscape 16:9)' },
              ]}
              onChange={setSelectVal}
            />
          </div>
        </div>
      </section>

      {/* Segmented Controls, Switches & Chips */}
      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px', marginBottom: '16px' }}>4. Toggles, Segments &amp; Indicators</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'center' }}>
          <div>
            <Seg
              value={segVal}
              options={[
                { value: 'one', label: 'Story' },
                { value: 'two', label: 'Photos' },
                { value: 'three', label: 'Quotes' },
              ]}
              onChange={setSegVal}
            />
          </div>

          <div>
            <Switch checked={switchVal} onChange={setSwitchVal} label="Enable link badge" />
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Toggle checked={switchVal} onChange={setSwitchVal} label="Toggle item" />
            <Toggle small checked={switchVal} onChange={setSwitchVal} label="Small toggle" />
          </div>

          <div>
            <Check checked={checkVal} onChange={setCheckVal} label="Auto-detect Bengali numbers" hint="Converts 0–9 to Bengali numerals" />
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <Chip on>Active Filter</Chip>
            <Chip>Inactive Filter</Chip>
          </div>

          <div style={{ display: 'flex', gap: '4px' }}>
            <kbd>Ctrl</kbd> + <kbd>K</kbd>
          </div>
        </div>
      </section>

      {/* Elevation & Surfaces */}
      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px', marginBottom: '16px' }}>5. Elevation &amp; Surfaces</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div style={{ background: 'var(--surface-app)', border: '1px solid var(--border-default)', padding: '16px', borderRadius: 'var(--r-3)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>L0: App Surface</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>Window frame base</div>
          </div>
          <div style={{ background: 'var(--surface-panel)', border: '1px solid var(--border-subtle)', padding: '16px', borderRadius: 'var(--r-3)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>L1: Panel Surface</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>Docks, sidebars, stages</div>
          </div>
          <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-l2)', padding: '16px', borderRadius: 'var(--r-3)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>L2: Popover / Menu</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>Floating palettes &amp; menus</div>
          </div>
          <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-l3)', padding: '16px', borderRadius: 'var(--r-4)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>L3: Modal Dialog</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>Confirmations &amp; wizards</div>
          </div>
        </div>
      </section>

      {/* Dialog Preview */}
      <section style={{ marginBottom: '40px' }}>
        <button type="button" className="btn" onClick={() => setDialogOpen(true)}>
          Open Sample Modal Dialog
        </button>
        {dialogOpen && (
          <div className="modal-bg" onClick={() => setDialogOpen(false)}>
            <div className="dialog" style={{ width: '480px' }} onClick={(e) => e.stopPropagation()}>
              <header>
                <div>
                  <div className="kicker">CONFIRM ACTION</div>
                  <h2>Reset Workspace Layout</h2>
                </div>
                <IconButton icon="x" tip="Close (Esc)" onClick={() => setDialogOpen(false)} />
              </header>
              <div className="dialog-body">
                <p style={{ margin: 0, fontSize: '13px', lineHeight: '20px' }}>
                  Are you sure you want to reset all dock panels and tools back to the factory Quiet Studio defaults?
                </p>
              </div>
              <footer>
                <button type="button" className="btn ghost" onClick={() => setDialogOpen(false)}>Cancel</button>
                <button type="button" className="btn primary" onClick={() => setDialogOpen(false)}>Reset Layout</button>
              </footer>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
