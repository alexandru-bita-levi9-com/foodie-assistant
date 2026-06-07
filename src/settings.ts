import type { AppSettings, LlmProvider } from './types'

const SETTINGS_KEY = 'foodie-assistant.settings.v1'

const envString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const envNumber = (value: unknown, fallback: number) => {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const LLM_PROVIDER_PRESETS: Record<
  LlmProvider,
  Pick<AppSettings, 'llmApiUrl' | 'llmModel' | 'llmAuthHeaderName'>
> = {
  openai: {
    llmApiUrl: 'https://api.openai.com/v1/chat/completions',
    llmModel: 'gpt-4o-mini',
    llmAuthHeaderName: 'Authorization',
  },
  gemini: {
    llmApiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    llmModel: 'gemini-3.1-flash-lite',
    llmAuthHeaderName: 'x-goog-api-key',
  },
}

const createClientId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `client-${Math.random().toString(16).slice(2)}-${Date.now()}`
}

export const createDefaultSettings = (): AppSettings => ({
  llmProvider: 'openai',
  llmApiKey: envString(import.meta.env.VITE_LLM_API_KEY),
  ...LLM_PROVIDER_PRESETS.openai,
  woltAuthToken: envString(import.meta.env.VITE_WOLT_AUTH_TOKEN),
  woltRefreshToken: envString(import.meta.env.VITE_WOLT_REFRESH_TOKEN),
  woltAuthHeaderName: envString(import.meta.env.VITE_WOLT_AUTH_HEADER_NAME) || 'Authorization',
  woltWebClientId: createClientId(),
  woltSessionId: 'no-analytics-consent',
  maxCategories: 3,
  suggestionCount: 3,
  peopleCount: 1,
  budget: '',
  specialMentions: '',
  requireSingleRestaurant: true,
  popularItemsOnly: true,
  scrapeDelayMs: 500,
  restaurantsPerCategory: 4,
  productsPerRestaurant: 8,
  latitude: envNumber(import.meta.env.VITE_WOLT_LATITUDE, 47.157435),
  longitude: envNumber(import.meta.env.VITE_WOLT_LONGITUDE, 27.5815901),
  country: 'rou',
  city: envString(import.meta.env.VITE_WOLT_CITY) || 'iasi',
  currency: 'RON',
  language: 'en',
})

export const loadSettings = (): AppSettings => {
  const defaults = createDefaultSettings()

  try {
    const raw = sessionStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaults
    const savedSettings = JSON.parse(raw) as Partial<AppSettings>

    return {
      ...defaults,
      ...savedSettings,
      llmProvider: savedSettings.llmProvider === 'gemini' ? 'gemini' : 'openai',
      woltWebClientId: savedSettings.woltWebClientId || defaults.woltWebClientId,
    }
  } catch {
    return defaults
  }
}

export const saveSettings = (settings: AppSettings) => {
  sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export const clearSettings = () => {
  sessionStorage.removeItem(SETTINGS_KEY)
}