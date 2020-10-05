import path from "upath";
import { Environment, FileSystemLoader } from "nunjucks";
import fm from "front-matter";
import { promises as fs } from "fs";
import { copy } from "fs-extra";
import { Parser, HtmlRenderer, Node, NodeWalkingStep } from "commonmark";
import sass, { renderSync } from "sass";
import { createHash } from "crypto";
import glob from "glob";
import rimraf from "rimraf";
import {
  parse,
  DefaultTreeDocument,
  DefaultTreeParentNode,
  DefaultTreeElement,
  serialize,
} from "parse5";
import srcset from "srcset";
import { format } from "date-fns";
import chokidar from "chokidar";
import http from "http";
import serveHandler from "serve-handler";
import Highlighter from "./highlighter";
import { ppath, npath, PortablePath, Filename, NativePath } from "./path";
import { format as prettier } from "./prettier";

type ProjectDirectory = PortablePath;
type OutputDirectory = PortablePath;

function debounce(
  func: (...args: any[]) => any,
  wait: number,
  immediate?: boolean
) {
  let timeout: ReturnType<typeof setTimeout>;
  return function () {
    const context = this,
      args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(function () {
      timeout = null;
      if (!immediate) func.apply(context, args);
    }, wait);
    if (immediate && !timeout) func.apply(context, args);
  };
}

export function hexToRGB(s: string): [number, number, number] {
  return [
    parseInt(`0x${s[1]}${s[2]}`, 16),
    parseInt(`0x${s[3]}${s[4]}`, 16),
    parseInt(`0x${s[5]}${s[6]}`, 16),
  ];
}

export async function hashFile(input: NativePath): Promise<string> {
  const shasum = createHash("sha1");
  const fileBuffer = await fs.readFile(input);
  shasum.update(fileBuffer);
  return shasum.digest("hex");
}

async function getPostPaths(
  inputDir: ProjectDirectory
): Promise<PortablePath[]> {
  return new Promise((resolve, reject) => {
    glob(
      path.join("**", "*.md"),
      { cwd: npath.fromPortablePath(inputDir) },
      (err, matches) => {
        if (err) reject(err);
        resolve(matches.map((m) => npath.toPortablePath(m)));
      }
    );
  });
}

function asyncRender(
  name: PortablePath,
  env: Environment,
  context?: object
): Promise<string> {
  return new Promise((resolve, reject) => {
    env.render(name, context, (err, res) => {
      if (err) reject(err);
      resolve(res);
    });
  });
}

function cleanDirectory(dir: PortablePath): Promise<void> {
  return new Promise((resolve, reject) => {
    rimraf(dir, (err) => {
      if (err) reject(err);
      resolve();
    });
  });
}

async function copyStaticDir(
  inputDir: ProjectDirectory,
  outputDir: OutputDirectory
): Promise<void> {
  const staticDirPath = npath.fromPortablePath(
    ppath.join(inputDir, "static" as Filename)
  );
  try {
    await fs.access(staticDirPath);
  } catch (err) {
    console.log("static directory does not exist");
    console.log(staticDirPath);
    return;
  }

  await copy(
    staticDirPath,
    npath.fromPortablePath(ppath.join(outputDir, "static" as Filename))
  );
}

export interface Post {
  html: string;
  layout: string;
  frontmatter: object;
  permalink: string;
}

export function sortPostsByDate(a: Post, b: Post): number {
  return (
    (b.frontmatter as { date: Date }).date.getTime() -
    (a.frontmatter as { date: Date }).date.getTime()
  );
}

export function calculateOutputPath(filePath: PortablePath): PortablePath {
  const newPath =
    "/" +
    ppath.join(
      ...(ppath
        .normalize(filePath)
        .split(ppath.sep)
        .filter((segment) => segment[0] !== "_") as Filename[])
    );
  return newPath as PortablePath;
}

export function calculatePermalink(filePath: PortablePath): string {
  const newPath = calculateOutputPath(filePath).replace(/index\.md$/, "");
  return newPath;
}

function isValidExt(
  ext: string,
  ignoreExts: string[] = [],
  maxSize: number
): boolean {
  let needle: string;
  if (ignoreExts == null) {
    ignoreExts = [];
  }
  return (
    ext &&
    ext.length <= maxSize &&
    ((needle = ext),
    !Array.from(
      ignoreExts.map((e) => (e && e[0] !== "." ? "." : "") + e)
    ).includes(needle))
  );
}

function trimExt(
  filename: PortablePath,
  ignoreExts: string[],
  maxSize: number = 7
): string {
  const oldExt = ppath.extname(filename);
  if (isValidExt(oldExt, ignoreExts, maxSize)) {
    return filename.slice(
      0,
      +(filename.length - oldExt.length - 1) + 1 || undefined
    );
  } else {
    return filename;
  }
}

