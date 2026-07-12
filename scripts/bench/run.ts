import fs from 'node:fs';
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import autocannon from 'autocannon';
import { confirmationPayload, releasePayload } from './payloads';

const HTTP_URL = process.env.BENCH_HTTP_URL ?? 'http://localhost:3100';
const GRPC_ADDR = process.env.BENCH_GRPC_ADDR ?? 'localhost:50061';
const API_KEY = process.env.API_KEY ?? 'test-api-key';
const DURATION = Number(process.env.BENCH_DURATION ?? 10);
const CONNECTIONS = Number(process.env.BENCH_CONNECTIONS ?? 20);

interface BenchResult {
  transport: 'http' | 'grpc';
  op: string;
  reqPerSec: number;
  latencyP50: number;
  latencyP90: number;
  latencyP99: number;
  latencyMax: number;
  errors: number;
  bytesPerSec: number | null;
}

function httpRun(op: string, urlPath: string, body: unknown): Promise<BenchResult> {
  return new Promise((resolve, reject) => {
    autocannon(
      {
        url: `${HTTP_URL}${urlPath}`,
        method: 'POST',
        connections: CONNECTIONS,
        duration: DURATION,
        headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify(body),
      },
      (err, res) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({
          transport: 'http',
          op,
          reqPerSec: res.requests.average,
          latencyP50: res.latency.p50,
          latencyP90: res.latency.p90,
          latencyP99: res.latency.p99,
          latencyMax: res.latency.max,
          errors: res.errors,
          bytesPerSec: res.throughput.average,
        });
      },
    );
  });
}

function makeGrpcClient(): {
  // biome-ignore lint/suspicious/noExplicitAny: gRPC client is dynamically typed from the loaded proto
  client: any;
  metadata: grpc.Metadata;
} {
  const def = protoLoader.loadSync(
    path.join(__dirname, '..', '..', 'proto', 'notification.proto'),
    {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    },
  );
  // biome-ignore lint/suspicious/noExplicitAny: loaded proto package is dynamically typed
  const proto = grpc.loadPackageDefinition(def) as any;
  const client = new proto.notification.NotificationService(
    GRPC_ADDR,
    grpc.credentials.createInsecure(),
  );
  const metadata = new grpc.Metadata();
  metadata.add('x-api-key', API_KEY);
  return { client, metadata };
}

async function grpcRun(op: string, method: string, payload: unknown): Promise<BenchResult> {
  const { client, metadata } = makeGrpcClient();
  const latencies: number[] = [];
  let errors = 0;
  const endAt = Date.now() + DURATION * 1000;

  const oneCall = (): Promise<void> =>
    new Promise((resolve) => {
      const start = process.hrtime.bigint();
      // biome-ignore lint/suspicious/noExplicitAny: dynamic gRPC method dispatch
      (client as any)[method](payload, metadata, (err: unknown) => {
        if (err) errors += 1;
        latencies.push(Number(process.hrtime.bigint() - start) / 1e6);
        resolve();
      });
    });

  const worker = async (): Promise<void> => {
    while (Date.now() < endAt) {
      await oneCall();
    }
  };
  await Promise.all(Array.from({ length: CONNECTIONS }, () => worker()));
  grpc.closeClient(client);

  latencies.sort((a, b) => a - b);
  const pct = (p: number): number =>
    latencies.length === 0
      ? 0
      : (latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0);

  return {
    transport: 'grpc',
    op,
    reqPerSec: latencies.length / DURATION,
    latencyP50: pct(50),
    latencyP90: pct(90),
    latencyP99: pct(99),
    latencyMax: latencies.length > 0 ? (latencies[latencies.length - 1] ?? 0) : 0,
    errors,
    bytesPerSec: null,
  };
}

async function main(): Promise<void> {
  console.log(`Benchmark: duration=${DURATION}s connections=${CONNECTIONS}`);
  const results: BenchResult[] = [];
  results.push(await httpRun('confirmation', '/notifications/confirmation', confirmationPayload));
  results.push(await httpRun('release', '/notifications/release', releasePayload));
  results.push(await grpcRun('confirmation', 'sendConfirmation', confirmationPayload));
  results.push(await grpcRun('release', 'sendReleaseNotification', releasePayload));

  const out = {
    generatedAt: new Date().toISOString(),
    config: {
      durationSec: DURATION,
      connections: CONNECTIONS,
      httpUrl: HTTP_URL,
      grpcAddr: GRPC_ADDR,
    },
    results,
  };
  const dir = path.join(__dirname, '..', '..', 'bench', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = out.generatedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
