# Font Assets

Place `.ttf` or `.otf` font files here.

- The **first** font found (alphabetically) is used as the default.
- To let customers choose a font per order, add a Notion **select** property called `الخط`
  and name each option to partially match the font filename.
  Example: option `"Amiri"` will match `Amiri-Regular.ttf`.
- If no font files are present, the renderer falls back to the system `sans-serif`.

## Recommended fonts for Arabic text

Arabic text in the `الإسم في اللوحة` / `العبارة في اللوحة` fields renders correctly
only if you use an Arabic-capable font, such as:

- [Amiri](https://fonts.google.com/specimen/Amiri) — classic, serif
- [Cairo](https://fonts.google.com/specimen/Cairo) — modern, clean
- [Tajawal](https://fonts.google.com/specimen/Tajawal) — minimal

Download from Google Fonts and drop the `.ttf` here.
