import fs, { promises as fPromise } from "fs";
import path from "path";
import {
  Registry,
  IRawThemeSetting,
  IRawTheme,
  parseRawGrammar,
  IRawGrammar,
  INITIAL,
} from "vscode-textmate";
import he from "he";
import oniguruma from "oniguruma";
import util from "util";

const FontStyle = {
  NotSet: -1,
  None: 0,
  Italic: 1,
  Bold: 2,
  Underline: 4,
};

/**
 * Helpers to manage the "collapsed" metadata of an entire StackElement stack.
 * The following assumptions have been made:
 *  - languageId < 256 => needs 8 bits
 *  - unique color count < 512 => needs 9 bits
 *
 * The binary format is:
 * - -------------------------------------------
 *     3322 2222 2222 1111 1111 1100 0000 0000
 *     1098 7654 3210 9876 5432 1098 7654 3210
 * - -------------------------------------------
 *     xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx
 *     bbbb bbbb bfff ffff ffFF FTTT LLLL LLLL
 * - -------------------------------------------
 *  - L = LanguageId (8 bits)
 *  - T = StandardTokenType (3 bits)
 *  - F = FontStyle (3 bits)
 *  - f = foreground color (9 bits)
 *  - b = background color (9 bits)
 *
 * @internal
 */
const MetadataConsts = {
  LANGUAGEID_MASK: 0b00000000000000000000000011111111,
  TOKEN_TYPE_MASK: 0b00000000000000000000011100000000,
  FONT_STYLE_MASK: 0b00000000000000000011100000000000,
  FOREGROUND_MASK: 0b00000000011111111100000000000000,
  BACKGROUND_MASK: 0b11111111100000000000000000000000,

  LANGUAGEID_OFFSET: 0,
  TOKEN_TYPE_OFFSET: 8,
  FONT_STYLE_OFFSET: 11,
  FOREGROUND_OFFSET: 14,
  BACKGROUND_OFFSET: 23,
};

function getFontStyle(metadata: number): number {
  return (
    (metadata & MetadataConsts.FONT_STYLE_MASK) >>>
    MetadataConsts.FONT_STYLE_OFFSET
  );
}

function getForeground(metadata: number): number {
  return (
    (metadata & MetadataConsts.FOREGROUND_MASK) >>>
    MetadataConsts.FOREGROUND_OFFSET
  );
}

interface DecodedTokenMeta {
  classNames: string[];
  bold: boolean;
  italic: boolean;
  underline: boolean;
  foreground: number;
}

/**
 * @param {number} metadata
 * @returns {DecodedTokenMeta}
 */
function getTokenDataFromMetadata(metadata: number): DecodedTokenMeta {
  const classNames: string[] = [];
  const foreground = getForeground(metadata);
  const fontStyle = getFontStyle(metadata);
  const italic = !!(fontStyle & FontStyle.Italic);
  const bold = !!(fontStyle & FontStyle.Bold);
  const underline = !!(fontStyle & FontStyle.Underline);
  classNames.push("mtk" + foreground);

  if (italic) {
    classNames.push("mtki");
  }
  if (bold) {
    classNames.push("mtkb");
  }
  if (underline) {
    classNames.push("mtku");
  }

  return {
    classNames,
    bold,
    italic,
    underline,
    foreground,
  };
}

interface PublicTheme {
  name: string;
  colors: { [key: string]: string };
  tokenColors: IRawThemeSetting[];
}

function createClassNameMap(theme: PublicTheme): Map<string, string> {
  const colorMap = new Map<string, string>();
  let colorIndex = 0;
  const defaultTokenColors = {
    settings: {
      foreground: theme.colors["editor.foreground"] ?? "#000000",
    },
  };
  [defaultTokenColors, ...theme.tokenColors].forEach((token) => {
    if (token.settings.foreground) {
      const color = token.settings.foreground.toUpperCase();
      if (!colorMap.has(color)) {
        colorMap.set(color, `mtk${colorIndex++}`);
      }
    }
  });

  return colorMap;
}

