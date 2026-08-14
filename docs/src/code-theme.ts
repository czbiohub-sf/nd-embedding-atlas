import type { ThemeRegistrationRaw } from "shiki";

/**
 * Biohub syntax themes for Shiki.
 *
 * Structure follows Pierre (github.com/pierrecomputer/pierre, packages/theme,
 * Apache-2.0): scopes are grouped into a small set of named semantic roles, and
 * both schemes are generated from one role map so they cannot drift apart.
 * Pierre's `createTheme` is a build-time internal rather than public API, so the
 * role model is ported here and filled with brand colors instead of imported.
 *
 * Colors come from the 2025-11-04 Biohub Brand Book, extended into ramps in
 * ../zensical-biohub-theme. Brand periwinkle carries the language constructs
 * (keywords, tags, decorators, escapes, regexes); the remaining roles borrow one
 * stop each from four non-brand ramps, chosen for separation rather than
 * decoration. Neutrals are true-neutral, so greys carry no hue cast.
 *
 * Every role clears 4.5:1 against its own code surface — worst case 4.64:1
 * light, 5.16:1 dark — and the chromatic roles stay separable (min CIEDE2000
 * 19.9 light, 10.3 dark; keyword and special are deliberately the same hue
 * family). Verify with scripts/check-docs-code-theme.py after changing a stop.
 */
interface Roles {
  /** page/editor surface the tokens sit on */
  surface: string;
  /** plain identifiers and default text */
  name: string;
  /** keywords, storage, tags — carried by brand periwinkle */
  keyword: string;
  /** escapes and regexes — the deeper/brighter brand stop */
  special: string;
  /** functions, methods, types, classes */
  function: string;
  string: string;
  /** numeric and boolean literals */
  number: string;
  /** other constants, attributes, shell options */
  constant: string;
  /** variables, parameters, object keys */
  variable: string;
  /** punctuation and operators — present but recessive */
  quiet: string;
  comment: string;
}

const light: Roles = {
  surface: "#f5f5f5",
  name: "#404040",
  keyword: "#6e4ff9",
  special: "#33029c",
  function: "#bd2e90",
  string: "#1e6746",
  number: "#22657c",
  constant: "#604218",
  variable: "#ad4529",
  quiet: "#525252",
  comment: "#636363",
};

const dark: Roles = {
  surface: "#171717",
  name: "#d4d4d4",
  keyword: "#b195ff",
  special: "#9272fd",
  function: "#ea68bc",
  string: "#60d199",
  number: "#68cdf2",
  constant: "#ffbc56",
  variable: "#ff855e",
  quiet: "#a3a3a3",
  comment: "#8a8a8a",
};

function createBiohubCodeTheme(
  name: string,
  type: "light" | "dark",
  c: Roles,
): ThemeRegistrationRaw {
  return {
    name,
    type,
    bg: c.surface,
    fg: c.name,
    settings: [
      { settings: { background: c.surface, foreground: c.name } },

      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: c.comment },
      },

      {
        scope: [
          "string",
          "constant.other.symbol",
          "punctuation.definition.string.begin",
          "punctuation.definition.string.end",
          "string.quoted",
          "markup.inline.raw",
        ],
        settings: { foreground: c.string },
      },

      {
        scope: [
          "constant.numeric",
          "constant.language.boolean",
          "constant.language",
          "keyword.other.unit",
        ],
        settings: { foreground: c.number },
      },

      /* Shell options such as `--channel` read as constants, which keeps flags
         distinct from the command that owns them. */
      {
        scope: [
          "constant",
          "punctuation.definition.constant",
          "support.constant",
          "entity.other.attribute-name",
          "constant.other.option",
        ],
        settings: { foreground: c.constant },
      },

      /* Structural names — YAML/JSON keys and markup tags — stay on brand
         periwinkle along with keywords, per the brand's technical weighting. */
      {
        scope: [
          "keyword",
          "keyword.control",
          "storage",
          "storage.type",
          "storage.modifier",
          "keyword.operator.new",
          "keyword.operator.expression",
          "entity.name.tag",
          "support.type.property-name.json",
          "entity.name.tag.yaml",
          "meta.decorator",
          "punctuation.decorator",
        ],
        settings: { foreground: c.keyword },
      },

      {
        scope: ["constant.character.escape", "string.regexp", "constant.regexp"],
        settings: { foreground: c.special },
      },

      {
        scope: [
          "entity.name.function",
          "support.function",
          "meta.function-call",
          "variable.function",
          "entity.name.type",
          "entity.name.class",
          "support.class",
          "support.type",
          "entity.other.inherited-class",
        ],
        settings: { foreground: c.function },
      },

      {
        scope: [
          "variable",
          "variable.other",
          "variable.parameter",
          "meta.object-literal.key",
          "support.variable",
        ],
        settings: { foreground: c.variable },
      },

      {
        scope: [
          "punctuation",
          "keyword.operator",
          "meta.brace",
          "punctuation.separator",
          "punctuation.terminator",
          "punctuation.accessor",
        ],
        settings: { foreground: c.quiet },
      },

      {
        scope: ["markup.heading", "entity.name.section"],
        settings: { foreground: c.keyword, fontStyle: "bold" },
      },
      { scope: "markup.bold", settings: { fontStyle: "bold" } },
      { scope: "markup.italic", settings: { fontStyle: "italic" } },
      {
        scope: ["markup.inserted", "markup.inserted.diff"],
        settings: { foreground: c.string },
      },
      {
        scope: ["markup.deleted", "markup.deleted.diff"],
        settings: { foreground: c.variable },
      },

      {
        scope: ["invalid", "invalid.illegal", "invalid.deprecated"],
        settings: { foreground: c.variable },
      },
    ],
  };
}

export const biohubCodeLight = createBiohubCodeTheme(
  "biohub-light",
  "light",
  light,
);
export const biohubCodeDark = createBiohubCodeTheme("biohub-dark", "dark", dark);

/** Shared by the MDX docs pipeline and the Sätteri blog compiler. */
export const biohubCodeThemes = {
  light: biohubCodeLight,
  dark: biohubCodeDark,
};
