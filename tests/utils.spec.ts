import {
  hexToRGB,
  changeExt,
  Post,
  sortPostsByDate,
  calculateOutputPath,
  calculatePermalink,
} from "../src";
import { PortablePath } from "../src/path";

const { suite, test } = intern.getPlugin("interface.tdd");
const { expect } = intern.getPlugin("chai");

suite("utils", () => {
  test("hexToRGB", () => {
    expect(hexToRGB("#ffffff")).to.deep.equal([255, 255, 255]);
    expect(hexToRGB("#000000")).to.deep.equal([0, 0, 0]);
    expect(hexToRGB("#bababa")).to.deep.equal([186, 186, 186]);
  });

  test("sortPostsByDate", () => {
    const now = Date.now();
    const posts: Post[] = [
      {
        html: "",
        layout: "",
        frontmatter: { date: new Date(now) },
        permalink: "",
      },
      {
        html: "",
        layout: "",
        frontmatter: { date: new Date(now + 1) },
        permalink: "",
      },
      {
        html: "",
        layout: "",
        frontmatter: { date: new Date(now + 2) },
        permalink: "",
      },
    ];
    expect([...posts].sort(sortPostsByDate)).to.deep.equal(posts.reverse());
  });

  test("calculateOutputPath", () => {
    expect(
      calculateOutputPath("/_posts/one/index.md" as PortablePath)
    ).to.equal("/one/index.md");
    expect(calculateOutputPath("/posts/one/index.md" as PortablePath)).to.equal(
      "/posts/one/index.md"
    );
  });

  test("calculatePermalink", () => {
    expect(calculatePermalink("/_posts/one/index.md" as PortablePath)).to.equal(
      "/one/"
    );
    expect(calculatePermalink("/posts/one/index.md" as PortablePath)).to.equal(
      "/posts/one/"
    );
  });

  test("changeExt", () => {
    expect(changeExt("index.md" as PortablePath, "html")).to.equal(
      "index.html"
    );
  });
});
