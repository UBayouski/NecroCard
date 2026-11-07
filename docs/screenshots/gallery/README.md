# Screenshot gallery

Seven curated shots of the live build. They feed the main README and the Devpost gallery, and they are retaken
whenever a change alters what a user sees (see "Screenshots stay current" in `.kiro/steering/retro-ui.md`).
Every PNG is exactly 1280 by 1024 CSS pixels at device scale 1. The older files directly in `docs/screenshots/` are
cited by `KIRO_USAGE.md` and `docs/SUBMISSION.md` and are not part of this set.

## Files

- `01-title.png`: the title card of the default stack (The Haunted Quiz), Browse mode, clean profile: centred title and button, and the message box hint at the bottom.
- `02-browse.png`: Browse mode on card Q2 of The Haunted Quiz, with the question field and three answer buttons.
- `03-edit-mode.png`: Edit mode on Q2 with the "B) October" button selected (outline, handles) and its inspector open.
- `04-script-editor.png`: the expanded NecroTalk script editor on that button's real `mouseUp` script.
- `05-summon.png`: a Summoned stack ("Haunted Candy") open in Browse mode with the counter at 3.
- `06-library.png`: the stack library at work: three own stacks ("Ghost Recipes", "Crypt Notes", "Haunted Candy") in the library, with the closed picker showing "Haunted Candy" and its Delete confirmation open.
- `07-share.png`: The Cursed Manor opened from a share link (`#s=...`) on a clean profile: the picker names it "The Cursed Manor (shared)" and the status line reads "Opened from a shared link" in the neutral info style (dark chrome text, not the error red).
- `summon-stack.json`: the stack Gemini produced for shot 05, saved once so the shot never needs another Gemini call.

The Summon prompt that produced `summon-stack.json` was: "A haunted candy counter: a field showing candy count, a
Add Candy button, a Reset button, and a Thanks card."

## How to retake

### Setup (all shots)

1. In `d:\Projects\Kiroween\necrocard` run `npm run dev`. It listens on `http://localhost:5173`; if that port is
   taken by another project Vite prints a different port (the current set was shot on `http://localhost:5174`). Use
   the port Vite prints. No Gemini server is needed for a retake.
2. Drive the browser with the Playwright MCP server from `.kiro/settings/mcp.json`.
3. Set the viewport: `browser_resize` width 1280, height 1024. Take every shot with `browser_take_screenshot`
   (`type` png, `scale` css) and a `filename` of `docs/screenshots/gallery/<name>.png`. The viewport is saved, not the
   full page.
4. "Clean profile" means: `browser_evaluate` with `() => { localStorage.clear(); sessionStorage.clear(); }`, then
   `browser_navigate` to the shot's URL. Do this before shots 01, 05, 06 (start) and 07. Check afterwards that
   `Object.keys(localStorage)` has only `necrocard.library` and, where a stack is open, its entry key.
5. Wait for the card to appear (the picker shows the stack name) before shooting. Do not hover anything.
6. File choosers: use `browser_click` on Import and then `browser_file_upload`. A `waitForEvent('filechooser')` inside
   `browser_run_code_unsafe` leaves stray choosers behind, because the MCP server also takes the chooser.

### 01-title.png

1. Clean profile, then navigate to `http://localhost:5173/`. The app redirects to `/?stack=quiz`.
2. Screenshot. The card shown is "Title" of The Haunted Quiz; nothing has been clicked.

### 02-browse.png

1. Clean profile, navigate to `http://localhost:5173/?stack=quiz`.
2. Click the "Enter if you dare..." button (card Q1), then click "B) A vampire" (goes to Q2).
3. Check `data-card-name` on the card is `Q2` and `data-busy` is `false`, then screenshot.

### 03-edit-mode.png

1. Continue from 02 (card Q2, Browse mode).
2. Click the "Edit" radio in the toolbar.
3. Select the "B) October" button by clicking it on the card with a real mouse click at page coordinates
   (519, 580). The card is inert in Edit mode, so a locator click times out; use `page.mouse.click(519, 540)` in
   `browser_run_code_unsafe`. At 1280 by 1024 the card is drawn at 1x (about 514 by 344 px) left of the inspector.
4. Confirm the inspector title reads `Button "AnswerB"` with X 64, Y 194, W 384, H 40 and the Undo button still disabled, then screenshot.

### 04-script-editor.png

1. Continue from 03 with the button still selected.
2. Click "Expand" under the inspector's Script box. The script editor dialog opens on the `mouseUp` script.
3. Screenshot. Afterwards click the first "Close" button and the "Browse" radio.

### 05-summon.png (no Gemini call)

1. Clean profile, navigate to `http://localhost:5173/`.
2. Click "Share", then "Import", and choose `docs/screenshots/gallery/summon-stack.json` in the file chooser
   (`browser_file_upload`, absolute path). The stack opens in Edit mode.
3. Click the "Browse" radio.
4. Click "Add Candy" three times, about 400 ms apart, so the count reads 3.
5. Screenshot.

To regenerate `summon-stack.json` (rarely needed, it calls Gemini): copy `.env.example` to `.env`, set
`GEMINI_API_KEY`, run `npm run server:dev` in a second terminal, clean profile, click "Summon", type the prompt above,
click "Summon" in the dialog, and when the stack opens save
`JSON.parse(localStorage.getItem('necrocard.library.entry.<id>'))` (the id is the only entry key) to the file.
The output differs on every run, so every later shot 05 must be retaken from the new file.

### 06-library.png

Real, unstyled UI only: no temporary styles and no forced-open select.

1. Clean profile, navigate to `http://localhost:5173/`.
2. Click "Share", then "Import" (inside the dialog), and choose `docs/screenshots/gallery/summon-stack.json`. The
   stack "Haunted Candy" joins the library and opens in Edit mode.
3. Click "New Stack". In the inspector, change the Stack section's Name box (it reads "Untitled") to `Crypt Notes`
   and press Tab. After the autosave the picker lists the new name under "My stacks".
4. Click "New Stack" again and rename the new stack to `Ghost Recipes` the same way. The picker's "My stacks" group
   now holds Ghost Recipes, Crypt Notes and Haunted Candy.
5. Choose "Haunted Candy" in the picker (`browser_select_option` on the `select`). It opens with the count at 0.
6. Click the toolbar "Delete" button. The "Delete stack" confirmation opens over the card.
7. Screenshot, then click "Cancel" so nothing is deleted.

### 07-share.png

1. Get a link: clean profile, navigate to `http://localhost:5173/?stack=adventure`, click "Share" and read the link
   from the dialog (`document.querySelector('dialog input, dialog textarea').value`, about 1450 characters).
2. Clean profile again, navigate to `about:blank`, then navigate to the link (`http://localhost:5173/#s=...`).
3. Confirm the library index holds one entry, "The Cursed Manor (shared)" (the name matches a sample, so the import
   gets the " (shared)" suffix), the address bar fragment is gone, and the status line reads "Opened from a shared
   link", then screenshot. The stack opens in Browse mode on its first card. Do not click or type first: the next
   action clears the status line.
