import type {
  AppSettings,
  ProductCatalog,
  SelectedCategory,
  WoltCategory,
  WoltProduct,
  WoltRestaurant,
} from '../types'

const WOLT_API_PREFIX = '/wolt-api'
const WOLT_AUTH_PREFIX = '/wolt-auth'

interface WoltAuthContext {
  settings: AppSettings
  accessToken: string
  refreshToken: string
  onAuthTokenRefreshed?: (tokens: WoltAuthTokens) => void
}

interface WoltAuthTokens {
  accessToken: string
  refreshToken: string
}

interface WoltTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  msg?: string
}

interface WoltCategoryResponse {
  sections?: WoltCategorySection[]
}

interface WoltCategorySection {
  template?: string
  title?: string
  items?: WoltCategorySectionItem[]
}

interface WoltCategorySectionItem {
  title?: string
  menu_item?: WoltEmbeddedMenuItem
  link?: {
    menu_item_details?: WoltEmbeddedMenuItem
  }
}

interface WoltEmbeddedMenuItem {
  id?: string
  name?: string
  description?: string
  city_slug?: string
  venue_id?: string
  venue_slug?: string
  venue_name?: string
  venue_image?: { url?: string }
  venue_rating?: { score?: number; volume?: number }
  estimate_range?: string
  action_link?: { target?: string }
  currency?: string
  price?: number
  delivery_price?: number
}

interface WoltAssortmentResponse {
  categories?: Array<{
    id?: string
    name?: string
    slug?: string
    item_ids?: string[]
  }>
  items?: WoltAssortmentItem[]
}

interface WoltAssortmentItem {
  id?: string
  name?: string
  description?: string
  price?: number
  images?: Array<{ url?: string }>
  tags?: Array<{ id?: string; label?: string }>
}

const proxyPath = (prefix: string, path: string) => `${prefix}?path=${encodeURIComponent(path)}`
const apiPath = (path: string) => proxyPath(WOLT_API_PREFIX, path)

const buildAuthValue = (headerName: string, token: string) => {
  if (!token.trim()) return ''
  if (headerName.toLowerCase() !== 'authorization') return token.trim()
  if (/^(bearer|basic)\s+/i.test(token.trim())) return token.trim()
  return `Bearer ${token.trim()}`
}

const createWoltAuthContext = (
  settings: AppSettings,
  onAuthTokenRefreshed?: (tokens: WoltAuthTokens) => void,
): WoltAuthContext => ({
  settings,
  accessToken: settings.woltAuthToken,
  refreshToken: settings.woltRefreshToken,
  onAuthTokenRefreshed,
})

const createWoltHeaders = (authContext: WoltAuthContext, jsonBody = false) => {
  const { settings } = authContext
  const headers = new Headers({
    accept: 'application/json, text/plain, */*',
    'app-currency-format': 'wqQxLDIzNC41Ng==',
    'app-language': settings.language,
    'client-version': '1.16.108-PR22207',
    clientversionnumber: '1.16.108-PR22207',
    platform: 'Web',
    'w-wolt-session-id': settings.woltSessionId || 'no-analytics-consent',
    'x-wolt-web-clientid': settings.woltWebClientId,
  })

  if (jsonBody) headers.set('content-type', 'application/json')

  if (authContext.accessToken.trim()) {
    headers.set(
      settings.woltAuthHeaderName || 'Authorization',
      buildAuthValue(settings.woltAuthHeaderName, authContext.accessToken),
    )
  }

  return headers
}

const refreshWoltAuthToken = async (authContext: WoltAuthContext, signal: AbortSignal) => {
  if (!authContext.refreshToken.trim()) {
    throw new Error('Wolt returned 401 and no refresh token is configured.')
  }

  const response = await fetch(proxyPath(WOLT_AUTH_PREFIX, '/v1/wauth2/access_token'), {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: authContext.refreshToken,
    }).toString(),
    signal,
  })

  const responseText = await response.text()
  const payload = JSON.parse(responseText || '{}') as WoltTokenResponse

  if (!response.ok || !payload.access_token) {
    const details = payload.msg || payload.error || responseText
    throw new Error(`Wolt token refresh failed with ${response.status}: ${details.slice(0, 400)}`)
  }

  const tokens = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || authContext.refreshToken,
  }

  authContext.accessToken = tokens.accessToken
  authContext.refreshToken = tokens.refreshToken
  authContext.onAuthTokenRefreshed?.(tokens)
}

