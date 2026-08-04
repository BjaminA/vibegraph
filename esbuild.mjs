import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

const serverConfig = {
  entryPoints: ["server.ts"],
  bundle: true,
  outfile: "dist/server.js",
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  // The Agent SDK uses createRequire(import.meta.url) internally to
  // load its bundled native Claude Code binary. Bundling it into our
  // CJS server inlines `import.meta.url` as undefined and crashes on
  // first import. Resolve it from node_modules at runtime instead.
  external: ["@anthropic-ai/claude-agent-sdk"],
};

const webviewConfig = {
  entryPoints: ["src/webview/index.tsx"],
  bundle: true,
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  target: "es2021",
  sourcemap: true,
  // url() in @fontsource CSS resolves to /fonts/<name>-<hash>.woff2 — served
  // by server.ts's static handler out of dist/.
  loader: { ".woff2": "file" },
  assetNames: "fonts/[name]-[hash]",
  publicPath: "/",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
};

async function build() {
  if (isWatch) {
    const webCtx = await esbuild.context(webviewConfig);
    const srvCtx = await esbuild.context(serverConfig);
    await Promise.all([webCtx.watch(), srvCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    await Promise.all([
      esbuild.build(serverConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log("Build complete.");
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
