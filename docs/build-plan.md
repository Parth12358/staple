# Staple — Build Plan & Current State

Browser extension where an animated cat character lives on any webpage, reads the DOM, and guides you to any UI element when you ask in natural language.

## How It Works

- **DOM scraping** — scans 12 types of interactive elements (buttons, links, inputs, ARIA roles) on the current page, capped at 150
- **DeepSeek** — natural language query returns a single element ID + instruction, written in imperative voice, no emojis
- **Animated cat character** — pixel-art sprite sheet with 6 animation states (idle, walking, thinking, paw, sleep, clean), organic idle behaviors
- **Inline query** — click the cat on the page to open an input, type a question, cat navigates to the element and shows instructions
- **Scroll-aware navigation** — uses `scrollIntoView()` on the target element, handles both window-scroll and SPA child-container scroll
- **Settings popup** — API key management only; no chat interface
- **Cross-browser** — single source in `src/`, dual build for Chrome MV3 + Firefox MV2

## Architecture

```
                     ┌─────────── DeepSeek API
                     │
content.js  ──QUERY──▶  background.js
     │
     ├── DOM scraping (12 selectors, 150 max, debounced observer)
     ├── Cat character + sprite animations + walk transition
     ├── Inline query UI (click cat → input → submit)
     ├── Bubble display with fade-in + tail, dark theme
     ├── Scroll-to-element via scrollIntoView + scroll-end detection
     ├── 300ms scroll re-scrape for fresh elementMap
     └── resize listener clamps cat to viewport
```

### Communication Flow
| Direction | Method | Use |
|-----------|--------|-----|
| Content Script → Background | `runtime.sendMessage` `QUERY` | Send question + elementMap to DeepSeek |
| Background → Content Script | `sendResponse` | Return `{ elementId, instruction, context }` |

### API Keys
- DeepSeek API key stored in `storage.sync`
- Configured via the popup settings page

## Project Structure

```
staple/
├── staple/
│   ├── src/
│   │   ├── content.js           # DOM scraper, cat character, inline query UI, scroll nav
│   │   ├── content.css          # Cat sprite animations, bubble (dark + tail), inline input
│   │   ├── background.js        # DeepSeek API proxy, QUERY handler
│   │   ├── popup.js             # Settings (API key save/load)
│   │   └── popup.html           # Settings panel
│   ├── chrome/                  # Chrome MV3 build output
│   │   └── manifest.json        # MV3: service_worker, web_accessible_resources
│   ├── firefox/                 # Firefox MV2 build output
│   │   └── manifest.json        # MV2: scripts array, browser_action
│   ├── icons/
│   │   ├── cat_sprite.png       # 640x800px sprite sheet (8 columns)
│   │   └── cat_icon.png         # 80x80px cropped icon
│   └── build.sh
└── README.md
```

## Build & Load

```bash
cd staple
./build.sh
```

**Chrome:** `chrome://extensions` → Developer mode → Load unpacked → select `staple/chrome/`

**Firefox:** `about:debugging` → This Firefox → Load Temporary Add-on → select `staple/firefox/manifest.json`

## Cat Character States

| State | CSS Class | Sprite Y-offset | Behavior |
|-------|-----------|-----------------|----------|
| idle | `state-idle` | 0px | 4-frame loop, default state |
| walking | `state-walking` | -320px | 8-frame loop, during movement |
| thinking | `state-thinking` | -720px | 4-frame loop, during API call |
| paw | `state-paw` | -560px | 6-frame one-shot, on arrival |
| sleep | `state-sleep` | -480px | 4-frame loop, after 5s idle |
| clean | `state-clean` | -160px | 4-frame one-shot, random idle behavior |

Auto-sleeps after 5s idle, random cleaning every 15-30s.

## Key Implementation Details

### DOM Scraper
- 12 selectors: `button, a, input, select, textarea` + ARIA roles + `nav *, header *`
- Label priority: `innerText` → `aria-label` → `placeholder` → `title` → `alt` → `tagName`
- Only visible elements with positive dimensions included
- Stores `el` reference for `scrollIntoView()` targeting
- Coordinates are `getBoundingClientRect` + `window.scrollX/Y`
- MutationObserver with 300ms debounce re-scrapes on DOM changes
- Scroll listener (300ms debounce) re-scrapes after scroll stops

### DeepSeek Integration
- Endpoint: `https://api.deepseek.com/chat/completions`
- Model: `deepseek-v4-flash`, `response_format: json_object`, `max_tokens: 800`
- Output: `{ "elementId": <number|null>, "instruction": "...", "context": "..." }`
- System prompt: imperative voice, no emojis, plain sentences
- Stateless — no conversation history sent

### Inline Query Flow
1. User clicks cat → input box opens near cat
2. Types question, presses Enter or clicks "Ask"
3. Content script scrapes elementMap, sends QUERY to background
4. Background proxies to DeepSeek with system prompt + elementMap
5. Response: `elementId` found → `scrollIntoView()` on target element, wait for scroll end, get fresh `getBoundingClientRect()`, move cat with CSS transition + walking animation
6. Element not found → bubble shows instruction at current cat position
7. Bubble fades in with slide-up, dark background, subtle border, diamond tail pointing at cat
8. Context field shown 3s after instruction if non-empty
9. After 7s total, cat walks home, bubble hides, cat resets

### Scroll Navigation
- `scrollIntoView({ behavior: 'smooth', block: 'center' })` on target element — works on both window-scroll and SPA child-container pages
- `getScrollContainer()` detects the nearest scrollable ancestor for attaching scroll-end listener
- `waitForScrollEnd()` uses 150ms debounce on container scroll events + 1200ms fallback
- `activeScrollCleanup` cancels in-flight scrolls on new query or reset
- `requestAnimationFrame` wraps coordinate read after scroll completes

## TODO / Future Work

- [ ] Model selection (support multiple AI providers beyond DeepSeek)
- [ ] Per-site exclusion / blacklist
- [ ] Theming options for the cat character
- [ ] Unit tests and integration tests
- [ ] Error reporting / crash tracking
- [ ] Graceful fallback when content script fails to inject on restricted pages
