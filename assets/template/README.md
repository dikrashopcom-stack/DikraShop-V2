# Template Assets

Place your background template image here:

| File name        | Purpose                                      |
|------------------|----------------------------------------------|
| `background.png` | Base canvas — the full design background     |

## Requirements

- Format: PNG
- Size: must match `CANVAS_WIDTH × CANVAS_HEIGHT` in `renderService.ts`
  (default: **1200 × 1200 px**)
- All moon images, text, etc. are composited on top of this

## Layout reference

After placing your background, open `src/services/renderService.ts` and update
the `LAYOUT` object to match where each element should appear on your design:

```ts
const LAYOUT = {
  moon:   { x: 600, y: 400, size: 300 },   // center point + diameter
  name:   { x: 600, y: 750, fontSize: 60 },
  date:   { x: 600, y: 830, fontSize: 40 },
  phrase: { x: 600, y: 910, fontSize: 36 },
};
```

Use an image editor (Figma, Photoshop, etc.) to measure the pixel coordinates
you want for each element.
