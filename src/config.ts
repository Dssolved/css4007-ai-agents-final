import fs from 'node:fs'
import type { ClientConfig } from './llm/client.ts'

/** Known OpenAI-compatible endpoints; each has its own key in the environment */
export const PROVIDERS = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', keyVar: 'GEMINI_API_KEY' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyVar: 'OPENROUTER_API_KEY' },
  openai: { baseUrl: 'https://api.openai.com/v1', keyVar: 'OPENAI_API_KEY' },
} as const
export type Provider = keyof typeof PROVIDERS

let loaded = false
function loadEnv(envFile: string) {
  if (!loaded && fs.existsSync(envFile)) process.loadEnvFile(envFile)
  loaded = true
}

const isProvider = (p: string): p is Provider => Object.hasOwn(PROVIDERS, p)

/**
 * Settings for one provider and model. Without arguments: the default from LLM_PROVIDER and
 * LLM_MODEL. A missing key gives an empty apiKey — createClient then fails with a config error.
 */
export function modelConfig(provider?: string, model?: string, envFile = '.env'): Pick<ClientConfig, 'baseUrl' | 'apiKey' | 'model'> {
  loadEnv(envFile)
  const name = provider ?? process.env.LLM_PROVIDER ?? 'gemini'
  if (!isProvider(name)) throw new Error(`Unknown provider "${name}" (known: ${Object.keys(PROVIDERS).join(', ')})`)
  const p = PROVIDERS[name]
  return { baseUrl: p.baseUrl, apiKey: process.env[p.keyVar] ?? '', model: model ?? process.env.LLM_MODEL ?? '' }
}
