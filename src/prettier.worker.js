//@ts-check
const { parentPort, workerData } = require("worker_threads");
const prettier = require("prettier");

const result = prettier.format(workerData.input, workerData.options);
parentPort.postMessage(result);
