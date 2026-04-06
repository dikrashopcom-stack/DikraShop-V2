# Moon Assets

Place 8 PNG moon phase images here. File names must match exactly:

| File name               | Phase            |
|-------------------------|------------------|
| `new_moon.png`          | New Moon         |
| `waxing_crescent.png`   | Waxing Crescent  |
| `first_quarter.png`     | First Quarter    |
| `waxing_gibbous.png`    | Waxing Gibbous   |
| `full_moon.png`         | Full Moon        |
| `waning_gibbous.png`    | Waning Gibbous   |
| `last_quarter.png`      | Last Quarter     |
| `waning_crescent.png`   | Waning Crescent  |

## Requirements

- Format: PNG with transparency (RGBA)
- Recommended size: matches your `LAYOUT.moon.size` in `renderService.ts` (default 300×300 px),
  or larger — the renderer will scale them down automatically.
- Background: transparent so the template image shows through
