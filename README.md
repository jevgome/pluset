# Pluset

A browser extension that captures your zyBooks sections and (soon) generates extra
practice problems from them, using only the book's content.

Captured content stays on your computer (extension storage). Nothing is sent anywhere
except to zyBooks itself, and later to the AI provider you choose.

## Status

- [x] Milestone 1: capture sections from zyBooks and view what was captured
- [x] Milestone 2: new versions of challenge activities from the book's generator code
- [ ] Milestone 3: practice page with answer checking
- [ ] Milestone 4: AI-generated problems (Claude), with a book-only grounding check
- [ ] Milestone 5: more AI providers, generated diagrams

## Build

Requires Node 22 (`nvm use`).

```sh
npm install
npm run build      # outputs dist/
npm test
```

## Install in Chrome / Edge

1. Go to `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.
3. Click the Pluset icon in the toolbar to open the app.

After rebuilding, click the reload icon on the extension card.

## Use

1. Log into zyBooks in another tab and open your book.
2. In Pluset, click **Connect to zyBooks**. It fills in the book code from your tab.
3. Enter sections (`8.5`, `8.1-8.4`, or `8` for a whole chapter) and click **Capture**.
4. Pick a section in the library to check what was captured.

The viewer never shows answers or solutions to the book's own (graded) activities;
that data is only used behind the scenes for generating and checking new problems.

Each challenge activity has a **Practice a new version** button. It runs the book's own
generator code (in Python, inside the browser via Pyodide) with fresh random values, checks
your answers using the book's tolerances, and shows the worked solution once you've tried.
The first problem takes a few seconds while Python loads.

## Tests with real data

Saved zyBooks responses (`5.json`, `activity_data.json`, `participation_data.json`, or
files in `samples/`) are picked up by the tests when present. They are gitignored:
the content is copyrighted, so don't commit it.
