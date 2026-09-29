# Virtual Cut final logo

Connor selected Film Edge round 3 D (ivory film), then reduced its perforations to **three on top and two on the bottom**. The five retained holes follow the positions in his annotated reference. Blade proportions, the overlapping tip, transparent gaps, and the palette remain those of D.

## Files

- `design/brand/virtual-cut-logo.svg`: editable transparent vector mark.
- `design/brand/virtual-cut-logo.png`: transparent PNG, 2048 pixels wide.
- `design/brand/virtual-cut-logo-monochrome.svg`: one-color vector for alternate uses.
- `design/brand/virtual-cut-app-icon.svg` and `.png`: square app icon on a charcoal tile; PNG is 1024 × 1024.
- `design/brand/virtual-cut-app.ico`: Windows icon containing 16, 20, 24, 32, 40, 48, 64, 128, and 256 pixel images.
- `design/brand/brand-preview.svg` and `.png`: delivery preview.

## Palette

| Element | Color |
| --- | --- |
| Front blade | `#71D7CD` |
| Rear blade | `#489F96` |
| Film | `#EDE6D8` |
| App-icon tile | `#192322` |

The application keeps `#04635F` as its main interface accent. The charcoal app-icon tile gives the ivory film a stable background in Explorer, the taskbar, and other Windows surfaces.

## Maintenance

Edit only `src/assets/virtual-cut-logo.svg` for changes to the mark, then run `npm run brand:build`. The React `Brand` component imports that exact source. Production builds regenerate the exports automatically, and Windows packaging embeds the matching ICO in the new executable.

The mark itself contains vector paths and a vector mask; no raster images, fonts, or external references. Its gaps and perforations are transparent. Small raster sizes retain the same five-hole design.
