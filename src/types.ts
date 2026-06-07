export type ChatRole = 'assistant' | 'user'

export type ChatStatus = 'normal' | 'loading' | 'error' | 'cancelled'

export type LlmProvider = 'openai' | 'gemini'

export type SessionMode =
  | 'idle'
  | 'awaiting-request'
  | 'processing'
  | 'suggestions-ready'
  | 'awaiting-feedback'
  | 'completed'
  | 'error'

export interface AppSettings {
  llmProvider: LlmProvider
  llmApiKey: string
  llmApiUrl: string
  llmModel: string
  llmAuthHeaderName: string
  woltAuthToken: string
  woltRefreshToken: string
  woltAuthHeaderName: string
  woltWebClientId: string
  woltSessionId: string
  maxCategories: number
  suggestionCount: number
  peopleCount: number
  budget: string
  specialMentions: string
  requireSingleRestaurant: boolean
  popularItemsOnly: boolean
  scrapeDelayMs: number
  restaurantsPerCategory: number
  productsPerRestaurant: number
  latitude: number
  longitude: number
  country: string
  city: string
  currency: string
  language: string
}

export interface WoltCategory {
  title: string
  slug: string
  filterSlug: string
  sectionSlug: string
  image?: string
}

export interface SelectedCategory {
  slug: string
  title: string
  reason?: string
}

export interface WoltRestaurant {
  id: string
  slug: string
  name: string
  url: string
  imageUrl?: string
  rating?: number
  ratingVolume?: number
  deliveryEstimate?: string
  deliveryPrice?: number
  currency: string
  categories: string[]
}

export interface WoltProduct {
  id: string
  name: string
  description: string
  price: number
  currency: string
  imageUrl?: string
  url: string
  restaurantId: string
  restaurantSlug: string
  restaurantName: string
  categoryName?: string
  categorySlug?: string
  isPopular: boolean
  deliveryEstimate?: string
}

export interface ProductCatalog {
  selectedCategories: SelectedCategory[]
  restaurants: WoltRestaurant[]
  products: WoltProduct[]
  fetchedAt: string
}

export interface LlmSuggestionChoice {
  title: string
  restaurantSlug?: string
  itemIds: string[]
  quantities?: Record<string, number>
  shortSummary: string
}

export interface SuggestionItem {
  id: string
  name: string
  description: string
  quantity: number
  unitPrice: number
  totalPrice: number
  imageUrl?: string
  url: string
  restaurantName: string
  restaurantSlug: string
  categoryName?: string
}

export interface FoodSuggestion {
  id: string
  title: string
  restaurantName: string
  restaurantSlug: string
  restaurantUrl: string
  summary: string
  items: SuggestionItem[]
  totalPrice: number
  currency: string
  imageUrl?: string
  deliveryEstimate?: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  status: ChatStatus
  suggestions?: FoodSuggestion[]
}