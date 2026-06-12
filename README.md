# Staple

Browser extension that lives on any webpage, reads the DOM, and guides you to any UI element when you ask in natural language.

## Quick Start

```bash
cd staple
./build.sh
```

### Chrome
1. `chrome://extensions` → Developer mode → Load unpacked → select `staple/chrome/`

### Firefox
1. `about:debugging` → This Firefox → Load Temporary Add-on → select `staple/firefox/manifest.json`

## How It Works

- **DOM scraping** — scans all interactive elements (buttons, links, inputs, etc.) on the current page
- **DeepSeek** — natural language query maps user intent to a specific element
- **Animated character** — moves to and highlights the target element on the page
- **Langfuse** — logs every query for observability
- **Cross-browser** — single codebase, Chrome MV3 + Firefox MV2

## Project Structure

```
staple/
├── src/              # Shared source (content script, popup, CSS)
├── chrome/           # Chrome MV3 extension bundle
├── firefox/          # Firefox MV2 extension bundle
├── build.sh          # Copies src/ into chrome/ and firefox/
└── icons/
```
