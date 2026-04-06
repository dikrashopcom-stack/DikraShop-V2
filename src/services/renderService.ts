import { createCanvas, loadImage, registerFont, CanvasRenderingContext2D } from "canvas";
import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";

// ── Asset paths ────────────────────────────────────────────────────────────────

const ASSETS_DIR   = path.resolve(__dirname, "../../assets");
const MOONS_DIR    = path.join(ASSETS_DIR, "moons");
const FONTS_DIR    = path.join(ASSETS_DIR, "fonts");
const TEMPLATE_DIR = path.join(ASSETS_DIR, "template");

// ── Canvas dimensions ─────────────────────────────────────────────────────────

const CANVAS_WIDTH  = 1414;
const CANVAS_HEIGHT = 2000;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RenderInput {
  moonPhase: string;           // asset key, e.g. "full_moon"
  recipientName: string;
  eventDate: Date;
  phraseIntro?: string | null; // optional intro line (smaller, lighter) above main phrase
  phrase?: string | null;      // main phrase line
  fontChoice?: string | null;  // partial name match against files in assets/fonts/
}

/**
 * A bounded rectangular zone for text rendering.
 * x / y are the top-left corner of the zone.
 * Text is centered horizontally within the zone and
 * the rendered text block is vertically centered within the zone.
 */
interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  maxFontSize: number;
  minFontSize: number;
  maxLines: number;
  lineHeight: number;   // line-height multiplier, e.g. 1.25
  color: string;
}

// ── Composition constants ─────────────────────────────────────────────────────

const ZONE_X = 147;   // left edge (= canvas center − 560)
const ZONE_W = 1120;  // usable text width

/**
 * Vertical grouping gaps between elements.
 * These tie the date to the moon base and the phrase to the date,
 * giving the composition an intentional grouped feel.
 */
const GROUP_SPACING = {
  moonToDate:   44,  // gap from moon bounding-box bottom to date zone top
  dateToPhrase: 50,  // gap from date zone bottom to phrase area top
  introToMain:  12,  // gap between intro line and main phrase block
};

// ── Layout zones ───────────────────────────────────────────────────────────────
//
// The moon is the fixed visual anchor; all lower zones are derived from it.
// Moon bottom → date zone → phrase area (intro + main phrase).
//
// Name zone is independent (upper strip above the moon).

const LAYOUT = {
  moon: {
    x: CANVAS_WIDTH / 2,
    y: 760,
    width:  1020,  // slightly larger than 980 to strengthen presence
    height: 1020,
  },

  // Name zone: upper strip, fully above the moon
  name: {
    x: ZONE_X,
    y: 55,
    width:       ZONE_W,
    height:      150,   // 150 lets maxFontSize 118 × lineHeight 1.25 = 147.5 fit cleanly
    maxFontSize: 118,
    minFontSize: 36,
    maxLines:    1,
    lineHeight:  1.25,
    color:       "#111111",
  } as TextBox,

  // Date zone: derived at build time from moon bottom + GROUP_SPACING.moonToDate
  // (see buildZones() below)
  dateTemplate: {
    width:       ZONE_W,
    height:      120,
    maxFontSize: 88,
    minFontSize: 32,
    maxLines:    1,
    lineHeight:  1.25,
    color:       "#111111",
  },

  // Intro phrase template (optional, rendered above the main phrase block)
  phraseIntroTemplate: {
    width:       ZONE_W,
    height:      70,
    maxFontSize: 44,
    minFontSize: 22,
    maxLines:    1,
    lineHeight:  1.2,
    color:       "#666666",
  },

  // Three main phrase presets — selected by character length at render time.
  // The y coordinate is injected dynamically in buildZones().
  phraseTemplates: [
    // ① short phrase  (≤ 40 chars): single line, large font
    {
      width:       ZONE_W,
      height:      120,
      maxFontSize: 66,
      minFontSize: 36,
      maxLines:    1,
      lineHeight:  1.25,
      color:       "#111111",
    },
    // ② medium phrase (≤ 90 chars): up to two lines, medium font
    {
      width:       ZONE_W,
      height:      160,
      maxFontSize: 56,
      minFontSize: 30,
      maxLines:    2,
      lineHeight:  1.3,
      color:       "#111111",
    },
    // ③ long phrase   (> 90 chars): up to three lines, smaller font
    {
      width:       ZONE_W,
      height:      220,
      maxFontSize: 46,
      minFontSize: 24,
      maxLines:    3,
      lineHeight:  1.35,
      color:       "#111111",
    },
  ],
};

