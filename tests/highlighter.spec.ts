import Highlighter from "../src/highlighter";

const { suite, test, before } = intern.getPlugin("interface.tdd");
const { expect } = intern.getPlugin("chai");

const h = new Highlighter("./src/highlighter/OneDark-Pro.json");

suite("highlighter", () => {
  before(async () => {
    await h.loadTheme();
  });

  test("using extension works", () => {
    expect(h.syntaxName("js")).to.equal("source.js");
  });

  test("highlighting js works", async () => {
    const line =
      'const layoutFile = path.join("layouts", `${layout ?? "base"}.njk`);';
    const expected =
      '<pre><code><span class="mtk10">const</span> <span class="mtk4">layoutFile</span> <span class="mtk9">=</span> <span class="mtk3">path</span><span class="mtk0">.</span><span class="mtk7">join</span><span class="mtk0">(</span><span class="mtk8">&quot;layouts&quot;</span><span class="mtk0">, </span><span class="mtk8">&grave;</span><span class="mtk10">${</span><span class="mtk3">layout</span> <span class="mtk10">??</span> <span class="mtk8">&quot;base&quot;</span><span class="mtk0">}</span><span class="mtk8">.</span><span class="mtk7">njk</span><span class="mtk8">&grave;);</span></code></pre>';
    const t = await h.highlightText([line], h.syntaxName("js"));
    expect(t).to.equal(expected);
  });

  test("class names are calculated", () => {
    const classNames = Array.from(h.cssMap);
    const expected = [
      ["#ABB2BF", "mtk0"],
      ["#5C6370", "mtk1"],
      ["#7F848E", "mtk2"],
      ["#E06C75", "mtk3"],
      ["#E5C07B", "mtk4"],
      ["#FFFFFF", "mtk5"],
      ["#D19A66", "mtk6"],
      ["#61AFEF", "mtk7"],
      ["#98C379", "mtk8"],
      ["#56B6C2", "mtk9"],
      ["#C678DD", "mtk10"],
      ["#F44747", "mtk11"],
    ];
    expect(classNames).to.deep.equal(expected);
  });
});