function buildCSS(map: Map<string, string>): string {
  let css =
    ".mtkb { font-weight: bold; }\n.mtki { font-style: italic; }\n.mtku { text-decoration: underline; }\n";

  for (const [color, className] of map.entries()) {
    css += `.${className} { color: ${color}; }\n`;
  }

  return css;
}

function convertThemeToRawTheme(theme: PublicTheme): IRawTheme {
  const defaultTokenColors = {
    settings: {
      foreground: theme.colors["editor.foreground"] ?? "#000000",
    },
  };
  return {
    name: theme.name,
    settings: [defaultTokenColors, ...theme.tokenColors],
  };
}

async function loadTheme(path: string): Promise<PublicTheme> {
  const jsonString = await fPromise.readFile(path, { encoding: "utf8" });
  const theme = JSON.parse(jsonString) as PublicTheme;
  return theme;
}

function last<T>(arr: ArrayLike<T>): T {
  return arr[arr.length - 1];
}

function getMetaAtPosition(tokens: Uint32Array, position: number): number {
  for (let i = 0; i < tokens.length; i += 2) {
    const start = tokens[i];
    const end = tokens[i + 2];
    if (start <= position && position < end) {
      return tokens[i + 1];
    }
  }
  return last(tokens);
}

/**
 * Utility to read a file as a promise
 */
function readFile(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fs.readFile(path, (error, data) => (error ? reject(error) : resolve(data)));
  });
}

interface ParsedLine {
  start: number;
  end: number;
  classNames: string[];
}

function arraysAreEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

function mergeConsecutiveSegments(segments: ParsedLine[]): ParsedLine[] {
  const mergedSegments: ParsedLine[] = [];
  let previousSegment: ParsedLine | null = null;
  segments.forEach((segment) => {
    if (previousSegment === null) {
      mergedSegments.push(segment);
      previousSegment = segment;
    } else if (
      previousSegment.end === segment.start &&
      arraysAreEqual(previousSegment.classNames, segment.classNames)
    ) {
      previousSegment.end = segment.end;
    } else {
      mergedSegments.push(segment);
      previousSegment = segment;
    }
  });
  return mergedSegments;
}

function codeToHTML(line: string, segments: ParsedLine[]): string {
  let highlightedLine = "";
  mergeConsecutiveSegments(segments).forEach((segment) => {
    const text = line.slice(segment.start, segment.end);
    if (text.trim() !== "") {
      highlightedLine +=
        `<span class="${segment.classNames.join(" ")}">` +
        he.encode(text, { useNamedReferences: true }) +
        "</span>";
    } else {
      highlightedLine += text;
    }
  });
  return highlightedLine;
}

enum GrammarKey {
  JAVASCRIPT = "source.js",
  TYPESCRIPT = "source.ts",
  GO = "source.go",
  DART = "source.dart",
  HTML = "text.html.basic",
  CSS = "source.css",
  TEXT = "text.plain",
  HANDLEBARS = "text.html.handlebars",
  YAML = "source.yaml",
}

const grammarKeyToSyntax: { [key in GrammarKey]: string } = {
  [GrammarKey.JAVASCRIPT]: "JavaScript.tmLanguage.json",
  [GrammarKey.TYPESCRIPT]: "TypeScript.tmLanguage.json",
  [GrammarKey.GO]: "go.tmLanguage.json",
  [GrammarKey.DART]: "dart.tmLanguage.json",
  [GrammarKey.HTML]: "html.tmLanguage.json",
  [GrammarKey.CSS]: "css.tmLanguage.json",
  [GrammarKey.TEXT]: "text.tmLanguage.json",
  [GrammarKey.HANDLEBARS]: "Handlebars.tmLanguage.json",
  [GrammarKey.YAML]: "yaml.tmLanguage.json",
};

