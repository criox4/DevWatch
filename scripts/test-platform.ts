import { getPlatformAdapter } from '../src/platform';

async function main() {
  const adapter = getPlatformAdapter();
  console.log(`Platform: ${adapter.platformName}`);

  console.log('\n--- Listening Ports ---');
  const ports = await adapter.getListeningPorts();
  console.log(`Found ${ports.length} listening ports:`);
  ports.slice(0, 10).forEach(p => {
    console.log(`  Port ${p.port} (${p.protocol}) -> PID ${p.pid} [${p.processName}] on ${p.address}`);
  });

  console.log('\n--- Current Process Info ---');
  const info = await adapter.getProcessInfo(process.pid);
  console.log(info ? `  PID: ${info.pid}, Name: ${info.name}, CPU: ${info.cpu}%, Mem: ${Math.round(info.memory / 1024 / 1024)}MB` : '  Not found');

  console.log('\n--- Process Children (PID 1) ---');
  const children = await adapter.getProcessChildren(1);
  console.log(`  PID 1 has ${children.length} direct/indirect children`);

  console.log('\nSmoke test passed!');
}

main().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
