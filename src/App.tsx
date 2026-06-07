import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowDown, ArrowUp, Check, ExternalLink, Send, Sparkles, X } from 'lucide-react'
import './App.css'
import { WOLT_CATEGORIES, findCategoryBySlug } from './categories'
import { SettingsPanel } from './components/SettingsPanel'
import { clearSettings, createDefaultSettings, loadSettings, saveSettings } from './settings'
import { callLlm, parseCategorySelection, parseSuggestionSelection } from './services/llm'
import {
  buildCategoryPrompt,
  buildSuggestionPrompt,
  normalizeSelectedCategories,
} from './services/promptTemplates'
import { collectProductsForCategories } from './services/wolt'
import type {
  AppSettings,
  ChatMessage,
  FoodSuggestion,
  LlmSuggestionChoice,
  ProductCatalog,
  SelectedCategory,
  SessionMode,
  WoltProduct,
} from './types'

const createId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

const formatPrice = (price: number, currency: string) =>
  new Intl.NumberFormat('en-RO', {
    style: 'currency',
    currency,
  }).format(price / 100)

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError'

const getRejectedItemIds = (suggestions: FoodSuggestion[]) =>
  new Set(suggestions.flatMap((suggestion) => suggestion.items.map((item) => item.id)))

const applyCategoryWhitelist = (selectedCategories: SelectedCategory[]) => {
  const seen = new Set<string>()

  return selectedCategories.flatMap((selection) => {
    const category = findCategoryBySlug(selection.slug)
    if (!category || seen.has(category.slug)) return []
    seen.add(category.slug)

    return [
      {
        slug: category.slug,
        title: category.title,
        reason: selection.reason,
      },
    ]
  })
}

const fallbackChoices = (products: WoltProduct[], settings: AppSettings): LlmSuggestionChoice[] => {
  const byRestaurant = new Map<string, WoltProduct[]>()
  const maxItemsPerBundle = Math.max(1, Math.min(3, settings.peopleCount + 1))

  for (const product of products) {
    const group = byRestaurant.get(product.restaurantSlug) ?? []
    group.push(product)
    byRestaurant.set(product.restaurantSlug, group)
  }

  const groups = settings.requireSingleRestaurant
    ? Array.from(byRestaurant.values())
    : Array.from({ length: settings.suggestionCount }, (_, index) =>
        products.slice(index * maxItemsPerBundle, (index + 1) * maxItemsPerBundle),
      ).filter((group) => group.length > 0)

  return groups.slice(0, settings.suggestionCount).map((group, index) => {
    const pickedItems = group.slice(0, maxItemsPerBundle)
    return {
      title: `Bundle ${index + 1}`,
      restaurantSlug: pickedItems[0]?.restaurantSlug,
      itemIds: pickedItems.map((product) => product.id),
      quantities: Object.fromEntries(pickedItems.map((product) => [product.id, 1])),
      shortSummary: 'A popular option from the available Wolt products.',
    }
  })
}