export function changeExt(
  filename: PortablePath,
  ext: string,
  ignoreExts: string[] = [],
  maxSize: number = 7
): PortablePath {
  return (trimExt(filename, ignoreExts, maxSize) +
    (!ext ? "" : ext[0] === "." ? ext : "." + ext)) as PortablePath;
}

export default class Generator {
  public projectDir: ProjectDirectory;
  public outputDir: OutputDirectory;
  public env: Environment;
  public markdownParser: Parser;
  public htmlRenderer: HtmlRenderer;
  public highlighter: Highlighter;
  public renderedPosts: Map<PortablePath, Post> = new Map<PortablePath, Post>();

  constructor(
    projectDir: NativePath,
    outputDir: NativePath,
    watchMode: boolean = false
  ) {
    this.projectDir = npath.toPortablePath(projectDir);
    this.outputDir = npath.toPortablePath(outputDir);
    this.env = new Environment(
      new FileSystemLoader(npath.fromPortablePath(this.projectDir), {
        noCache: watchMode,
      }),
      {
        noCache: watchMode,
      }
    );
    this.markdownParser = new Parser();
    this.htmlRenderer = new HtmlRenderer();
    this.highlighter = new Highlighter(
      path.join(__dirname, "highlighter", "OneDark-Pro.json")
    );

    this.env.addFilter(
      "asset",
      async (assetPath: string, cb: (err: Error, res: string) => void) => {
        const input = await fs.readFile(
          npath.join(
            npath.fromPortablePath(this.projectDir),
            assetPath as Filename
          ),
          {
            encoding: "utf8",
          }
        );
        cb(undefined, input);
      },
      true
    );

    this.env.addFilter(
      "fingerprint",
      async (assetPath: string, cb: (err: Error, res: string) => void) => {
        const hash = await hashFile(
          npath.join(npath.fromPortablePath(this.projectDir), assetPath)
        );
        cb(undefined, hash);
      },
      true
    );

    this.env.addFilter("dateFormat", (date: Date, formatStr: string) => {
      const dateInLocalTimezone = new Date(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds()
      );
      return format(dateInLocalTimezone, formatStr);
    });
  }

  async loadHighlighterTheme(): Promise<void> {
    await this.highlighter.loadTheme();
  }

  async renderMarkdownFile(markdownFilePath: PortablePath): Promise<void> {
    const input = await fs.readFile(
      npath.join(
        npath.fromPortablePath(this.projectDir),
        npath.fromPortablePath(markdownFilePath)
      ),
      {
        encoding: "utf8",
      }
    );

    const frontmatter = fm<{ layout?: string }>(input);

    const parsedMarkdown = this.markdownParser.parse(frontmatter.body);

    const walker = parsedMarkdown.walker();
    let event: NodeWalkingStep;
    let node: Node;

    while ((event = walker.next())) {
      node = event.node;
      if (node.type === "code_block") {
        const highlightedText = await this.highlighter.highlightText(
          node.literal.trim().split("\n"),
          this.highlighter.syntaxName(node.info)
        );
        const n = new Node("html_block");
        n.literal = highlightedText;
        node.insertBefore(n);
        node.unlink();
      }
    }

    const renderedMarkdown = this.htmlRenderer.render(parsedMarkdown);

    this.renderedPosts.set(markdownFilePath, {
      html: renderedMarkdown,
      layout: frontmatter.attributes.layout,
      frontmatter: frontmatter.attributes,
      permalink: calculatePermalink(markdownFilePath),
    });
  }

  async rewriteFilePath(filePath: PortablePath): Promise<PortablePath> {
    const relativePath = ppath.join(this.projectDir, filePath);
    const fileHash = await hashFile(npath.fromPortablePath(relativePath));

    const newFilePath = changeExt(
      filePath,
      `.${fileHash}${path.extname(filePath)}`
    );
    await copy(
      npath.fromPortablePath(relativePath),
      npath.fromPortablePath(ppath.join(this.outputDir, newFilePath)),
      {
        recursive: true,
      }
    );
    return newFilePath;
  }

