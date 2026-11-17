# Pluset

A browser extension that captures your zyBooks sections and (soon) generates extra
practice problems from them, using only the book's content.

Captured content stays on your computer (extension storage). Nothing is sent anywhere
except to zyBooks itself, and later to the AI provider you choose.

## Status

- [x] Milestone 1: capture sections from zyBooks and view what was captured
- [x] Milestone 2: new versions of challenge activities from the book's generator code
- [x] Milestone 3: practice sessions across sections, with progress tracking
- [x] Milestone 4: AI-generated problems (Claude), with a book-only grounding check
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

The library viewer doesn't show answers to the book's own activities; for those, use
the Show answer buttons on the zyBooks page (below) when you want them.

Each challenge activity has a **Practice a new version** button. It runs the book's own
generator code (in Python, inside the browser via Pyodide) with fresh random values, checks
your answers using the book's tolerances, and shows the worked solution once you've tried.
The first problem takes a few seconds while Python loads.

To practice several sections at once, tick them in the library, choose an order
(weakest first, shuffled, or book order) and click **Practice**. A session deals one new
version of every challenge level in those sections and ends with a summary. Results are
saved locally per book, and "weakest first" uses them to bring back what you missed.

## AI-generated problems

Open **AI settings** at the bottom of the sidebar and choose a provider:

- **Claude Code (your Claude plan)** — no API key. Uses your Claude subscription through
  Claude Code on this computer:
  1. In the project folder run `npm run helper` and keep that terminal open.
  2. Copy the token it prints into **Helper token** and click **Test connection**.

  The helper listens only on this computer, accepts only requests with the token, refuses
  requests from web pages, and runs Claude Code with no tools (it can only return text).
  Usage counts toward your plan's limits. Figures are described in text, not sent as images.
- **Claude API (API key)** — pay-as-you-go API access, billed separately from subscriptions.
  The key is stored only in this browser and sent only to Anthropic.

Then either open a section and use **Generate with AI** at the end of it, or tick several
sections in the library and click **Generate AI problems**. Each run:

1. Sends the captured sections (text, tables, figure descriptions and images, the book's
   activities and one worked instance of each challenge level) as the only allowed source.
2. Asks the generator model for multiple-choice, short-answer and numeric problems in the
   book's style. Numeric problems come with Python that randomizes values and computes the
   answers, so the answer key is computed, not guessed, and every practice gets new numbers.
3. Checks each problem locally: structure, its code runs and produces numbers for every
   answer, and its quoted supporting passage really appears in the book.
4. Asks the reviewer model to reject anything that uses outside knowledge, has a wrong
   answer, or is unclear. Only problems that pass are saved.

Saved problems appear under each section and in practice sessions. The result panel shows
what was rejected and why, plus token usage and an estimated cost.

## Cheat sheets

Click **Make a cheat sheet** in the sidebar. Choose your study guide (PDF, Word .docx, text,
Markdown/LaTeX, or an image) and/or tick sections in the library, optionally say what to cover
("Exam 2 topics only"), and click **Make cheat sheet**. The model chosen in AI settings writes a
sheet that is mostly equations, each with the assumptions and conditions for using it and its
special-case forms, plus the key definitions and concepts. It uses only your study guide and the
ticked sections. The study guide decides which topics go on it, and the sections supply the
book's equations and conditions.

The sheet is laid out on at most two pages (Letter or A4, 3 to 5 columns) at the largest font
that fits, never below 6 pt. Long equations wrap instead of shrinking. If it still doesn't fit,
the extra items are marked and left out of downloads; hover over any item and click × to remove
it, and the rest re-flows. **Download PDF** opens the print dialog (choose "Save as PDF");
**Download HTML** saves a self-contained file that works offline. Sheets are saved locally and
can be reopened from **Saved cheat sheets**.

With the Claude API the model reads PDF and image study guides directly. Claude Code gets the
file's text, so scanned PDFs and images need the Claude API.

## Show answer buttons on zyBooks pages

On any section page at learn.zybooks.com, each question of a participation activity gets
its own **Show answer** button (definition-matching activities get one for the whole
activity). Clicking it reveals the book's answer and explanation for just that question.
The section is captured into your library first if it isn't there yet.

Challenge activities are randomized per student, so their **Show answer** button works
differently: it reads the numbers your page shows, reruns the book's own generator code
(Python, in the extension) with random choices steered until it produces exactly the
problem on your page, and then shows that version's answers and the book's worked
solution. It also lists the values it read ("Your values: x = 4, y = 1") so you can check
them, and warns when the page doesn't pin your version down or only a close match was
found. Click it again after moving to another level or starting a new attempt. The first
time loads Python, which takes a few seconds.

Nothing is typed into or submitted on the page. After reloading the extension, reload the
zyBooks tab so the buttons reconnect.

## Tests with real data

Saved zyBooks responses (`5.json`, `activity_data.json`, `participation_data.json`, or
files in `samples/`) are picked up by the tests when present. They are gitignored:
the content is copyrighted, so don't commit it.