const hydrateSuggestions = (
  choices: LlmSuggestionChoice[],
  products: WoltProduct[],
  settings: AppSettings,
) => {
  const byId = new Map(products.map((product) => [product.id, product]))

  return choices.flatMap<FoodSuggestion>((choice) => {
    const candidateProducts = choice.itemIds.flatMap((itemId) => {
      const product = byId.get(itemId)
      return product ? [product] : []
    })

    const sameRestaurantProducts = settings.requireSingleRestaurant
      ? candidateProducts.filter((product) => product.restaurantSlug === (choice.restaurantSlug ?? candidateProducts[0]?.restaurantSlug))
      : candidateProducts

    if (sameRestaurantProducts.length === 0) return []

    const firstProduct = sameRestaurantProducts[0]
    const restaurantNames = Array.from(new Set(sameRestaurantProducts.map((product) => product.restaurantName)))
    const items = sameRestaurantProducts.map((product) => {
      const quantity = Math.max(1, Math.round(choice.quantities?.[product.id] ?? 1))

      return {
        id: product.id,
        name: product.name,
        description: product.description,
        quantity,
        unitPrice: product.price,
        totalPrice: product.price * quantity,
        imageUrl: product.imageUrl,
        url: product.url,
        restaurantName: product.restaurantName,
        restaurantSlug: product.restaurantSlug,
        categoryName: product.categoryName,
      }
    })

    return [
      {
        id: createId('suggestion'),
        title: choice.title,
        restaurantName: restaurantNames.length === 1 ? firstProduct.restaurantName : 'Multiple restaurants',
        restaurantSlug: firstProduct.restaurantSlug,
        restaurantUrl: `https://wolt.com/${settings.language}/${settings.country}/${settings.city}/restaurant/${firstProduct.restaurantSlug}`,
        summary: choice.shortSummary,
        items,
        totalPrice: items.reduce((sum, item) => sum + item.totalPrice, 0),
        currency: firstProduct.currency,
        imageUrl: items.find((item) => item.imageUrl)?.imageUrl,
        deliveryEstimate: firstProduct.deliveryEstimate,
      },
    ]
  })
}

function ProductNavigator({ suggestion }: { suggestion: FoodSuggestion }) {
  const [productIndex, setProductIndex] = useState(0)
  const activeItem = suggestion.items[Math.min(productIndex, suggestion.items.length - 1)]
  const hasMultipleProducts = suggestion.items.length > 1

  if (!activeItem) return null

  return (
    <div className="product-viewer">
      <div className="product-media">
        <a href={activeItem.url} target="_blank" rel="noreferrer" aria-label={`Open ${activeItem.name} in Wolt`}>
          {activeItem.imageUrl ? <img src={activeItem.imageUrl} alt="" /> : <div className="image-fallback" />}
        </a>
      </div>

      <div className="product-detail">
        <p className="eyebrow">{activeItem.restaurantName}</p>
        <div className="product-heading-row">
          <a href={activeItem.url} target="_blank" rel="noreferrer" className="product-title">
            {activeItem.name}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
          {hasMultipleProducts ? (
            <div className="product-stepper" role="group" aria-label="Bundle product navigation">
              <button
                type="button"
                className="icon-button"
                onClick={() => setProductIndex((current) => Math.max(0, current - 1))}
                disabled={productIndex === 0}
                aria-label="Previous product"
                title="Previous product"
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
              <span>
                {productIndex + 1} / {suggestion.items.length}
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setProductIndex((current) => Math.min(suggestion.items.length - 1, current + 1))}
                disabled={productIndex === suggestion.items.length - 1}
                aria-label="Next product"
                title="Next product"
              >
                <ArrowDown size={16} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
        <p>{activeItem.description}</p>
        <div className="suggestion-meta">
          <span>
            {activeItem.quantity} x {formatPrice(activeItem.unitPrice, suggestion.currency)}
          </span>
          <strong>{formatPrice(activeItem.totalPrice, suggestion.currency)}</strong>
        </div>
      </div>
    </div>
  )
}

function LoadingDots() {
  return (
    <span className="loading-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}

function SuggestionCarousel({ suggestions }: { suggestions: FoodSuggestion[] }) {
  const [index, setIndex] = useState(0)
  const suggestion = suggestions[index]

  if (!suggestion) return null

  return (
    <div className="suggestion-carousel">
      <div className="carousel-toolbar">
        <button
          type="button"
          className="icon-button"
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
          disabled={index === 0}
          aria-label="Previous suggestion"
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <span>
          {index + 1} / {suggestions.length}
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={() => setIndex((current) => Math.min(suggestions.length - 1, current + 1))}
          disabled={index === suggestions.length - 1}
          aria-label="Next suggestion"
        >
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>

      <article className="suggestion-card">
        <div className="suggestion-body">
          <div>
            <p className="eyebrow">{suggestion.restaurantName}</p>
            <h3>{suggestion.title}</h3>
          </div>
          <p>{suggestion.summary}</p>
          <ProductNavigator key={suggestion.id} suggestion={suggestion} />
          <ul>
            {suggestion.items.map((item) => (
              <li key={item.id}>
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.quantity} x {item.name}
                  {suggestion.restaurantName === 'Multiple restaurants' ? <small>{item.restaurantName}</small> : null}
                </a>
                <strong>{formatPrice(item.totalPrice, suggestion.currency)}</strong>
              </li>
            ))}
          </ul>
          <div className="suggestion-meta">
            <span>{formatPrice(suggestion.totalPrice, suggestion.currency)}</span>
            {suggestion.deliveryEstimate ? <span>{suggestion.deliveryEstimate} min</span> : null}
          </div>
        </div>
      </article>
    </div>
  )
}

function ChatBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={`message-row ${message.role}`}>
      <div className={`message-bubble ${message.status}`}>
        <p>
          {message.content}
          {message.status === 'loading' ? <LoadingDots /> : null}
        </p>
        {message.suggestions ? <SuggestionCarousel suggestions={message.suggestions} /> : null}
      </div>
    </div>
  )
}

