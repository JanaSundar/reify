// Generates every favicon and app icon from the official brand marks in public/brand.
// Run with `pnpm icons` after changing a brand SVG; the outputs are committed.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const BRAND = "public/brand";
const BG = "#fbfaf8"; // --bg (light)

const markLight = await readFile(`${BRAND}/reify-mark-light.svg`);
const markDark = await readFile(`${BRAND}/reify-mark-dark.svg`);

/** The mark rendered to fit a `size`×`size` box (it is wider than tall), transparent. */
const renderMark = (svg, size) =>
  sharp(svg, { density: 1200 })
    .resize({
      width: size,
      height: size,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

/** A square icon: optional background (with corner radius) and the mark inset by `pad`. */
const tile = async (size, { svg = markLight, background = BG, pad = 0.12, radius = 0 } = {}) => {
  const inner = Math.round(size * (1 - pad * 2));
  const mark = await renderMark(svg, inner);
  const offset = Math.round((size - inner) / 2);
  const layers = [{ input: mark, top: offset, left: offset }];
  let base = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
  if (background && radius > 0) {
    const r = Math.round(size * radius);
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`,
    );
    base = sharp(
      await base
        .composite([{ input: mask, blend: "dest-in" }])
        .png()
        .toBuffer(),
    );
  }
  return base.composite(layers).png().toBuffer();
};

/** Packs PNG images into a .ico container (PNG-compressed entries, supported everywhere). */
const toIco = (images) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
};

/** An SVG document's contents without its outer <svg> element. */
const svgBody = (svg) =>
  svg
    .toString()
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");

/**
 * SVG favicon that follows the OS colour scheme: the light mark on light, the dark mark
 * on dark. Both originals are embedded as-is (their element ids don't collide).
 */
const themedSvg = () => {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -31.5 326 326">
<style>.dark{display:none}@media (prefers-color-scheme:dark){.light{display:none}.dark{display:inline}}</style>
<g class="light">${svgBody(markLight)}</g>
<g class="dark">${svgBody(markDark)}</g>
</svg>
`;
};

await mkdir("public/icons", { recursive: true });

const ico = toIco(
  await Promise.all(
    [16, 32, 48].map(async (size) => ({
      size,
      data: await tile(size, { pad: 0.06, radius: 0.22 }),
    })),
  ),
);

await Promise.all([
  writeFile("src/app/favicon.ico", ico),
  writeFile("src/app/icon.svg", themedSvg()),
  // iOS rounds the corners itself and ignores transparency.
  tile(180, { pad: 0.16 }).then((png) => writeFile("src/app/apple-icon.png", png)),
  tile(192, { pad: 0.14, radius: 0.22 }).then((png) => writeFile("public/icons/icon-192.png", png)),
  tile(512, { pad: 0.14, radius: 0.22 }).then((png) => writeFile("public/icons/icon-512.png", png)),
  // Maskable: full-bleed background, mark inside the 80% safe zone.
  tile(512, { pad: 0.24 }).then((png) => writeFile("public/icons/icon-maskable-512.png", png)),
  tile(512, { svg: markDark, background: "#0a0a0d", pad: 0.24 }).then((png) =>
    writeFile("public/icons/icon-maskable-dark-512.png", png),
  ),
  // Raster full logo for the Open Graph image (its renderer handles PNG best).
  sharp(await readFile(`${BRAND}/reify-logo-dark.svg`), { density: 600 })
    .resize({ width: 640 })
    .png()
    .toBuffer()
    .then((png) => writeFile(`${BRAND}/reify-logo-dark.png`, png)),
]);

console.log(
  "Icons written: src/app/{favicon.ico,icon.svg,apple-icon.png}, public/icons/*, public/brand/reify-logo-dark.png",
);