  async renderFile(inputFile: PortablePath): Promise<void> {
    const { html, layout, frontmatter } = this.renderedPosts.get(inputFile);

    const { highlighter } = this;

    const posts = Object.values(this.renderedPosts)
      .filter((p) => p.layout === "post")
      .sort(sortPostsByDate);

    const layoutFile = ppath.join(
      "layouts" as PortablePath,
      `${layout ?? "base"}.njk` as Filename
    );
    const renderedPost = await asyncRender(layoutFile, this.env, {
      ...frontmatter,
      content: html,
      posts,
      sass: (p: PortablePath) =>
        renderSync({
          file: npath.fromPortablePath(ppath.join(this.projectDir, p)),
          functions: {
            "syntaxThemeMap()": function () {
              const colorMap = Array.from(highlighter.cssMap);
              const themeMap = new sass.types.Map<
                sass.types.String,
                sass.types.Color
              >(colorMap.length);

              for (let i = 0; i < colorMap.length; i++) {
                themeMap.setKey(i, new sass.types.String(colorMap[i][1]));
                const [r, g, b] = hexToRGB(colorMap[i][0]);
                themeMap.setValue(i, new sass.types.Color(r, g, b));
              }

              return themeMap;
            },
          },
        }).css,
    });

    this.renderedPosts.set(inputFile, {
      ...this.renderedPosts.get(inputFile),
      html: renderedPost,
    });
  }

  async copyAssets(inputFile: PortablePath): Promise<void> {
    const { html } = this.renderedPosts.get(inputFile);
    const doc = parse(html) as DefaultTreeDocument;
    const generator = this;
    async function walk(node: DefaultTreeParentNode) {
      for (let childNode of node.childNodes) {
        if ((childNode as DefaultTreeParentNode).childNodes) {
          await walk(childNode as DefaultTreeParentNode);
        }
        if (
          (childNode as DefaultTreeElement).tagName === "img" ||
          (childNode as DefaultTreeElement).tagName === "source"
        ) {
          const srcIndex = (childNode as DefaultTreeElement).attrs.findIndex(
            (a) => a.name === "src"
          );
          if (srcIndex > -1) {
            const src = (childNode as DefaultTreeElement).attrs[srcIndex].value;
            const newFilePath = await generator.rewriteFilePath(
              src as PortablePath
            );
            (childNode as DefaultTreeElement).attrs[
              srcIndex
            ].value = newFilePath;
          }
          const srcSetIndex = (childNode as DefaultTreeElement).attrs.findIndex(
            (a) => a.name === "srcset"
          );
          if (srcSetIndex > -1) {
            const srcSet = (childNode as DefaultTreeElement).attrs[srcSetIndex]
              .value;
            const parsedSrcSet = srcset.parse(srcSet);
            for (let i = 0; i < parsedSrcSet.length; i++) {
              const newFilePath = await generator.rewriteFilePath(
                parsedSrcSet[i].url as PortablePath
              );
              parsedSrcSet[i].url = newFilePath;
            }
            (childNode as DefaultTreeElement).attrs[
              srcSetIndex
            ].value = srcset.stringify(parsedSrcSet);
          }
        }
      }
    }
    await walk(doc);
    this.renderedPosts.set(inputFile, {
      ...this.renderedPosts.get(inputFile),
      html: serialize(doc),
    });
  }

  async formatHtml(inputFile: PortablePath) {
    const { html } = this.renderedPosts.get(inputFile);
    const prettyHtml = await prettier(html, { parser: "html" });
    this.renderedPosts.set(inputFile, {
      ...this.renderedPosts.get(inputFile),
      html: prettyHtml,
    });
  }

  async writeFile(inputFile: PortablePath): Promise<void> {
    const { html } = this.renderedPosts.get(inputFile);

    let outputFile = ppath
      .join(this.outputDir, calculateOutputPath(inputFile))
      .replace(/\.md$/, ".html") as PortablePath;

    await fs.mkdir(npath.fromPortablePath(ppath.dirname(outputFile)), {
      recursive: true,
    });
    await fs.writeFile(npath.fromPortablePath(outputFile), html, {
      encoding: "utf8",
    });
  }

  async run(): Promise<void> {
    try {
      console.time("Building site");
      await this.loadHighlighterTheme();
      const postPaths = await getPostPaths(this.projectDir);

      await cleanDirectory(this.outputDir);
      await copyStaticDir(this.projectDir, this.outputDir);
      await Promise.all(postPaths.map((post) => this.renderMarkdownFile(post)));
      await Promise.all(postPaths.map((post) => this.renderFile(post)));
      await Promise.all(postPaths.map((post) => this.copyAssets(post)));
      await Promise.all(postPaths.map((post) => this.formatHtml(post)));
      await Promise.all(postPaths.map((post) => this.writeFile(post)));
      console.timeEnd("Building site");
    } catch (err) {
      console.error("Error building site");
      console.error(err);
    }
  }

  watch() {
    console.log(`Watching ${this.projectDir} for changes...`);
    const run = debounce(this.run.bind(this), 500);
    chokidar.watch(npath.fromPortablePath(this.projectDir)).on("all", () => {
      run();
    });

    const server = http.createServer((request, response) => {
      return serveHandler(request, response, {
        public: npath.fromPortablePath(this.outputDir),
        cleanUrls: true,
      });
    });

    server.listen(3000, () => {
      console.log(`Listening at http://localhost:3000`);
    });
  }
}