const extensionToGrammarKey: { [key: string]: GrammarKey } = {
  js: GrammarKey.JAVASCRIPT,
  ts: GrammarKey.TYPESCRIPT,
  go: GrammarKey.GO,
  dart: GrammarKey.DART,
  html: GrammarKey.HTML,
  css: GrammarKey.CSS,
  handlebars: GrammarKey.HANDLEBARS,
  yaml: GrammarKey.YAML,
};

export default class Highlighter {
  private pathToTheme: string;
  private registry: Registry;
  private classNameMap?: Map<string, string>;
  private colorMap?: string[];

  constructor(pathToTheme: string) {
    this.pathToTheme = pathToTheme;
    this.registry = new Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
        createOnigString: (str) => new oniguruma.OnigString(str),
      }),
      loadGrammar: async (scopeName) => {
        const syntaxPath = grammarKeyToSyntax[scopeName as GrammarKey];
        const grammar = await readFile(path.join(__dirname, syntaxPath));
        const rawGrammar = parseRawGrammar(grammar.toString(), ".json");

        return rawGrammar;
      },
    });
  }

  syntaxName(tag: string): GrammarKey {
    if (tag in extensionToGrammarKey) {
      return extensionToGrammarKey[tag];
    }

    if (tag !== "") {
      console.log(`Unsupported grammar <${tag}>. Falling back to plain text`);
    }

    return GrammarKey.TEXT;
  }

  async loadTheme() {
    const theme = await loadTheme(this.pathToTheme);
    this.classNameMap = createClassNameMap(theme);
    this.registry.setTheme(convertThemeToRawTheme(theme));
    this.colorMap = this.registry.getColorMap();
  }

  get cssMap() {
    return this.classNameMap;
  }

  async highlightText(text: string[], language: GrammarKey): Promise<string> {
    const grammar = await this.registry.loadGrammar(language);
    let ruleStack = INITIAL;

    let output: string[] = [];

    for (let i = 0; i < text.length; i++) {
      const line = text[i];
      const binary = grammar.tokenizeLine2(line, ruleStack);
      const full = grammar.tokenizeLine(line, ruleStack).tokens;

      const segments: ParsedLine[] = [];
      for (const token of full) {
        const metadata = getTokenDataFromMetadata(
          getMetaAtPosition(binary.tokens, token.startIndex)
        );
        const classNames: string[] = [
          this.classNameMap.get(this.colorMap[metadata.foreground]),
        ];
        if (metadata.bold) {
          classNames.push("mtkb");
        }
        if (metadata.italic) {
          classNames.push("mtki");
        }
        if (metadata.underline) {
          classNames.push("mtku");
        }
        segments.push({
          start: token.startIndex,
          end: token.endIndex,
          classNames,
        });
      }

      const html = codeToHTML(line, segments);
      output.push(html);
      ruleStack = binary.ruleStack;
    }

    return "<pre><code>" + output.join("\n") + "</code></pre>";
  }
}

// (async () => {
//   const html = [
//     `<h1 class="je">Hello</h1>`,
//     `<style>.name{color: #ffffff;}</style>`
//   ];

//   const js = [
//     `function sayName(name) {`,
//     "  console.log(`Hello, ${name}!`);",
//     `}`
//   ];

//   const ts = [
//     `function sayName(name: string): void {`,
//     "  console.log(`Hello, ${name}!`);",
//     `}`
//   ];

//   const highlighter = new Highlighter("./src/OneDark-Pro.json");
//   await highlighter.loadTheme();
//   const highlightedHtml = await highlighter.highlightText(
//     html,
//     "text.html.basic"
//   );
//   console.log(highlightedHtml);

//   const highlightedJs = await highlighter.highlightText(js, "source.js");
//   console.log(highlightedJs);

//   const highlightedTs = await highlighter.highlightText(ts, "source.ts");
//   console.log(highlightedTs);
// })();
