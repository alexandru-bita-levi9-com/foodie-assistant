import categoryPromptTemplate from '../prompts/category-selection.xml?raw'
import suggestionPromptTemplate from '../prompts/suggestion-selection.xml?raw'
import { WOLT_CATEGORIES_YAML } from '../categories'
import type {
  AppSettings,
  FoodSuggestion,
  ProductCatalog,
  SelectedCategory,
  WoltProduct,
} from '../types'

const escapeTemplateValue = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')

const fillTemplate = (template: string, values: Record<string, string | number | boolean>) =>
  Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    template,
  )

const trimText = (value: string, maxLength: number) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized
}

export const buildCategoryPrompt = (settings: AppSettings, userRequest: string) =>
  fillTemplate(categoryPromptTemplate, {
    maxCategories: settings.maxCategories,
    userRequest: escapeTemplateValue(userRequest),
    peopleCount: settings.peopleCount,
    budget: escapeTemplateValue(settings.budget || 'not specified'),
    specialMentions: escapeTemplateValue(settings.specialMentions || 'not specified'),
    categoriesYaml: WOLT_CATEGORIES_YAML,
  })

export const toPromptProducts = (products: WoltProduct[]) =>
  products.map((product) => ({
    id: product.id,
    name: product.name,
    description: trimText(product.description, 280),
    price: product.price,
    currency: product.currency,
    restaurantName: product.restaurantName,
    restaurantSlug: product.restaurantSlug,
    categoryName: product.categoryName,
    categorySlug: product.categorySlug,
    isPopular: product.isPopular,
    deliveryEstimate: product.deliveryEstimate,
  }))

export const buildSuggestionPrompt = ({
  settings,
  catalog,
  availableProducts,
  initialRequest,
  latestFeedback,
  feedbackHistory,
  rejectedSuggestions,
  currentStep,
}: {
  settings: AppSettings
  catalog: ProductCatalog
  availableProducts: WoltProduct[]
  initialRequest: string
  latestFeedback: string
  feedbackHistory: string[]
  rejectedSuggestions: FoodSuggestion[]
  currentStep: string
}) =>
  fillTemplate(suggestionPromptTemplate, {
    currentStep: escapeTemplateValue(currentStep),
    initialRequest: escapeTemplateValue(initialRequest),
    latestFeedback: escapeTemplateValue(latestFeedback || 'none'),
    feedbackHistoryJson: JSON.stringify(feedbackHistory, null, 2),
    peopleCount: settings.peopleCount,
    budget: escapeTemplateValue(settings.budget || 'not specified'),
    specialMentions: escapeTemplateValue(settings.specialMentions || 'not specified'),
    suggestionCount: settings.suggestionCount,
    singleRestaurantRequired: settings.requireSingleRestaurant,
    selectedCategoriesJson: JSON.stringify(catalog.selectedCategories, null, 2),
    rejectedSuggestionsJson: JSON.stringify(summarizeRejectedSuggestions(rejectedSuggestions), null, 2),
    productsJson: JSON.stringify(toPromptProducts(availableProducts), null, 2),
  })

const summarizeRejectedSuggestions = (suggestions: FoodSuggestion[]) =>
  suggestions.map((suggestion) => ({
    title: suggestion.title,
    restaurant: suggestion.restaurantName,
    restaurantSlug: suggestion.restaurantSlug,
    totalPrice: suggestion.totalPrice,
    currency: suggestion.currency,
    summary: suggestion.summary,
    items: suggestion.items.map((item) => ({
      id: item.id,
      title: item.name,
      quantity: item.quantity,
      price: item.unitPrice,
      description: trimText(item.description, 220),
    })),
  }))

export const normalizeSelectedCategories = (categories: SelectedCategory[]) =>
  categories.map((category) => `${category.title} (${category.slug})`).join(', ')