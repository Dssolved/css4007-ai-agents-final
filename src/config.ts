import fs from 'node:fs'
import type { ClientConfig } from './llm/client.ts'

/** Model settings from the environment; `.env` in the project root is read if it exists */
export function loadModelConfig(envFile = '.env'): Pick<ClientConfig, 'baseUrl' | 'apiKey' | 'model'> {
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
  return {
    baseUrl: process.env.LLM_BASE_URL ?? '',
    apiKey: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? '',
  }
}
