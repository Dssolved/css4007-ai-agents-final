// A tool = what the model sees (name, description, argument schema) + what the code enforces
// (permission, extra checks) + the implementation. `callTool` is the only path from a model's
// tool call to running code: unknown tools and invalid arguments never reach `run`.
import type { ToolCall, ToolSpec } from '../llm/types.ts'
import { validateArgs, type ArgsSchema } from './schema.ts'

export type Permission = 'read' | 'write'

export interface Tool<Ctx, A = any> {
  name: string
  description: string
  parameters: ArgsSchema
  permission: Permission
  /** Checks across arguments (e.g. from ≤ to); returns a problem or null */
  check?: (args: A, ctx: Ctx) => string | null
  run: (args: A, ctx: Ctx) => unknown
}

export const specOf = <Ctx>(t: Tool<Ctx>): ToolSpec => ({ name: t.name, description: t.description, parameters: t.parameters as unknown as Record<string, unknown> })

export type ToolOutcome =
  | { ok: true; name: string; args: unknown; result: unknown }
  | { ok: false; name: string; args: unknown; error: string; kind: 'unknown_tool' | 'invalid_args' | 'failed' }

export function callTool<Ctx>(tools: Tool<Ctx>[], call: ToolCall, ctx: Ctx): ToolOutcome {
  const tool = tools.find((t) => t.name === call.name)
  if (!tool) return { ok: false, name: call.name, args: call.arguments, kind: 'unknown_tool', error: `There is no tool "${call.name}". Available: ${tools.map((t) => t.name).join(', ')}` }
  const checked = validateArgs(tool.parameters, call.arguments)
  if (!checked.ok) return { ok: false, name: tool.name, args: call.arguments, kind: 'invalid_args', error: `Invalid arguments: ${checked.errors.join('; ')}` }
  const problem = tool.check?.(checked.value, ctx)
  if (problem) return { ok: false, name: tool.name, args: call.arguments, kind: 'invalid_args', error: `Invalid arguments: ${problem}` }
  try {
    return { ok: true, name: tool.name, args: checked.value, result: tool.run(checked.value, ctx) }
  } catch (e) {
    return { ok: false, name: tool.name, args: call.arguments, kind: 'failed', error: `Tool failed: ${(e as Error).message}` }
  }
}

/** What goes back to the model as the tool message */
export const toolMessage = (o: ToolOutcome) => JSON.stringify(o.ok ? o.result : { error: o.error })
