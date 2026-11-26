import {describe, expect, it} from "vitest";
import type {FromWorker, ToWorker} from "../src/protocol";
import {type ClientStage, PythonClient, PythonUnavailableError, StoppedError, type WorkerLike} from "../src/worker-client";

/** Stands in for the Python worker: records what the page sends and replies when a test says so. */
class FakeWorker implements WorkerLike {
  posted: ToWorker[] = [];
  terminated = false;
  #onMessage: ((event: MessageEvent<FromWorker>) => void)[] = [];
  #onOther: Record<string, (() => void)[]> = {error: [], messageerror: []};

  postMessage(message: ToWorker): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: "message", listener: (event: MessageEvent<FromWorker>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
  addEventListener(type: string, listener: ((event: MessageEvent<FromWorker>) => void) | (() => void)): void {
    if (type === "message") this.#onMessage.push(listener);
    else this.#onOther[type].push(listener as () => void);
  }

  send(data: FromWorker): void {
    for (const listener of this.#onMessage) listener({data} as MessageEvent<FromWorker>);
  }

  crash(type: "error" | "messageerror" = "error"): void {
    for (const listener of this.#onOther[type]) listener();
  }

  /** The id of the last request, to answer it. */
  lastId(): number {
    const last = this.posted.at(-1);
    if (!last || !("id" in last)) throw new Error("No request was sent");
    return last.id;
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const stages: ClientStage[] = [];
  const failures: string[] = [];
  const client = new PythonClient({
    create: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    indexURL: "https://example.test/pyodide/",
    onStage: (stage) => stages.push(stage),
    onFailure: (message) => failures.push(message),
  });
  client.start();
  return {client, workers, stages, failures, worker: () => workers.at(-1) as FakeWorker};
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("PythonClient", () => {
  it("answers requests by id", async () => {
    const {client, worker} = setup();
    expect(worker().posted[0]).toEqual({type: "init", indexURL: "https://example.test/pyodide/"});
    const running = client.run("df");
    worker().send({type: "result", id: worker().lastId(), json: '{"kind":"text","text":"1","stdout":""}', seconds: 0.2});
    await expect(running).resolves.toEqual({result: {kind: "text", text: "1", stdout: ""}, seconds: 0.2});
  });

  it("fails waiting and later requests at once when Python could not start", async () => {
    const {client, worker, stages, failures} = setup();
    const waiting = client.run("df");
    worker().send({type: "fatal", message: "network error"});
    await expect(waiting).rejects.toBeInstanceOf(PythonUnavailableError);
    expect(stages.at(-1)).toBe("failed");
    expect(failures).toEqual(["Python could not start (network error)."]);
    // Before, this request went to the dead worker and never settled.
    await expect(client.run("df")).rejects.toBeInstanceOf(PythonUnavailableError);
    await expect(client.exportCsv()).rejects.toBeInstanceOf(PythonUnavailableError);
  });

  it("fails waiting and later requests when the worker crashes", async () => {
    const {client, worker, failures} = setup();
    const waiting = client.run("df");
    worker().crash();
    await expect(waiting).rejects.toBeInstanceOf(PythonUnavailableError);
    expect(failures).toEqual(["Python stopped unexpectedly."]);
    await expect(client.load(bytes("a\n1\n"), "a.csv")).rejects.toBeInstanceOf(PythonUnavailableError);
  });

  it("remembers a file only once it opened, so Stop reopens the file on screen", async () => {
    const {client, workers, worker} = setup();
    const good = client.load(bytes("a\n1\n"), "good.csv");
    worker().send({type: "result", id: worker().lastId(), json: "{}", seconds: 0});
    await good;
    const bad = client.load(bytes("\u0000"), "bad.csv");
    worker().send({type: "failed", id: worker().lastId(), message: "The file is not text."});
    await expect(bad).rejects.toThrow("The file is not text.");
    expect(client.file?.name).toBe("good.csv");

    const running = client.run("while True: pass");
    const restarted = client.restart();
    await expect(running).rejects.toBeInstanceOf(StoppedError);
    expect(workers[0].terminated).toBe(true);
    const reload = worker().posted.at(-1);
    expect(reload).toMatchObject({type: "load", name: "good.csv"});
    worker().send({type: "result", id: worker().lastId(), json: "{}", seconds: 0});
    await expect(restarted).resolves.toBe(true);
  });

  it("reports a failure once, even when the worker also crashes after a fatal start", () => {
    const {worker, failures} = setup();
    worker().send({type: "fatal", message: "network error"});
    worker().crash();
    expect(failures).toEqual(["Python could not start (network error)."]);
  });

  it("fails when a reply from the worker cannot be read", async () => {
    const {client, worker, failures} = setup();
    const waiting = client.run("df");
    worker().crash("messageerror");
    await expect(waiting).rejects.toBeInstanceOf(PythonUnavailableError);
    expect(failures).toHaveLength(1);
  });

  it("quietly gives up a reopen that a second Stop replaced", async () => {
    const {client, worker} = setup();
    const opened = client.load(bytes("a\n1\n"), "good.csv");
    worker().send({type: "result", id: worker().lastId(), json: "{}", seconds: 0});
    await opened;
    const first = client.restart();
    const second = client.restart();
    await expect(first).resolves.toBe(false);
    worker().send({type: "result", id: worker().lastId(), json: "{}", seconds: 0});
    await expect(second).resolves.toBe(true);
  });

  it("does not let a late reply from an ended worker settle a new request", async () => {
    const {client, workers, worker} = setup();
    await client.restart();
    let settled = false;
    const running = client.run("df").finally(() => (settled = true));
    workers[0].send({type: "result", id: worker().lastId(), json: '{"kind":"none","stdout":""}', seconds: 0});
    await Promise.resolve();
    expect(settled).toBe(false);
    worker().send({type: "result", id: worker().lastId(), json: '{"kind":"none","stdout":""}', seconds: 0});
    await expect(running).resolves.toMatchObject({result: {kind: "none"}});
  });

  it("starts again after a failure when Stop restarts it", async () => {
    const {client, worker} = setup();
    worker().send({type: "fatal", message: "network error"});
    expect(client.stage).toBe("failed");
    await client.restart();
    expect(client.stage).toBe("runtime");
    const running = client.run("1");
    worker().send({type: "result", id: worker().lastId(), json: '{"kind":"text","text":"1","stdout":""}', seconds: 0});
    await expect(running).resolves.toMatchObject({result: {kind: "text"}});
  });

  it("ignores messages from a worker it already ended", async () => {
    const {client, workers, worker} = setup();
    await client.restart();
    workers[0].send({type: "fatal", message: "late"});
    workers[0].crash();
    expect(client.stage).toBe("runtime");
    expect(worker()).not.toBe(workers[0]);
  });
});
