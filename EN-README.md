# zotero-PaperChat

PaperChat is a clean AI sidebar plugin for Zotero (7 and 8).

## Features (v0.1)

- Sidebar chat UI in reader context
- Preferences-based API setup
- OpenAI-compatible `/chat/completions` request format
- Basic error handling for config, auth, rate limit, and server errors

## Configuration

Open Zotero Preferences -> PaperChat, then set:

- API Key
- API Endpoint (full URL ending with `/chat/completions`)
- Model Name
- Temperature (0 ~ 2)
- System Prompt

## Build

```bash
npm install
npm run build
```

## License

AGPL-3.0-or-later
