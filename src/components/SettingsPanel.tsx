import {
  Bot,
  Clock,
  KeyRound,
  MapPin,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Store,
  Users,
  Wallet,
} from 'lucide-react'
import { LLM_PROVIDER_PRESETS } from '../settings'
import type { AppSettings, LlmProvider } from '../types'

interface SettingsPanelProps {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onReset: () => void
}

const numberValue = (value: string, fallback: number) => {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

export function SettingsPanel({ settings, onChange, onReset }: SettingsPanelProps) {
  const provider = settings.llmProvider ?? 'openai'
  const patchSettings = (patch: Partial<AppSettings>) => onChange({ ...settings, ...patch })
  const setProvider = (provider: LlmProvider) => {
    const preset = LLM_PROVIDER_PRESETS[provider]

    patchSettings({
      llmProvider: provider,
      llmApiUrl: preset.llmApiUrl,
      llmModel: preset.llmModel,
      llmAuthHeaderName: preset.llmAuthHeaderName,
    })
  }

  return (
    <aside className="settings-panel" aria-label="Settings">
      <div className="panel-heading">
        <Settings size={18} aria-hidden="true" />
        <h2>Settings</h2>
        <button type="button" className="icon-button" onClick={onReset} aria-label="Reset settings">
          <RotateCcw size={16} aria-hidden="true" />
        </button>
      </div>

      <section className="settings-group">
        <h3>
          <Bot size={16} aria-hidden="true" />
          LLM
        </h3>
        <label>
          Provider
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as LlmProvider)}
          >
            <option value="openai">OpenAI compatible</option>
            <option value="gemini">Gemini generateContent</option>
          </select>
        </label>
        <label>
          API URL
          <input
            value={settings.llmApiUrl}
            onChange={(event) => patchSettings({ llmApiUrl: event.target.value })}
            placeholder={LLM_PROVIDER_PRESETS[provider].llmApiUrl}
          />
        </label>
        <label>
          Model
          <input value={settings.llmModel} onChange={(event) => patchSettings({ llmModel: event.target.value })} />
        </label>
        <label>
          <span>
            <KeyRound size={14} aria-hidden="true" />
            API key
          </span>
          <input
            type="password"
            value={settings.llmApiKey}
            onChange={(event) => patchSettings({ llmApiKey: event.target.value })}
          />
        </label>
        <label>
          Auth header
          <input
            value={settings.llmAuthHeaderName}
            onChange={(event) => patchSettings({ llmAuthHeaderName: event.target.value })}
          />
        </label>
      </section>

      <section className="settings-group">
        <h3>
          <Store size={16} aria-hidden="true" />
          Wolt
        </h3>
        <label>
          Access token
          <input
            type="password"
            value={settings.woltAuthToken}
            onChange={(event) => patchSettings({ woltAuthToken: event.target.value })}
          />
        </label>
        <label>
          Refresh token
          <input
            type="password"
            value={settings.woltRefreshToken}
            onChange={(event) => patchSettings({ woltRefreshToken: event.target.value })}
          />
        </label>
        <label>
          Auth header
          <input
            value={settings.woltAuthHeaderName}
            onChange={(event) => patchSettings({ woltAuthHeaderName: event.target.value })}
          />
        </label>
        <div className="grid-two">
          <label>
            <span>
              <MapPin size={14} aria-hidden="true" />
              Lat
            </span>
            <input
              type="number"
              value={settings.latitude}
              onChange={(event) => patchSettings({ latitude: numberValue(event.target.value, settings.latitude) })}
            />
          </label>
          <label>
            Lon
            <input
              type="number"
              value={settings.longitude}
              onChange={(event) => patchSettings({ longitude: numberValue(event.target.value, settings.longitude) })}
            />
          </label>
        </div>
        <div className="grid-two">
          <label>
            City
            <input value={settings.city} onChange={(event) => patchSettings({ city: event.target.value })} />
          </label>
          <label>
            Country
            <input value={settings.country} onChange={(event) => patchSettings({ country: event.target.value })} />
          </label>
        </div>
      </section>

      <section className="settings-group">
        <h3>
          <SlidersHorizontal size={16} aria-hidden="true" />
          Order
        </h3>
        <div className="grid-two">
          <label>
            Categories
            <input
              type="number"
              min={1}
              max={8}
              value={settings.maxCategories}
              onChange={(event) => patchSettings({ maxCategories: numberValue(event.target.value, settings.maxCategories) })}
            />
          </label>
          <label>
            Suggestions
            <input
              type="number"
              min={1}
              max={8}
              value={settings.suggestionCount}
              onChange={(event) => patchSettings({ suggestionCount: numberValue(event.target.value, settings.suggestionCount) })}
            />
          </label>
        </div>
        <div className="grid-two">
          <label>
            <span>
              <Users size={14} aria-hidden="true" />
              People
            </span>
            <input
              type="number"
              min={1}
              value={settings.peopleCount}
              onChange={(event) => patchSettings({ peopleCount: numberValue(event.target.value, settings.peopleCount) })}
            />
          </label>
          <label>
            <span>
              <Wallet size={14} aria-hidden="true" />
              Budget
            </span>
            <input value={settings.budget} onChange={(event) => patchSettings({ budget: event.target.value })} />
          </label>
        </div>
        <label>
          Special mentions
          <textarea
            rows={3}
            value={settings.specialMentions}
            onChange={(event) => patchSettings({ specialMentions: event.target.value })}
          />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.requireSingleRestaurant}
            onChange={(event) => patchSettings({ requireSingleRestaurant: event.target.checked })}
          />
          Keep each bundle to one restaurant
        </label>
      </section>

      <section className="settings-group">
        <h3>
          <Clock size={16} aria-hidden="true" />
          Scraping
        </h3>
        <div className="grid-two">
          <label>
            Delay ms
            <input
              type="number"
              min={0}
              value={settings.scrapeDelayMs}
              onChange={(event) => patchSettings({ scrapeDelayMs: numberValue(event.target.value, settings.scrapeDelayMs) })}
            />
          </label>
          <label>
            Restaurants
            <input
              type="number"
              min={1}
              max={20}
              value={settings.restaurantsPerCategory}
              onChange={(event) =>
                patchSettings({ restaurantsPerCategory: numberValue(event.target.value, settings.restaurantsPerCategory) })
              }
            />
          </label>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.popularItemsOnly}
            onChange={(event) => patchSettings({ popularItemsOnly: event.target.checked })}
          />
          Only retrieve popular items
        </label>
        <label>
          Popular item limit
          <input
            type="number"
            min={1}
            max={30}
            value={settings.productsPerRestaurant}
            disabled={!settings.popularItemsOnly}
            onChange={(event) =>
              patchSettings({ productsPerRestaurant: numberValue(event.target.value, settings.productsPerRestaurant) })
            }
          />
        </label>
      </section>
    </aside>
  )
}