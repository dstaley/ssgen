import Generator from "./index";

const command = process.argv[2];
const projectDir = process.argv[3];
const outputDir = process.argv[4];

const watchMode = command === "watch";

const generator = new Generator(projectDir, outputDir, watchMode);

if (watchMode) {
  generator.watch();
} else if (command === "build") {
  generator.run();
}