const fetchWoltJson = async <T>(
  path: string,
  createInit: () => RequestInit,
  authContext: WoltAuthContext,
  signal: AbortSignal,
  retryAuth = true,
): Promise<T> => {
  const response = await fetch(apiPath(path), createInit())

  if (response.status === 401 && retryAuth && authContext.refreshToken.trim()) {
    await refreshWoltAuthToken(authContext, signal)
    return fetchWoltJson(path, createInit, authContext, signal, false)
  }

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Wolt request failed with ${response.status}: ${details.slice(0, 400)}`)
  }

  return (await response.json()) as T
}

const formatRestaurantUrl = (settings: AppSettings, restaurantSlug: string) =>
  `https://wolt.com/${settings.language}/${settings.country}/${settings.city}/restaurant/${restaurantSlug}`

const delayWithJitter = (delayMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (delayMs <= 0) {
      resolve()
      return
    }

    const jitter = delayMs * 0.05 * (Math.random() * 2 - 1)
    const timeout = window.setTimeout(resolve, Math.max(0, delayMs + jitter))
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout)
        reject(new DOMException('The scraping run was cancelled.', 'AbortError'))
      },
      { once: true },
    )
  })

const categoryRequestBody = (settings: AppSettings, category: WoltCategory) => ({
  lat: settings.latitude,
  lon: settings.longitude,
  sorting_and_filtering: {
    sections: [
      {
        slug: category.sectionSlug,
        values: [{ selected: true, slug: category.filterSlug }],
      },
    ],
  },
})

const normalizeRestaurant = (
  details: WoltEmbeddedMenuItem,
  settings: AppSettings,
  categoryTitle: string,
): WoltRestaurant | null => {
  if (!details.venue_id || !details.venue_slug || !details.venue_name) return null

  return {
    id: details.venue_id,
    slug: details.venue_slug,
    name: details.venue_name,
    url: formatRestaurantUrl(settings, details.venue_slug),
    imageUrl: details.venue_image?.url,
    rating: details.venue_rating?.score,
    ratingVolume: details.venue_rating?.volume,
    deliveryEstimate: details.estimate_range,
    deliveryPrice: details.delivery_price,
    currency: details.currency || settings.currency,
    categories: [categoryTitle],
  }
}

const mergeRestaurant = (restaurants: Map<string, WoltRestaurant>, restaurant: WoltRestaurant) => {
  const existing = restaurants.get(restaurant.slug)
  if (!existing) {
    restaurants.set(restaurant.slug, restaurant)
    return
  }

  restaurants.set(restaurant.slug, {
    ...existing,
    categories: Array.from(new Set([...existing.categories, ...restaurant.categories])),
  })
}

export const fetchRestaurantsForCategory = async (
  category: WoltCategory,
  settings: AppSettings,
  signal: AbortSignal,
  authContext = createWoltAuthContext(settings),
) => {
  const data = await fetchWoltJson<WoltCategoryResponse>(
    '/v1/pages/category/restaurants',
    () => ({
      method: 'POST',
      headers: createWoltHeaders(authContext, true),
      body: JSON.stringify(categoryRequestBody(settings, category)),
      signal,
    }),
    authContext,
    signal,
  )

  const restaurants = new Map<string, WoltRestaurant>()

  for (const section of data.sections ?? []) {
    for (const item of section.items ?? []) {
      const details = item.link?.menu_item_details ?? item.menu_item
      if (!details) continue

      const restaurant = normalizeRestaurant(details, settings, category.title)
      if (restaurant) mergeRestaurant(restaurants, restaurant)
    }
  }

  return Array.from(restaurants.values()).slice(0, settings.restaurantsPerCategory)
}

const createCategoryLookup = (categories: WoltAssortmentResponse['categories']) => {
  const lookup = new Map<string, { name?: string; slug?: string }>()

  for (const category of categories ?? []) {
    for (const itemId of category.item_ids ?? []) {
      lookup.set(itemId, { name: category.name, slug: category.slug })
    }
  }

  return lookup
}

