import { z } from 'zod'
import { LLM_PROVIDER_PRESETS } from '../settings'
import type { AppSettings, LlmSuggestionChoice, SelectedCategory } from '../types'

const categoryResponseSchema = z.object({
  categories: z.array(
    z.object({
      slug: z.string(),
      title: z.string().optional(),
      reason: z.string().optional(),
    }),
  ),
})

const suggestionResponseSchema = z.object({
  suggestions: z.array(
    z.object({
      title: z.string(),
      restaurantSlug: z.string().optional(),
      itemIds: z.array(z.string()),
      quantities: z.record(z.string(), z.number()).optional(),
      shortSummary: z.string(),
    }),
  ),
})

const buildAuthValue = (headerName: string, apiKey: string) => {
  if (!apiKey.trim()) return ''
  if (headerName.toLowerCase() !== 'authorization') return apiKey.trim()
  if (/^(bearer|basic)\s+/i.test(apiKey.trim())) return apiKey.trim()
  return `Bearer ${apiKey.trim()}`
}

const buildGeminiAuthValue = (headerName: string, apiKey: string) => {
  if (!apiKey.trim()) return ''
  if (headerName.toLowerCase() !== 'authorization') return apiKey.trim()
  if (/^(bearer|basic)\s+/i.test(apiKey.trim())) return apiKey.trim()
  return `Bearer ${apiKey.trim()}`
}

const extractAssistantContent = (payload: unknown): string => {
  const response = payload as {
    choices?: Array<{ message?: { content?: string }; text?: string }>
    output_text?: string
    content?: string
  }

  return (
    response.choices?.[0]?.message?.content ??
    response.choices?.[0]?.text ??
    response.output_text ??
    response.content ??
    ''
  )
}

const extractGeminiContent = (payload: unknown): string => {
  if (Array.isArray(payload)) {
    return payload.map(extractGeminiContent).join('')
  }

  const response = payload as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> }
      finishReason?: string
    }>
    error?: { message?: string }
  }

  if (response.error?.message) {
    throw new Error(response.error.message)
  }

  return (
    response.candidates
      ?.flatMap((candidate) => candidate.content?.parts?.map((part) => part.text ?? '') ?? [])
      .join('') ?? ''
  )
}

const parseGeminiResponseText = (responseText: string) => {
  const trimmed = responseText.trim()
  if (!trimmed) return ''

  try {
    return extractGeminiContent(JSON.parse(trimmed))
  } catch (jsonError) {
    const chunks = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s*/, ''))
      .filter((line) => line && line !== '[DONE]')

    if (chunks.length === 0) throw jsonError

    return chunks.map((chunk) => extractGeminiContent(JSON.parse(chunk))).join('')
  }
}

const resolveGeminiUrl = (settings: AppSettings) => {
  const rawUrl = settings.llmApiUrl.trim() || LLM_PROVIDER_PRESETS.gemini.llmApiUrl
  const model = encodeURIComponent(settings.llmModel.trim() || LLM_PROVIDER_PRESETS.gemini.llmModel)
  const url = new URL(rawUrl.replaceAll('{model}', model))

  if (url.pathname.includes(':generateContent') || url.pathname.includes(':streamGenerateContent')) {
    return url.toString()
  }

  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname

  if (path.endsWith('/models')) {
    url.pathname = `${path}/${model}:generateContent`
  } else if (path.includes('/models/')) {
    url.pathname = `${path}:generateContent`
  } else {
    url.pathname = `${path}/models/${model}:generateContent`
  }

  return url.toString()
}

const parseJsonFromText = (content: string) => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced ?? content
  const firstObject = candidate.indexOf('{')
  const lastObject = candidate.lastIndexOf('}')

  if (firstObject < 0 || lastObject < 0 || lastObject <= firstObject) {
    throw new Error('The LLM response did not contain a JSON object.')
  }

  return JSON.parse(candidate.slice(firstObject, lastObject + 1))
}

const callOpenAiCompatible = async (settings: AppSettings, prompt: string, signal: AbortSignal) => {
  if (!settings.llmApiUrl.trim()) {
    throw new Error('Set an LLM API URL before starting an order.')
  }

  if (!settings.llmApiKey.trim()) {
    throw new Error('Set an LLM API key before starting an order.')
  }

  const headers = new Headers({ 'Content-Type': 'application/json' })
  headers.set(settings.llmAuthHeaderName || 'Authorization', buildAuthValue(settings.llmAuthHeaderName, settings.llmApiKey))

  const response = await fetch(settings.llmApiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.llmModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
    signal,
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`LLM request failed with ${response.status}: ${details.slice(0, 400)}`)
  }

  const payload = await response.json()
  const content = extractAssistantContent(payload)

  if (!content.trim()) {
    throw new Error('The LLM response was empty.')
  }

  return content
}

const callGemini = async (settings: AppSettings, prompt: string, signal: AbortSignal) => {
  if (!settings.llmApiKey.trim()) {
    throw new Error('Set a Gemini API key before starting an order.')
  }

  const headers = new Headers({ 'Content-Type': 'application/json' })
  headers.set(
    settings.llmAuthHeaderName || LLM_PROVIDER_PRESETS.gemini.llmAuthHeaderName,
    buildGeminiAuthValue(settings.llmAuthHeaderName, settings.llmApiKey),
  )

  const response = await fetch(resolveGeminiUrl(settings), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
    signal,
  })

  const responseText = await response.text()

  if (!response.ok) {
    throw new Error(`Gemini request failed with ${response.status}: ${responseText.slice(0, 400)}`)
  }

  const content = parseGeminiResponseText(responseText)

  if (!content.trim()) {
    throw new Error('The Gemini response was empty.')
  }

  return content
}

export const callLlm = async (settings: AppSettings, prompt: string, signal: AbortSignal) => {
  if ((settings.llmProvider ?? 'openai') === 'gemini') {
    return callGemini(settings, prompt, signal)
  }

  return callOpenAiCompatible(settings, prompt, signal)
}

export const parseCategorySelection = (content: string): SelectedCategory[] => {
  const result = categoryResponseSchema.parse(parseJsonFromText(content))
  return result.categories.map((category) => ({
    slug: category.slug,
    title: category.title ?? category.slug,
    reason: category.reason,
  }))
}

export const parseSuggestionSelection = (content: string): LlmSuggestionChoice[] =>
  suggestionResponseSchema.parse(parseJsonFromText(content)).suggestions