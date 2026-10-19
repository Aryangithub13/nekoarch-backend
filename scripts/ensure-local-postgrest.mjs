// Local infrastructure repair for the reproduced PostgREST 16.2 JWT clock defect.
// Replace only the stateless REST container; preserve the DB, JWT settings and network IP.
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { Buffer } from 'node:buffer';
import { URL, pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import process from 'node:process';
import console from 'node:console';

const name = 'supabase_rest_designflow';
// SUPA-003: the CLI pulls PostgREST from ECR by default, or from another registry (SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io gives
// postgrest/postgrest). Only 16.2 has the defect: it is replaced by 16.3 from the same repository; 16.3 or later is kept as it is.
const REPOSITORIES = ['public.ecr.aws/supabase/postgrest', 'postgrest/postgrest', 'docker.io/postgrest/postgrest', 'ghcr.io/supabase/postgrest'];
export function restImagePlan(image) {
  const match = /^(.+):v(\d+)\.(\d+)(?:\.\d+)?$/.exec(image ?? '');
  if (!match || !REPOSITORIES.includes(match[1])) return { action: 'refuse' };
  const [major, minor] = [Number(match[2]), Number(match[3])];
  if (major > 16 || (major === 16 && minor >= 3)) return { action: 'keep' };
  return major === 16 && minor === 2 ? { action: 'replace', target: `${match[1]}:v16.3` } : { action: 'refuse' };
}
function docker(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`Docker ${args[0]} failed; potentially sensitive output withheld`);
  return r.stdout.trim();
}
function api(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request({ socketPath: '/var/run/docker.sock', path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => res.statusCode < 300 ? resolve(JSON.parse(text || '{}')) : reject(new Error(`Docker API HTTP ${res.statusCode}; body withheld`)));
    });
    req.on('error', () => reject(new Error('Local Docker socket unavailable')));
    req.end(data);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) try {
  // Refuse remote Docker contexts and remote Supabase endpoints.
  if (process.env.DOCKER_HOST && process.env.DOCKER_HOST !== 'unix:///var/run/docker.sock') throw new Error('Remote Docker refused');
  const context = JSON.parse(docker(['context', 'inspect']))[0];
  if (context.Endpoints.docker.Host !== 'unix:///var/run/docker.sock') throw new Error('Non-local Docker context refused');
  const status = spawnSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' });
  if (status.status !== 0) throw new Error('Start the repository local stack first');
  const local = JSON.parse(status.stdout);
  for (const key of ['API_URL', 'DB_URL']) if (!['127.0.0.1', 'localhost'].includes(new URL(local[key]).hostname)) throw new Error('Remote Supabase refused');
  const old = JSON.parse(docker(['inspect', name]))[0];
  const plan = restImagePlan(old.Config.Image);
  if (plan.action === 'refuse') throw new Error('Unexpected REST image; manual review required');
  if (plan.action === 'keep') {
    console.log(`Local PostgREST already uses ${old.Config.Image}`);
  } else {
    const target = plan.target;
    const networks = Object.entries(old.NetworkSettings.Networks);
    if (old.Mounts.length || networks.length !== 1 || !old.State.Running || old.State.Paused) throw new Error('Unexpected REST container state; manual review required');
    const [network, endpoint] = networks[0];
    if (network !== 'supabase_network_designflow') throw new Error('Unexpected local network');
    docker(['pull', target]);
    const backup = `${name}_before_phase15`;
    if (docker(['ps', '-a', '--filter', `name=^/${backup}$`, '--format', '{{.Names}}'])) throw new Error('Prior backup exists; manual review required');
    const endpointConfig = { Aliases: endpoint.Aliases, IPAMConfig: { IPv4Address: endpoint.IPAddress } };
    let renamed = false, disconnected = false, created = false;
    try {
      docker(['stop', name]);
      docker(['rename', name, backup]); renamed = true;
      docker(['network', 'disconnect', network, backup]); disconnected = true;
      await api(`/containers/create?name=${name}`, { ...old.Config, Hostname: '', Image: target,
        HostConfig: old.HostConfig, NetworkingConfig: { EndpointsConfig: { [network]: endpointConfig } } });
      created = true;
      docker(['start', name]);
      // Bounded startup readiness only. Never retry a failed application operation.
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          ready = (await globalThis.fetch(`${local.API_URL}/rest/v1/rate_table_versions?select=id&limit=1`, {
            headers: { apikey: local.ANON_KEY, authorization: `Bearer ${local.ANON_KEY}` }, signal: globalThis.AbortSignal.timeout(1000),
          })).ok;
        } catch { /* service is still starting */ }
        if (ready) break;
        await setTimeout(200);
      }
      if (!ready) throw new Error('Replacement REST service did not become ready');
    } catch (error) {
      if (created) docker(['rm', '-f', name]);
      if (renamed) {
        if (disconnected) await api(`/networks/${network}/connect`, { Container: backup, EndpointConfig: endpointConfig });
        docker(['rename', backup, name]);
      }
      docker(['start', name]);
      throw error;
    }
    docker(['rm', backup]);
    console.log(JSON.stringify({ service: name, previous: old.Config.Image, current: target,
      databaseReset: false, jwtConfigurationChanged: false, networkAddressPreserved: true }));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local PostgREST repair failed');
  process.exitCode = 1;
}
