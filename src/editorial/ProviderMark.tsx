// The mark of each AI company, drawn as a small single-colour SVG (it takes the text colour), for the header chip.
// Claude is Anthropic's radiating spark; Gemini's four-point star; OpenAI's six-petal bloom; OpenRouter's two-way arrows.

import type { AiProviderId } from './aiProviders'

export function ProviderMark({ id, size = 16 }: { id: AiProviderId; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false } as const
  if (id === 'anthropic') {
    // twelve rays out of one centre, uneven in length like the Claude spark
    const len = [10.8, 7.6, 10.2, 7.4, 10.8, 8.2, 10.4, 7.6, 10.8, 7.8, 10.2, 8]
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
        {len.map((l, i) => {
          const a = (i * 30 - 90) * (Math.PI / 180)
          return <line key={i} x1={12 + Math.cos(a) * 2.2} y1={12 + Math.sin(a) * 2.2} x2={12 + Math.cos(a) * l} y2={12 + Math.sin(a) * l} />
        })}
      </svg>
    )
  }
  if (id === 'gemini') {
    return (
      <svg {...common} fill="currentColor">
        <path d="M12 1.5C12.7 7.6 16.4 11.3 22.5 12C16.4 12.7 12.7 16.4 12 22.5C11.3 16.4 7.6 12.7 1.5 12C7.6 11.3 11.3 7.6 12 1.5Z" />
      </svg>
    )
  }
  if (id === 'openai') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round">
        {[0, 60, 120, 180, 240, 300].map((d) => (
          <path key={d} transform={`rotate(${d} 12 12)`} d="M12 12 L12 3.2 C15.4 3.2 17.4 5.2 17.4 7.6 L12 12Z" />
        ))}
      </svg>
    )
  }
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h14M13 4l4 4-4 4M21 16H7M11 12l-4 4 4 4" />
    </svg>
  )
}