// ── Zone builder ───────────────────────────────────────────────────────────────

interface ComposedZones {
  name:         TextBox;
  date:         TextBox;
  phraseIntro:  TextBox;   // y is live; only used when phraseIntro is present
  phraseMain:   (phrase: string) => TextBox;  // returns the right preset at the right y
}

/**
 * Derives all live TextBox coordinates from the moon anchor + GROUP_SPACING.
 * Called once per render so all zones are geometrically consistent.
 *
 * @param hasIntro  true when a phraseIntro string is present
 */
function buildZones(hasIntro: boolean): ComposedZones {
  const moonBottom   = LAYOUT.moon.y + LAYOUT.moon.height / 2;
  const dateY        = moonBottom + GROUP_SPACING.moonToDate;
  const phraseAreaY  = dateY + LAYOUT.dateTemplate.height + GROUP_SPACING.dateToPhrase;

  const date: TextBox = {
    x: ZONE_X,
    y: dateY,
    ...LAYOUT.dateTemplate,
  };

  // Intro zone sits at the top of the phrase area
  const phraseIntro: TextBox = {
    x: ZONE_X,
    y: phraseAreaY,
    ...LAYOUT.phraseIntroTemplate,
  };

  // Main phrase zone starts either at phraseAreaY (no intro) or below the intro block
  const mainPhraseY = hasIntro
    ? phraseAreaY + LAYOUT.phraseIntroTemplate.height + GROUP_SPACING.introToMain
    : phraseAreaY;

  const phraseMain = (phrase: string): TextBox => {
    const len = phrase.length;
    const template =
      len <= 40 ? LAYOUT.phraseTemplates[0] :
      len <= 90 ? LAYOUT.phraseTemplates[1] :
                  LAYOUT.phraseTemplates[2];
    return { x: ZONE_X, y: mainPhraseY, ...template };
  };

  return { name: LAYOUT.name, date, phraseIntro, phraseMain };
}

// ── Font loading ───────────────────────────────────────────────────────────────

/**
 * Registers available fonts from assets/fonts/ and returns the family name to use.
 * Falls back to "sans-serif" if no fonts are found.
 */
function loadFonts(fontChoice: string | null | undefined): string {
  if (!fs.existsSync(FONTS_DIR)) {
    logger.warn("No fonts directory found, using system sans-serif", { fontsDir: FONTS_DIR });
    return "sans-serif";
  }

  const fontFiles = fs
    .readdirSync(FONTS_DIR)
    .filter((f) => f.endsWith(".ttf") || f.endsWith(".otf"));

  if (fontFiles.length === 0) {
    logger.warn("No font files in assets/fonts/, using system sans-serif");
    return "sans-serif";
  }

  let defaultFamily = "sans-serif";
  let chosenFamily: string | null = null;

  for (const file of fontFiles) {
    const fontPath = path.join(FONTS_DIR, file);
    const family = path.basename(file, path.extname(file));
    try {
      registerFont(fontPath, { family });
      if (defaultFamily === "sans-serif") defaultFamily = family;
      logger.debug("Font registered", { family, file });
    } catch (err) {
      logger.warn("Could not register font", { file, err });
    }
  }

  if (fontChoice) {
    const match = fontFiles.find((f) =>
      f.toLowerCase().includes(fontChoice.toLowerCase())
    );
    if (match) {
      chosenFamily = path.basename(match, path.extname(match));
      logger.info("Using requested font", { fontChoice, matched: chosenFamily });
    } else {
      logger.warn("Requested font not found in assets/fonts/, using default", { fontChoice });
    }
  }

  return chosenFamily ?? defaultFamily;
}

// ── Drawing helpers ────────────────────────────────────────────────────────────

/**
 * Draws an image scaled to fit inside a box (object-fit: contain),
 * centered on (centerX, centerY).
 */
function drawImageContain(
  ctx: CanvasRenderingContext2D,
  img: { width: number; height: number },
  centerX: number,
  centerY: number,
  boxWidth: number,
  boxHeight: number
): void {
  const scale      = Math.min(boxWidth / img.width, boxHeight / img.height);
  const drawWidth  = img.width  * scale;
  const drawHeight = img.height * scale;
  ctx.drawImage(
    img as Parameters<typeof ctx.drawImage>[0],
    centerX - drawWidth  / 2,
    centerY - drawHeight / 2,
    drawWidth,
    drawHeight
  );
}

