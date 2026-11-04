# Fonts

NecroCard bundles three open-licensed bitmap-style web fonts. All three are published under the
**SIL Open Font License, Version 1.1**; each license text sits beside its font file. No font is loaded from a CDN at
run time.

In the stylesheets the families are given internal aliases (`NecroUI`, `NecroField`, `NecroScript`), so the
third-party family names never appear in the page's computed styles.

| Role | Alias | Family | Designer | License | Source |
|---|---|---|---|---|---|
| Card button labels, window title, app name, dialog titles | `NecroUI` (8px Regular, 16px Bold) | Silkscreen | Jason Kottke | SIL OFL 1.1 | https://github.com/googlefonts/silkscreen |
| Card field text, chrome body text, dialog prose | `NecroField` (16px, line-height 20px) | DotGothic16 | Fontworks Inc. | SIL OFL 1.1 | https://github.com/fontworks-fonts/DotGothic16 |
| Script editor and message box | `NecroScript` (16px, line-height 20px) | VT323 | Peter Hull | SIL OFL 1.1 | https://github.com/phoikoi/VT323 |

## Files

| File | License file | Weight |
|---|---|---|
| `Silkscreen-Regular.woff2` | `Silkscreen-OFL.txt` | 400 |
| `Silkscreen-Bold.woff2` | `Silkscreen-OFL.txt` | 700 |
| `DotGothic16-Regular-latin.woff2` | `DotGothic16-OFL.txt` | 400 |
| `VT323-Regular.woff2` | `VT323-OFL.txt` | 400 |

## Subsets

**All four files are the `latin` subset** that the Google Fonts CSS API serves (`fonts.googleapis.com/css2`), taken
as the woff2 file whose `unicode-range` is `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC,
U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD`. `fonts.css`
declares the same `unicode-range`, so a character outside it is drawn by the next family in the stack, not as an
empty box.

- **DotGothic16** needs the subset most: the full family covers Japanese and is over a megabyte, while the Latin
  subset is about 10 KB. NecroCard shows only Latin text.
- **Silkscreen** and **VT323** are also taken as their Latin subsets (the API also serves `latin-ext` and, for VT323,
  `vietnamese`; they are not bundled).
- **The OFL permits this.** Subsetting is a modification of the Font Software, which the OFL 1.1 allows (it permits
  use, study, modification and redistribution, provided the license text and copyright notice travel with the files,
  and the fonts are not sold on their own). The license file of each font is committed next to its subset.
- No change was made to any glyph outline; the files are the unmodified subsets served by the API.

## Reserved Font Names

None of the three licenses declares a Reserved Font Name: each copyright line is a plain "Copyright … The <Name>
Project Authors" notice with no "with Reserved Font Name" clause (the phrase appears in each `OFL.txt` only inside the
license's own definitions). The OFL forbids using a declared Reserved Font Name for a *modified* version; since none
is declared, nothing is restricted. The `Necro*` aliases would satisfy such a clause anyway, because the subset files
are used under names that do not include the original family names.

## Copyright notices (from the license files)

- Silkscreen: Copyright 2001 The Silkscreen Project Authors (https://github.com/googlefonts/silkscreen)
- DotGothic16: Copyright 2020 The DotGothic16 Project Authors (https://github.com/fontworks-fonts/DotGothic16)
- VT323: Copyright 2011, The VT323 Project Authors (peter.hull@oikoi.com)

## Where the files came from

The license texts were downloaded from the `google/fonts` repository (`ofl/<family>/OFL.txt`), whose `METADATA.pb`
for each family lists `license: "OFL"`, the designer and the source repository above. The woff2 files were downloaded
from the Google Fonts CSS API's `latin` blocks on 2026-11-04.

NecroCard does not use, name or imitate any proprietary system typeface; these are open-licensed lookalikes in the
classic Macintosh bitmap style.
