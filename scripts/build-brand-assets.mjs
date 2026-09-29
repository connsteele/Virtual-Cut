import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { root } from './shared.mjs';

const source = await readFile(path.join(root, 'src/assets/virtual-cut-logo.svg'), 'utf8');
const artwork = source
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<title[^>]*>.*?<\/title>/s, '')
  .replace(/[\t ]+$/gm, '');
const output = path.join(root, 'design/brand');
await mkdir(output, { recursive: true });
await mkdir(path.join(root, 'public'), { recursive: true });

const monochrome = source
  .replace('<svg ', '<svg color="#04635F" ')
  .replace(/#489F96|#71D7CD|#EDE6D8/g, 'currentColor');
// The charcoal tile keeps the ivory film visible on light Windows surfaces.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect x="4" y="4" width="248" height="248" rx="52" fill="#192322"/><svg x="22" y="27" width="212" height="199" viewBox="44 24 292 274">${artwork}</svg></svg>\n`;
await writeFile(path.join(output, 'virtual-cut-logo.svg'), source);
await writeFile(path.join(output, 'virtual-cut-logo-monochrome.svg'), monochrome);
await sharp(Buffer.from(source))
  .resize({ width: 2048 })
  .png()
  .toFile(path.join(output, 'virtual-cut-logo.png'));
await writeFile(path.join(output, 'virtual-cut-app-icon.svg'), icon);
await writeFile(path.join(root, 'public/icon.svg'), icon);
await sharp(Buffer.from(icon)).resize(256, 256).png().toFile(path.join(root, 'public/icon.png'));
await sharp(Buffer.from(icon))
  .resize(1024, 1024)
  .png()
  .toFile(path.join(output, 'virtual-cut-app-icon.png'));

// Windows ICO: one directory entry per PNG image, including common DPI sizes.
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const frames = [];
for (const size of sizes)
  frames.push(await sharp(Buffer.from(icon)).resize(size, size).png().toBuffer());
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
frames.forEach((frame, index) => {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index] === 256 ? 0 : sizes[index];
  directory[entry + 1] = directory[entry];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frame.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
const ico = Buffer.concat([directory, ...frames]);
await writeFile(path.join(root, 'public/icon.ico'), ico);
await writeFile(path.join(output, 'virtual-cut-app.ico'), ico);

const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="600" viewBox="0 0 1120 600"><rect width="1120" height="600" fill="#121918"/><text x="54" y="57" font-family="Segoe UI, Arial, sans-serif" font-size="14" letter-spacing="2.5" fill="#71D7CD">VIRTUAL CUT / FINAL LOGO</text><svg x="78" y="122" width="355" height="333" viewBox="44 24 292 274">${artwork.replaceAll('film-gap', 'preview-gap')}</svg><path d="M507 105V480" stroke="#34453E"/><svg x="568" y="110" width="224" height="224" viewBox="0 0 256 256">${icon
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replaceAll(
    'film-gap',
    'preview-icon-gap',
  )}</svg><text x="594" y="370" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="#A8BAB0">WINDOWS APP ICON</text><g font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="#C1CFC6"><rect x="848" y="144" width="26" height="26" rx="4" fill="#EDE6D8"/><text x="889" y="163">#EDE6D8</text><rect x="848" y="200" width="26" height="26" rx="4" fill="#71D7CD"/><text x="889" y="219">#71D7CD</text><rect x="848" y="256" width="26" height="26" rx="4" fill="#489F96"/><text x="889" y="275">#489F96</text></g><text x="56" y="541" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="#DDE6DF">Ivory film. Three holes above, two below. Teal scissor blades with a continuous overlap.</text></svg>`;
await writeFile(path.join(output, 'brand-preview.svg'), preview);
await sharp(Buffer.from(preview)).png().toFile(path.join(output, 'brand-preview.png'));

// Repository artwork uses the same approved mark, with an opaque background for both themes.
for (const social of [false, true]) {
  const height = social ? 640 : 320;
  const name = social ? 'github-social-preview' : 'github-banner';
  const markX = social ? 82 : 70,
    markY = social ? 166 : 60;
  const markWidth = social ? 264 : 192,
    markHeight = social ? 248 : 180;
  const textX = social ? 405 : 310,
    titleY = social ? 278 : 149;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="${height}" viewBox="0 0 1280 ${height}" role="img" aria-labelledby="heading description">
<title id="heading">Virtual Cut</title><desc id="description">A footage workspace for Windows. Cut, mark, review and organize.</desc>
<rect width="1280" height="${height}" fill="#121918"/>
<rect x="1" y="1" width="1278" height="${height - 2}" rx="16" fill="none" stroke="#303D3B" stroke-width="2"/>
<svg x="${markX}" y="${markY}" width="${markWidth}" height="${markHeight}" viewBox="44 24 292 274">${artwork.replaceAll('film-gap', `${name}-gap`)}</svg>
<g font-family="Segoe UI, Arial, sans-serif">
<text x="${textX}" y="${titleY}" font-size="${social ? 84 : 70}" font-weight="600" letter-spacing="-2" fill="#EDE6D8">Virtual Cut</text>
<text x="${textX + 3}" y="${titleY + 52}" font-size="${social ? 27 : 24}" fill="#A1B3AF">A footage workspace for Windows</text>
<text x="${textX + 3}" y="${titleY + 97}" font-size="${social ? 22 : 19}" fill="#71D7CD">Cut · Mark · Review · Organize</text>
${social ? '<text x="85" y="81" font-size="16" letter-spacing="3" fill="#A1B3AF">DESKTOP PREVIEW</text>' : ''}
</g>
<path d="M70 ${height - 28}H1210" stroke="#04635F" stroke-width="4"/>
</svg>\n`;
  await writeFile(path.join(output, `${name}.svg`), svg);
  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(output, `${name}.png`));
}
console.log('Brand assets rebuilt from src/assets/virtual-cut-logo.svg.');
