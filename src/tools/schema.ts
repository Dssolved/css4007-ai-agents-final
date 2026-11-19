// Argument validation from the same JSON Schema that is sent to the model: one description of a
// tool's arguments serves both. Only the subset the tools use is supported; anything outside it is
// a programming error and throws. Unknown arguments are rejected (no silent extras from the model).
import { isValidDate } from '../data/time.ts'

export interface PropSchema {
  type: 'string' | 'integer' | 'number' | 'boolean'
  description?: string
  enum?: readonly (string | number)[]
  /** string: 'date' = a real calendar day YYYY-MM-DD */
  format?: 'date'
  pattern?: string
  maxLength?: number
  minimum?: number
  maximum?: number
}

export interface ArgsSchema {
  type: 'object'
  properties: Record<string, PropSchema>
  required?: readonly string[]
  additionalProperties?: false
}

export type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export function validateArgs<T = Record<string, unknown>>(schema: ArgsSchema, args: unknown): Checked<T> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return { ok: false, errors: ['arguments must be an object'] }
  const errors: string[] = []
  const obj = args as Record<string, unknown>
  for (const key of Object.keys(obj)) if (!Object.hasOwn(schema.properties, key)) errors.push(`unknown argument "${key}"`)
  for (const key of schema.required ?? []) if (obj[key] === undefined || obj[key] === null) errors.push(`"${key}" is required`)

  for (const [key, p] of Object.entries(schema.properties)) {
    const v = obj[key]
    if (v === undefined || v === null) continue
    const bad = (what: string) => errors.push(`"${key}" ${what}`)
    switch (p.type) {
      case 'string':
        if (typeof v !== 'string') {
          bad('must be a string')
          break
        }
        if (p.format === 'date' && !isValidDate(v)) bad('must be a real date YYYY-MM-DD')
        if (p.pattern && !new RegExp(p.pattern).test(v)) bad(`must match ${p.pattern}`)
        if (p.maxLength !== undefined && v.length > p.maxLength) bad(`must be at most ${p.maxLength} characters`)
        break
      case 'integer':
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v) || (p.type === 'integer' && !Number.isInteger(v))) {
          bad(`must be ${p.type === 'integer' ? 'a whole number' : 'a number'}`)
          break
        }
        if (p.minimum !== undefined && v < p.minimum) bad(`must be ≥ ${p.minimum}`)
        if (p.maximum !== undefined && v > p.maximum) bad(`must be ≤ ${p.maximum}`)
        break
      case 'boolean':
        if (typeof v !== 'boolean') bad('must be true or false')
        break
      default:
        throw new Error(`Unsupported schema type for "${key}"`)
    }
    if (p.enum && !p.enum.includes(v as string | number)) bad(`must be one of: ${p.enum.join(', ')}`)
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: obj as T }
}
