import {
  hexToRGB,
  changeExt,
  Post,
  sortPostsByDate,
  calculateOutputPath,
  calculatePermalink
} from "../src";
import { PortablePath } from "../src/path";

test("hexToRGB", () => {
  expect(hexToRGB("#ffffff")).toEqual([255, 255, 255]);
  expect(hexToRGB("#000000")).toEqual([0, 0, 0]);
  expect(hexToRGB("#bababa")).toEqual([186, 186, 186]);
});

test("sortPostsByDate", () => {
  const now = Date.now();
  const posts: Post[] = [
    {
      html: "",
      layout: "",
      frontmatter: { date: new Date(now) },
      permalink: ""
    },
    {
      html: "",
      layout: "",
      frontmatter: { date: new Date(now + 1) },
      permalink: ""
    },
    {
      html: "",
      layout: "",
      frontmatter: { date: new Date(now + 2) },
      permalink: ""
    }
  ];
  expect([...posts].sort(sortPostsByDate)).toEqual(posts.reverse());
});

test("calculateOutputPath", () => {
  expect(calculateOutputPath("/_posts/one/index.md" as PortablePath)).toEqual(
    "/one/index.md"
  );
  expect(calculateOutputPath("/posts/one/index.md" as PortablePath)).toEqual(
    "/posts/one/index.md"
  );
});

test("calculatePermalink", () => {
  expect(calculatePermalink("/_posts/one/index.md" as PortablePath)).toEqual(
    "/one/"
  );
  expect(calculatePermalink("/posts/one/index.md" as PortablePath)).toEqual(
    "/posts/one/"
  );
});

test("changeExt", () => {
  expect(changeExt("index.md" as PortablePath, "html")).toBe("index.html");
});
