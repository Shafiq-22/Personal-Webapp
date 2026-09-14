# Cortex web clipper

A Manifest V3 extension that saves the page you are reading into your Cortex
library, optionally with a task to read it properly later.

## What it does

- Reads the page's own metadata — `citation_*` tags, Open Graph, JSON-LD — so a
  paper arrives with its authors, DOI, journal and publication date rather than
  just a URL
- Uses your text selection as the note when you have one
- Deduplicates against the monitored feed by canonical URL, so clipping
  something a feed later publishes does not create a second entry
- Right-click menu and `Cmd/Ctrl+Shift+S` for saving without opening the popup

## Installing

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select
   this folder
2. Open the extension's options and set your Cortex address and access token
   (Settings → Devices in the web app)

## Notes

There is no build step and no bundler: it is three small ES modules, and adding
a toolchain would make it harder to audit than it is to read.

The extension never calls a model. Saved items are ranked by the server's
deterministic scorer, and rewritten into summaries only on your iPhone.
