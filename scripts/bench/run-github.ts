import fs from 'node:fs';
import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import autocannon from 'autocannon';
import { GitHubServiceClient } from '../../src/generated/proto/github';
import { verifyRepoOwner, verifyRepoName } from './payloads';

const HTTP_URL = process.env.BENCH_GITHUB_HTTP_URL ?? 'http://localhost:3200';
const GRPC_ADDR = process.env.BENCH_GITHUB_GRPC_ADDR ?? 'localhost:50062';
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
}

function httpRun(): Promise<BenchResult> {
  return new Promise((resolve, reject) => {
    autocannon(
      {
        url: `${HTTP_URL}/internal/repos/${verifyRepoOwner}/${verifyRepoName}`,
        method: 'GET',
        connections: CONNECTIONS,
        duration: DURATION,
        headers: { 'x-api-key': API_KEY },
      },
      (err, res) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({
          transport: 'http',
          op: 'verifyRepo',
          reqPerSec: res.requests.average,
          latencyP50: res.latency.p50,
          latencyP90: res.latency.p90,
          latencyP99: res.latency.p99,
          latencyMax: res.latency.max,
          errors: res.errors,
        });
      },
    );
  });
}

async function grpcRun(): Promise<BenchResult> {
  const metadata = new grpc.Metadata();
  metadata.add('x-api-key', API_KEY);
  const client = new GitHubServiceClient(GRPC_ADDR, grpc.credentials.createInsecure());

  const latencies: number[] = [];
  let errors = 0;
  const endAt = Date.now() + DURATION * 1000;

  const oneCall = (): Promise<void> =>
    new Promise((resolve) => {
      const start = process.hrtime.bigint();
      client.verifyRepo({ owner: verifyRepoOwner, name: verifyRepoName }, metadata, (err) => {
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
    op: 'verifyRepo',
    reqPerSec: latencies.length / DURATION,
    latencyP50: pct(50),
    latencyP90: pct(90),
    latencyP99: pct(99),
    latencyMax: latencies.length > 0 ? (latencies[latencies.length - 1] ?? 0) : 0,
    errors,
  };
}

async function main(): Promise<void> {
  console.log(`GitHub bench: duration=${DURATION}s connections=${CONNECTIONS}`);
  const results: BenchResult[] = [];
  results.push(await httpRun());
  results.push(await grpcRun());

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
  fs.writeFileSync(path.join(dir, `github-${stamp}.json`), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(dir, 'github-latest.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
