import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

// Usage: node deploy/prepare.mjs ../QoLAF-Client/dist
// Prints a staging directory suitable for uploading to /srv/raony/astroflux.
const clientDirectory = resolve(process.argv[2] ?? '../QoLAF-Client/dist');
const metadata = JSON.parse(await readFile(join(clientDirectory, 'build.json'), 'utf8'));
const client = await readFile(join(clientDirectory, 'qolaf-client.js'));
if (metadata.build !== 'Public' || createHash('sha256').update(client).digest('hex') !== metadata.sha256)
  throw new Error('Deployment requires a verified Public client build.');
const output = await mkdtemp(join(tmpdir(), 'qolaf-vps-'));
await cp(new URL('../public/', import.meta.url), output, { recursive: true });
await writeFile(join(output, 'deployment.js'), 'export const liveUpstream = true;\n');
const corePath = join(output, 'plugins/core.js');
const core = await readFile(corePath, 'utf8');
const oldDefault = "'https://raonygamer.github.io/QoLAF-Client/qolaf-client.js'";
if (!core.includes(oldDefault)) throw new Error('Default client URL anchor changed.');
await writeFile(corePath, core.replace(oldDefault, "new URL('../client/qolaf-client.js', import.meta.url).href"));
await mkdir(join(output, 'client'));
await writeFile(join(output, 'client/qolaf-client.js'), client);
await writeFile(join(output, 'client/build.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(output);