function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sessionMode, setSessionMode] = useState<SessionMode>('idle')
  const [inputValue, setInputValue] = useState('')
  const [initialRequest, setInitialRequest] = useState('')
  const [feedbackHistory, setFeedbackHistory] = useState<string[]>([])
  const [rejectedSuggestions, setRejectedSuggestions] = useState<FoodSuggestion[]>([])
  const [catalog, setCatalog] = useState<ProductCatalog | null>(null)
  const activeRun = useRef<AbortController | null>(null)

  const chatEnabled = sessionMode === 'awaiting-request' || sessionMode === 'awaiting-feedback'
  const showStartButton = sessionMode === 'idle' || sessionMode === 'completed' || sessionMode === 'error'
  const currentSuggestions = useMemo(
    () => messages.findLast((message) => message.suggestions)?.suggestions ?? [],
    [messages],
  )

  const updateSettings = (nextSettings: AppSettings) => {
    setSettings(nextSettings)
    saveSettings(nextSettings)
  }

  const resetSettings = () => {
    clearSettings()
    const defaults = createDefaultSettings()
    setSettings(defaults)
    saveSettings(defaults)
  }

  const persistWoltAuthTokens = (tokens: { accessToken: string; refreshToken: string }) => {
    setSettings((current) => {
      const nextSettings = {
        ...current,
        woltAuthToken: tokens.accessToken,
        woltRefreshToken: tokens.refreshToken,
      }
      saveSettings(nextSettings)
      return nextSettings
    })
  }

  const addMessage = (message: Omit<ChatMessage, 'id'>) => {
    const id = createId('message')
    setMessages((current) => [...current, { id, ...message }])
    return id
  }

  const replaceMessage = (messageId: string, patch: Partial<ChatMessage>) => {
    setMessages((current) => current.map((message) => (message.id === messageId ? { ...message, ...patch } : message)))
  }

  const startSession = () => {
    activeRun.current?.abort()
    activeRun.current = null
    setMessages([
      {
        id: createId('message'),
        role: 'assistant',
        content: 'What would you like to order?',
        status: 'normal',
      },
    ])
    setInitialRequest('')
    setFeedbackHistory([])
    setRejectedSuggestions([])
    setCatalog(null)
    setInputValue('')
    setSessionMode('awaiting-request')
  }

  const cancelSession = () => {
    activeRun.current?.abort()
    activeRun.current = null
    setMessages((current) =>
      current.map((message) =>
        message.status === 'loading'
          ? { ...message, content: `${message.content.replace(/\.*$/, '')} cancelled.`, status: 'cancelled' }
          : message,
      ),
    )
    setInputValue('')
    setSessionMode('idle')
  }

  const failRun = (messageId: string, error: unknown) => {
    const content = error instanceof Error ? error.message : 'Something went wrong.'
    replaceMessage(messageId, { content, status: 'error' })
    setSessionMode('error')
  }

  const chooseSuggestions = async ({
    runCatalog,
    runInitialRequest,
    latestFeedback,
    runFeedbackHistory,
    runRejectedSuggestions,
    loadingMessageId,
    signal,
  }: {
    runCatalog: ProductCatalog
    runInitialRequest: string
    latestFeedback: string
    runFeedbackHistory: string[]
    runRejectedSuggestions: FoodSuggestion[]
    loadingMessageId: string
    signal: AbortSignal
  }) => {
    const rejectedItemIds = getRejectedItemIds(runRejectedSuggestions)
    const availableProducts = runCatalog.products.filter((product) => !rejectedItemIds.has(product.id))

    if (availableProducts.length === 0) {
      throw new Error('There are no Wolt products left to suggest after the declined options.')
    }

    replaceMessage(loadingMessageId, { content: 'Choosing menu suggestions' })

    const prompt = buildSuggestionPrompt({
      settings,
      catalog: runCatalog,
      availableProducts,
      initialRequest: runInitialRequest,
      latestFeedback,
      feedbackHistory: runFeedbackHistory,
      rejectedSuggestions: runRejectedSuggestions,
      currentStep: latestFeedback
        ? 'The user declined the previous suggestions and gave new feedback.'
        : 'The user is waiting for the first set of suggestions.',
    })
    const llmContent = await callLlm(settings, prompt, signal)
    const parsedChoices = parseSuggestionSelection(llmContent)
    let suggestions = hydrateSuggestions(parsedChoices, availableProducts, settings)

    if (suggestions.length === 0) {
      suggestions = hydrateSuggestions(fallbackChoices(availableProducts, settings), availableProducts, settings)
    }

    if (suggestions.length === 0) {
      throw new Error('The LLM did not choose any usable Wolt products.')
    }

    replaceMessage(loadingMessageId, {
      content: 'I found a few options.',
      status: 'normal',
      suggestions: suggestions.slice(0, settings.suggestionCount),
    })
    setSessionMode('suggestions-ready')
  }

  const runInitialOrder = async (request: string) => {
    const controller = new AbortController()
    activeRun.current = controller
    const loadingMessageId = addMessage({ role: 'assistant', content: 'Choosing Wolt categories', status: 'loading' })

    try {
      const categoryPrompt = buildCategoryPrompt(settings, request)
      const categoryContent = await callLlm(settings, categoryPrompt, controller.signal)
      const selectedCategories = applyCategoryWhitelist(parseCategorySelection(categoryContent)).slice(0, settings.maxCategories)

      if (selectedCategories.length === 0) {
        throw new Error('The LLM did not select any known Wolt categories.')
      }

      replaceMessage(loadingMessageId, {
        content: `Fetching Wolt data for ${normalizeSelectedCategories(selectedCategories)}`,
      })

      const runCatalog = await collectProductsForCategories({
        categories: selectedCategories,
        knownCategories: WOLT_CATEGORIES,
        settings,
        signal: controller.signal,
        onPhase: (phase) => replaceMessage(loadingMessageId, { content: phase }),
        onAuthTokenRefreshed: persistWoltAuthTokens,
      })

      if (runCatalog.products.length === 0) {
        throw new Error('Wolt returned no popular products for the selected categories.')
      }

      setCatalog(runCatalog)
      await chooseSuggestions({
        runCatalog,
        runInitialRequest: request,
        latestFeedback: '',
        runFeedbackHistory: [],
        runRejectedSuggestions: [],
        loadingMessageId,
        signal: controller.signal,
      })
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) failRun(loadingMessageId, error)
    } finally {
      if (activeRun.current === controller) activeRun.current = null
    }
  }

  const runFeedbackOrder = async (feedback: string) => {
    if (!catalog) {
      addMessage({ role: 'assistant', content: 'The scraped product list is missing. Start a new order.', status: 'error' })
      setSessionMode('error')
      return
    }

    const nextFeedbackHistory = [...feedbackHistory, feedback]
    setFeedbackHistory(nextFeedbackHistory)

    const controller = new AbortController()
    activeRun.current = controller
    const loadingMessageId = addMessage({ role: 'assistant', content: 'Reworking the suggestions', status: 'loading' })

    try {
      await chooseSuggestions({
        runCatalog: catalog,
        runInitialRequest: initialRequest,
        latestFeedback: feedback,
        runFeedbackHistory: nextFeedbackHistory,
        runRejectedSuggestions: rejectedSuggestions,
        loadingMessageId,
        signal: controller.signal,
      })
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) failRun(loadingMessageId, error)
    } finally {
      if (activeRun.current === controller) activeRun.current = null
    }
  }

  const submitMessage = () => {
    const text = inputValue.trim()
    if (!text || !chatEnabled) return

    addMessage({ role: 'user', content: text, status: 'normal' })
    setInputValue('')
    setSessionMode('processing')

    if (!initialRequest) {
      setInitialRequest(text)
      void runInitialOrder(text)
      return
    }

    void runFeedbackOrder(text)
  }

  const rejectCurrentSuggestions = () => {
    setRejectedSuggestions((current) => [...current, ...currentSuggestions])
    addMessage({ role: 'assistant', content: 'What should I change?', status: 'normal' })
    setSessionMode('awaiting-feedback')
  }

  const thankAssistant = () => {
    addMessage({ role: 'user', content: 'Thanks', status: 'normal' })
    addMessage({ role: 'assistant', content: 'Enjoy your food.', status: 'normal' })
    setSessionMode('completed')
  }

  return (
    <main className="app-shell">
      <section className="chat-shell" aria-label="Foodie Assistant chat">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Wolt AI Assistant</p>
            <h1>Foodie Assistant</h1>
          </div>
          {sessionMode === 'processing' ? (
            <button type="button" className="secondary-button danger" onClick={cancelSession}>
              <X size={16} aria-hidden="true" />
              Cancel
            </button>
          ) : showStartButton ? (
            <button type="button" className="primary-button" onClick={startSession}>
              <Sparkles size={17} aria-hidden="true" />
              I want to order
            </button>
          ) : (
            <button type="button" className="secondary-button" onClick={cancelSession}>
              <X size={16} aria-hidden="true" />
              End session
            </button>
          )}
        </header>

        <div className="messages-pane">
          {messages.length === 0 ? (
            <div className="empty-state">
              <Sparkles size={28} aria-hidden="true" />
              <p>Ready when you are.</p>
            </div>
          ) : (
            messages.map((message) => <ChatBubble key={message.id} message={message} />)
          )}
        </div>

        {sessionMode === 'suggestions-ready' ? (
          <div className="decision-bar">
            <button type="button" className="secondary-button" onClick={rejectCurrentSuggestions}>
              <X size={16} aria-hidden="true" />
              I don't like this
            </button>
            <button type="button" className="primary-button" onClick={thankAssistant}>
              <Check size={16} aria-hidden="true" />
              Thanks
            </button>
          </div>
        ) : null}

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault()
            submitMessage()
          }}
        >
          <textarea
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            disabled={!chatEnabled}
            rows={2}
            placeholder={chatEnabled ? 'What sounds good?' : 'Start an order to chat'}
          />
          <button type="submit" className="send-button" disabled={!chatEnabled || !inputValue.trim()} aria-label="Send">
            <Send size={18} aria-hidden="true" />
          </button>
        </form>
      </section>

      <SettingsPanel settings={settings} onChange={updateSettings} onReset={resetSettings} />
    </main>
  )
}

export default App
