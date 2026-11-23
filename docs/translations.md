# Translations

The interface can be shown in **Spanish, German, French, Brazilian Portuguese and Japanese** as well as English. Choose the language
in the picker at the top right; the page reloads and remembers your choice in this browser (apart from the saved scenario, so
**Reset** does not change it).

## What is translated, and what is not

The workbench is built from English text in many files, so the language layer translates what appears on the page: tab names, the
settings panel, buttons, field labels, table headers and headings, tooltips and placeholders, and a few common messages (about
260 texts). It is deliberately limited:

* **Long explanations, the help tab, the footer and the guides stay English.** They are long, mixed with links and numbers, and
  would need real translators.
* **Anything with numbers or names in it stays English**, such as "Hop 2 distance" or a sentence quoting a body or part. Body names,
  part names and mod names are the game's own and are not translated.
* The **translations are machine-made and have not been reviewed** by native speakers. Expect awkward phrases and some KSP terms that
  differ from the game's own translations. Corrections are very welcome.
* The picker's choice does not change the **number format** or the calendar.

## Adding or correcting a language

All texts are in `js/i18n-data.js`, one row per English text: `[English, Spanish, German, French, Portuguese, Japanese]`. The English
text must be exactly the text used in the app; a test (`test/i18n.test.js`) fails if a row no longer matches the source, if a row
lacks a language, or if a symbol such as ×, % or … was lost in translation.

* **Correct a text:** edit the cell and open a pull request.
* **Add a language:** add `{ code, name }` to `languages`, add one string to every row (the test lists what is missing), and add the
  language to the list above.
* **Translate another label:** add a row with the exact English text. A text that is missing simply stays English.

Because texts are matched exactly, a label that is rewritten in English stops being translated until its row is updated; the test
catches that.

## How it works

`js/i18n.js` walks the page after it is built and whenever the app adds or changes something (a `MutationObserver`), and replaces each
text node, `aria-label`, `title` and `placeholder` that has a row. Code, preformatted text and text areas are skipped. Nothing is sent
anywhere; the catalogue is part of the page.
