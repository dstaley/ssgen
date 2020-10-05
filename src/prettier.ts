import { Worker } from "worker_threads";
import { Options } from "prettier";
import { npath, ppath, Filename } from "./path";

export function format(input: string, options: Options): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      npath.fromPortablePath(
        ppath.join(
          npath.toPortablePath(__dirname),
          "prettier.worker.js" as Filename
        )
      ),
      {
        workerData: {
          input,
          options,
        },
      }
    );

    worker.on("error", (err) => reject(err));
    worker.on("message", (result) => resolve(result));
  });
}
