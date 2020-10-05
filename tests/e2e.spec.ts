import klaw from "klaw";
import tmp from "tmp";
import { promises as fs } from "fs";
import Generator, { hashFile } from "../src";
import { npath, ppath, PortablePath, NativePath } from "../src/path";

function removeDirectory(dir: PortablePath) {
  return function(p: PortablePath): PortablePath {
    if (p.startsWith(dir)) return p.slice(dir.length, p.length) as PortablePath;
    return p;
  };
}

async function getFileListing(dir: NativePath): Promise<PortablePath[]> {
  const filePaths: PortablePath[] = [];
  for await (const file of klaw(dir)) {
    filePaths.push(npath.toPortablePath(file.path));
  }
  return filePaths;
}

async function contentsOrHash(p: NativePath): Promise<string> {
  if (npath.extname(p) in ["png", "jpg", "jpeg"]) {
    return hashFile(p);
  }

  const fileContents = await fs.readFile(p, { encoding: "utf8" });
  return fileContents;
}

test("e2e input matches output", async () => {
  const tmpDir = tmp.dirSync({ unsafeCleanup: true });
  const expectedOutputDir = npath.fromPortablePath(
    ppath.join(
      npath.toPortablePath(__dirname),
      "fixtures/e2e/output" as PortablePath
    )
  );
  const g = new Generator(
    npath.fromPortablePath(
      ppath.join(
        npath.toPortablePath(__dirname),
        "fixtures/e2e/input" as PortablePath
      )
    ),
    tmpDir.name
  );
  await g.run();

  const [generatedFilePaths, expectedFilePaths] = await Promise.all([
    getFileListing(tmpDir.name),
    getFileListing(expectedOutputDir)
  ]);

  const generatedFiles = generatedFilePaths
    .map(removeDirectory(npath.toPortablePath(tmpDir.name)))
    .filter(s => s !== "");

  const expectedFiles = expectedFilePaths
    .map(removeDirectory(npath.toPortablePath(expectedOutputDir)))
    .filter(s => s !== "");

  expect(generatedFiles.sort()).toEqual(expectedFiles.sort());

  const fileHashes = (
    await Promise.all(
      [...generatedFilePaths, ...expectedFilePaths].map(async pp => {
        const filePath = npath.fromPortablePath(pp);
        const stat = await fs.lstat(filePath);
        if (stat.isDirectory()) {
          return [pp, ""];
        }
        const hash = await contentsOrHash(filePath);
        return [pp, hash];
      })
    )
  ).reduce<{ [key: string]: string }>((acc, [filename, hash]) => {
    acc[filename] = hash;
    return acc;
  }, {});

  for (const generatedFilePath of generatedFiles) {
    const generatedPath = ppath.join(
      npath.toPortablePath(tmpDir.name),
      generatedFilePath
    );
    const expectedPath = ppath.join(
      npath.toPortablePath(expectedOutputDir),
      generatedFilePath
    );
    expect({
      path: generatedFilePath,
      hash: fileHashes[generatedPath]
    }).toEqual({ path: generatedFilePath, hash: fileHashes[expectedPath] });
  }

  tmpDir.removeCallback();
});