/**
 * Greedy word-wrap: splits text into lines that each fit within maxWidth
 * at the currently set font on ctx.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Draws text inside a bounded TextBox with dynamic sizing and line wrapping.
 *
 * Algorithm:
 *  1. Start at maxFontSize; greedily wrap text into lines.
 *  2. If it fits within maxLines AND the block height fits within box.height → done.
 *  3. Otherwise reduce font size by 2px and retry, down to minFontSize.
 *  4. At minFontSize, hard-truncate to maxLines if still over.
 *  5. Vertically center the final text block within the zone.
 */
function drawTextInBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: TextBox,
  fontFamily: string
): void {
  const cx = box.x + box.width / 2;

  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle    = box.color;

  let size  = box.maxFontSize;
  let lines: string[] = [];

  while (size >= box.minFontSize) {
    ctx.font = `${size}px "${fontFamily}"`;
    const wrapped = wrapText(ctx, text, box.width);

    if (wrapped.length <= box.maxLines) {
      const blockHeight = wrapped.length * size * box.lineHeight;
      if (blockHeight <= box.height) {
        lines = wrapped;
        break;
      }
    }
    size -= 2;
  }

  // Edge case: nothing fit cleanly — force minFontSize with hard truncation
  if (lines.length === 0) {
    size = box.minFontSize;
    ctx.font = `${size}px "${fontFamily}"`;
    lines = wrapText(ctx, text, box.width).slice(0, box.maxLines);
  }

  // Vertically center the block within the zone
  const blockHeight = lines.length * size * box.lineHeight;
  const startY = box.y + (box.height - blockHeight) / 2 + (size * box.lineHeight) / 2;

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], cx, startY + i * size * box.lineHeight, box.width);
  }
}

/**
 * Formats a date for display (French-Algerian locale).
 */
function formatEventDate(date: Date): string {
  return date.toLocaleDateString("fr-DZ", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// ── Main render function ───────────────────────────────────────────────────────

export async function renderMoonDesign(input: RenderInput, outputPath: string): Promise<void> {
  logger.info("Starting image render", {
    moonPhase:   input.moonPhase,
    recipient:   input.recipientName,
    hasIntro:    !!input.phraseIntro,
    hasPhrase:   !!input.phrase,
    outputPath,
  });

  // Validate required assets before doing any work
  const templatePath = path.join(TEMPLATE_DIR, "background.png");
  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `Template background not found: ${templatePath}\n` +
      `→ Add your background image at assets/template/background.png`
    );
  }

  const moonPath = path.join(MOONS_DIR, `${input.moonPhase}.png`);
  if (!fs.existsSync(moonPath)) {
    throw new Error(
      `Moon asset not found: ${moonPath}\n` +
      `→ Add your moon image at assets/moons/${input.moonPhase}.png`
    );
  }

  const fontFamily = loadFonts(input.fontChoice);

  // Derive all zone coordinates from the moon anchor
  const zones = buildZones(!!input.phraseIntro);

  logger.debug("Composed zones", {
    dateY:       zones.date.y,
    phraseAreaY: zones.phraseIntro.y,
  });

  // Build canvas
  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext("2d");

  // 1. Draw background template
  const bgImage = await loadImage(templatePath);
  ctx.drawImage(bgImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // 2. Draw moon image (scaled to fit the box, centered)
  const moonImage = await loadImage(moonPath);
  drawImageContain(ctx, moonImage, LAYOUT.moon.x, LAYOUT.moon.y, LAYOUT.moon.width, LAYOUT.moon.height);

  // 3. Draw recipient name
  drawTextInBox(ctx, input.recipientName, zones.name, fontFamily);

  // 4. Draw formatted event date
  drawTextInBox(ctx, formatEventDate(input.eventDate), zones.date, fontFamily);

  // 5. Draw optional phrase intro (smaller, lighter — sits above the main phrase)
  if (input.phraseIntro) {
    drawTextInBox(ctx, input.phraseIntro, zones.phraseIntro, fontFamily);
  }

  // 6. Draw optional main phrase (zone selected by character length)
  if (input.phrase) {
    const mainZone = zones.phraseMain(input.phrase);
    logger.debug("Main phrase zone", { chars: input.phrase.length, y: mainZone.y, maxFontSize: mainZone.maxFontSize });
    drawTextInBox(ctx, input.phrase, mainZone, fontFamily);
  }

  // Export high-quality PNG
  const buffer = canvas.toBuffer("image/png");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);

  logger.info("Image render complete", { outputPath, sizeBytes: buffer.length });
}
