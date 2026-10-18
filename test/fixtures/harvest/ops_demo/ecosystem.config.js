module.exports = {
  apps: [{ name: "worker", script: "dist/jobs/worker.js", instances: 1, env: { NODE_ENV: "production" } }],
};
