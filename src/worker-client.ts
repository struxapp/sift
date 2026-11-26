// The page's side of the Python worker: numbered requests, start-up stages, Stop, and what happens when Python is gone.
import type {FromWorker, Overview, RunResult, Stage, ToWorker} from "./protocol";

export type ClientStage = Stage | "failed";

/** The part of a Worker the client uses, so tests can hand it a fake. */
export interface WorkerLike {
  postMessage(message: ToWorker, transfer: Transferable[]): void;
  terminate(): void;
  addEventListener(type: "message", listener: (event: MessageEvent<FromWorker>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
}

/** A request ended because the person pressed Stop. */
export class StoppedError extends Error {}

/** Python could not start or stopped for good; only a reload helps. */
export class PythonUnavailableError extends Error {}

interface Options {
  create: () => WorkerLike;
  indexURL: string;
  onStage: (stage: ClientStage) => void;
  onFailure: (message: string) => void;
}

type Reply = {json: string; seconds: number};
type Pending = {resolve: (reply: Reply) => void; reject: (error: Error) => void};
type Request = ToWorker extends infer M ? (M extends {id: number} ? Omit<M, "id"> : never) : never;

export class PythonClient {
  stage: ClientStage = "runtime";
  /** The last file that opened, so Stop can open it again. Set only once it has opened. */
  file: {bytes: Uint8Array; name: string} | null = null;

  readonly #options: Options;
  readonly #pending = new Map<number, Pending>();
  #worker: WorkerLike | null = null;
  #nextId = 1;

  constructor(options: Options) {
    this.#options = options;
  }

  start(): void {
    const worker = this.#options.create();
    this.#worker = worker;
    worker.addEventListener("message", (event) => {
      if (worker === this.#worker) this.#receive(event.data);
    });
    worker.addEventListener("error", () => {
      if (worker === this.#worker) this.#fail("Python stopped unexpectedly.");
    });
    // A reply that cannot be read leaves its request waiting for ever, so treat it like a crash.
    worker.addEventListener("messageerror", () => {
      if (worker === this.#worker) this.#fail("Python sent a reply the page could not read.");
    });
    this.#setStage("runtime");
    worker.postMessage({type: "init", indexURL: this.#options.indexURL}, []);
  }

  async load(bytes: Uint8Array, name: string): Promise<Overview> {
    const {json} = await this.#request({type: "load", bytes: bytes.slice(), name});
    this.file = {bytes, name};
    return JSON.parse(json) as Overview;
  }

  async run(code: string): Promise<{result: RunResult; seconds: number}> {
    const {json, seconds} = await this.#request({type: "run", code});
    return {result: JSON.parse(json) as RunResult, seconds};
  }

  async exportCsv(): Promise<string> {
    const {json} = await this.#request({type: "export"});
    return (JSON.parse(json) as {csv: string}).csv;
  }

  /**
   * Ends the worker (the only way to interrupt Python without SharedArrayBuffer), starts a new one and opens the last
   * file again. Resolves to whether a file was opened again; false too when another Stop took over meanwhile.
   */
  async restart(): Promise<boolean> {
    this.#worker?.terminate();
    this.#rejectAll(new StoppedError("Stopped"));
    this.start();
    if (!this.file) return false;
    try {
      await this.#request({type: "load", bytes: this.file.bytes.slice(), name: this.file.name});
    } catch (error) {
      if (error instanceof StoppedError) return false;
      throw error;
    }
    return true;
  }

  #receive(message: FromWorker): void {
    if (message.type === "stage") return this.#setStage(message.stage);
    if (message.type === "fatal") return this.#fail(`Python could not start (${message.message}).`);
    const waiting = this.#pending.get(message.id);
    if (!waiting) return;
    this.#pending.delete(message.id);
    if (message.type === "result") waiting.resolve({json: message.json, seconds: message.seconds});
    else waiting.reject(new Error(message.message));
  }

  #request(message: Request): Promise<Reply> {
    if (this.stage === "failed" || !this.#worker) {
      return Promise.reject(new PythonUnavailableError("Python is not running."));
    }
    const id = this.#nextId++;
    const worker = this.#worker;
    return new Promise<Reply>((resolve, reject) => {
      this.#pending.set(id, {resolve, reject});
      worker.postMessage({...message, id} as ToWorker, []);
    });
  }

  #fail(message: string): void {
    if (this.stage === "failed") return; // a fatal start is often followed by an error event: report it once
    this.#setStage("failed");
    this.#rejectAll(new PythonUnavailableError(message));
    this.#options.onFailure(message);
  }

  #rejectAll(error: Error): void {
    for (const waiting of this.#pending.values()) waiting.reject(error);
    this.#pending.clear();
  }

  #setStage(stage: ClientStage): void {
    this.stage = stage;
    this.#options.onStage(stage);
  }
}
