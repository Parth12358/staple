# Staple

Browser extension where an animated cat character lives on any webpage, reads the DOM, and guides you to any UI element when you ask in natural language.

## Quick Start

```bash
cd staple
./build.sh
```

1. Chrome: `chrome://extensions` -> Developer mode -> Load unpacked -> select `staple/chrome/`
2. Firefox: `about:debugging` -> This Firefox -> Load Temporary Add-on -> select `staple/firefox/manifest.json`
3. Click the Staple toolbar icon to open settings
4. Select a provider, pick a model, paste your API key, click Save
5. Navigate to any page, click the cat in the bottom-right corner, type your question, press Enter or click Ask

## How It Works

- **DOM scraping** -- scans all interactive elements (buttons, links, inputs, ARIA roles) on the current page
- **Multi-provider LLM** -- natural language query maps user intent to a specific element. Click the cat, type your question, the cat walks to the answer
- **Animated cat character** -- pixel-art sprite sheet with 6 states, scrolls to off-screen elements, shows instructions in a dark speech bubble
- **Cross-browser** -- single source in `src/`, dual build for Chrome MV3 + Firefox MV2

## Supported Providers

| Provider | Models |
|----------|--------|
| DeepSeek | deepseek-v4-flash, deepseek-v4-pro |
| OpenAI | gpt-5.5, gpt-5.4, gpt-5.4-mini |
| Anthropic | claude-opus-4-8, claude-sonnet-4-6, claude-haiku-4-5-20251001 |
| Groq | openai/gpt-oss-120b, qwen/qwen3.6-27b |
| Google Gemini | gemini-2.5-pro, gemini-2.5-flash |
| Ollama (local) | any model |

## Project Structure

```
staple/
├── src/              # Shared source: content.js, content.css, background.js, popup.js, popup.html
├── chrome/           # Chrome MV3 extension bundle (manifest.json + copies of src/ + assets)
├── firefox/          # Firefox MV2 extension bundle (manifest.json + copies of src/ + assets)
├── icons/            # cat_sprite.png (640x800px sprite sheet), cat_icon.png (80x80px icon)
├── build.sh          # Copies src/ and icons/ into chrome/ and firefox/
└── docs/
```
