/**
 * Surge color palette + CSS-variable bridge.
 *
 * We define two palettes (dark + light) and emit them as CSS custom
 * properties on `:root[data-surge-mode]`. Components reference colors
 * via `var(--surge-*)` strings instead of inline literals; one mode
 * switch flips the whole UI.
 *
 * The brand teal (#07938f) stays the same in both modes — it's a
 * brand asset and reads well on both backgrounds.
 *
 * Adding a new color:
 *   1. Add it to BOTH palettes below (with a sensible value for each)
 *   2. The CSS-variable name is auto-derived from the key:
 *      `panelBg` → `--surge-panel-bg`
 *   3. Reference as `'var(--surge-panel-bg)'` in component sx/style.
 *
 * Components that haven't been migrated yet (still using literals)
 * will look right in dark mode and slightly off in light mode. That's
 * fine — migration is incremental and the most visible chrome is done
 * first. Search the codebase for `'#181818'`, `'#1a1a1a'`, etc. to
 * find unmigrated literals.
 */

export const palettes = {
  dark: {
    // Surfaces
    appBg:           'rgba(17,17,17,0.92)',  // main container
    panelBg:         '#181818',               // primary panel / step body
    cardBg:          '#1a1a1a',               // inner cards
    cardBgInner:     '#252525',               // nested cards
    surfaceMuted:    '#0a2a2a',               // teal-tinted accent panel
    surfaceWarning:  '#0a1a2a',               // info/help panel
    inputBg:         '#222',
    overlayBg:       'rgba(40,40,40,0.6)',    // grayed-out tile overlay

    // Borders
    border:          '#444',
    borderMuted:     '#333',
    borderSubtle:    '#2a2a2a',

    // Text
    textPrimary:     '#fff',
    textSecondary:   '#cfd8dc',
    textMuted:       '#aaa',
    textDim:         '#888',

    // Brand
    brand:           '#07938f',
    brandHover:      '#0bbab5',
    brandDark:       '#065a57',
    accent:          '#79eaff',
    warning:         '#ffb300',
    error:           '#f44336',
    success:         '#4caf50',
  },

  light: {
    // Surfaces
    appBg:           'rgba(255,255,255,0.96)',
    panelBg:         '#f5f5f5',
    cardBg:          '#ffffff',
    cardBgInner:     '#fafafa',
    surfaceMuted:    '#e0f2f1',
    surfaceWarning:  '#e3f2fd',
    inputBg:         '#ffffff',
    overlayBg:       'rgba(255,255,255,0.6)',

    // Borders
    border:          '#cccccc',
    borderMuted:     '#dddddd',
    borderSubtle:    '#e0e0e0',

    // Text
    textPrimary:     '#1a1a1a',
    textSecondary:   '#37474f',
    textMuted:       '#555555',
    textDim:         '#777777',

    // Brand
    brand:           '#07938f',
    brandHover:      '#0bbab5',
    brandDark:       '#065a57',
    accent:          '#0277bd',
    warning:         '#e65100',
    error:           '#c62828',
    success:         '#2e7d32',
  },
};

/** Convert camelCase key → kebab-case CSS var, prefixed with --surge-. */
export function cssVarName(key) {
  return '--surge-' + key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

/** Returns a CSS string applying the given palette as :root vars. */
export function paletteToCssVars(palette) {
  const lines = Object.entries(palette).map(
    ([key, value]) => `  ${cssVarName(key)}: ${value};`
  );
  return lines.join('\n');
}

/**
 * Shorthand helpers so consumers can write `c('panelBg')` instead of
 * `'var(--surge-panel-bg)'` everywhere.
 */
export function c(key) {
  return `var(${cssVarName(key)})`;
}

/** Common compound shorthands — saves typing in components. */
export const tc = {
  // text colors
  primary:   c('textPrimary'),
  secondary: c('textSecondary'),
  muted:     c('textMuted'),
  dim:       c('textDim'),
  brand:     c('brand'),
  accent:    c('accent'),
  warning:   c('warning'),
  error:     c('error'),
  success:   c('success'),

  // surfaces
  panel:     c('panelBg'),
  card:      c('cardBg'),
  cardInner: c('cardBgInner'),
  input:     c('inputBg'),

  // borders
  border:        c('border'),
  borderMuted:   c('borderMuted'),
  borderSubtle:  c('borderSubtle'),
};