const hasPopularTag = (item: WoltAssortmentItem) =>
  item.tags?.some(
    (tag) => tag.id?.toLowerCase() === 'popular' || tag.label?.toLowerCase() === 'popular',
  ) ?? false

export const fetchProductsForRestaurant = async (
  restaurant: WoltRestaurant,
  settings: AppSettings,
  signal: AbortSignal,
  authContext = createWoltAuthContext(settings),
) => {
  const path = `/consumer-api/consumer-assortment/v1/venues/slug/${restaurant.slug}/assortment?language=${encodeURIComponent(settings.language)}`
  const data = await fetchWoltJson<WoltAssortmentResponse>(
    path,
    () => ({
      method: 'GET',
      headers: createWoltHeaders(authContext),
      signal,
    }),
    authContext,
    signal,
  )

  const categoryLookup = createCategoryLookup(data.categories)
  const normalizedItems = (data.items ?? [])
    .filter((item) => item.id && item.name && typeof item.price === 'number')
    .map<WoltProduct>((item) => {
      const category = item.id ? categoryLookup.get(item.id) : undefined

      return {
        id: item.id ?? '',
        name: item.name ?? '',
        description: item.description ?? '',
        price: item.price ?? 0,
        currency: restaurant.currency || settings.currency,
        imageUrl: item.images?.[0]?.url,
        url: `${restaurant.url}/${encodeURIComponent((item.name ?? 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}-itemid-${item.id}`,
        restaurantId: restaurant.id,
        restaurantSlug: restaurant.slug,
        restaurantName: restaurant.name,
        categoryName: category?.name,
        categorySlug: category?.slug,
        isPopular: hasPopularTag(item),
        deliveryEstimate: restaurant.deliveryEstimate,
      }
    })

  if (!settings.popularItemsOnly) return normalizedItems

  return normalizedItems.filter((item) => item.isPopular).slice(0, settings.productsPerRestaurant)
}

export const collectProductsForCategories = async ({
  categories,
  knownCategories,
  settings,
  signal,
  onPhase,
  onAuthTokenRefreshed,
}: {
  categories: SelectedCategory[]
  knownCategories: WoltCategory[]
  settings: AppSettings
  signal: AbortSignal
  onPhase: (phase: string) => void
  onAuthTokenRefreshed?: (tokens: WoltAuthTokens) => void
}): Promise<ProductCatalog> => {
  const restaurants = new Map<string, WoltRestaurant>()
  const products = new Map<string, WoltProduct>()
  const authContext = createWoltAuthContext(settings, onAuthTokenRefreshed)
  let apiCalls = 0

  const waitBeforeNextCall = async () => {
    if (apiCalls > 0) await delayWithJitter(settings.scrapeDelayMs, signal)
    apiCalls += 1
  }

  for (const selectedCategory of categories) {
    const category = knownCategories.find(
      (candidate) => candidate.slug === selectedCategory.slug || candidate.filterSlug === selectedCategory.slug,
    )
    if (!category) continue

    onPhase(`Fetching ${category.title} restaurants from Wolt`)
    await waitBeforeNextCall()
    const categoryRestaurants = await fetchRestaurantsForCategory(category, settings, signal, authContext)
    categoryRestaurants.forEach((restaurant) => mergeRestaurant(restaurants, restaurant))
  }

  const restaurantList = Array.from(restaurants.values())

  for (const [index, restaurant] of restaurantList.entries()) {
    onPhase(
      `Fetching ${settings.popularItemsOnly ? 'popular products' : 'all products'} from ${restaurant.name} (${index + 1}/${restaurantList.length})`,
    )
    await waitBeforeNextCall()
    const restaurantProducts = await fetchProductsForRestaurant(restaurant, settings, signal, authContext)
    restaurantProducts.forEach((product) => products.set(product.id, product))
  }

  return {
    selectedCategories: categories,
    restaurants: restaurantList,
    products: Array.from(products.values()),
    fetchedAt: new Date().toISOString(),
  }
}