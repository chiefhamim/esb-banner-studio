// Marks banner category writes made by the app (auto-detection) so the live link can tell them
// from a desk the editor picked on purpose. Subscribers run synchronously inside setContent.
let depth = 0
export const isAutoDeskWrite = () => depth > 0
export function autoDesk<T>(fn: () => T): T {
  depth++
  try { return fn() } finally { depth-- }
}
