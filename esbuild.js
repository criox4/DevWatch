const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  // Build configuration for extension
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode', 'dockerode'],
    logLevel: 'warning',
    target: 'node18',
  });

  // Build configuration for MCP server
  const mcpCtx = await esbuild.context({
    entryPoints: ['src/mcp/mcpServer.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/mcp-server.js',
    external: ['vscode'], // Prevent accidental vscode import
    logLevel: 'warning',
    target: 'node18',
  });

  if (watch) {
    await extensionCtx.watch();
    await mcpCtx.watch();
    console.log('Watching for changes...');
  } else {
    await extensionCtx.rebuild();
    await mcpCtx.rebuild();
    await extensionCtx.dispose();
    await mcpCtx.dispose();
    console.log(production ? 'Production build complete.' : 'Build complete.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
