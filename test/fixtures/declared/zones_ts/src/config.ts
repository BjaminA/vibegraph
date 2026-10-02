// Settings: one bucket per zone, named from a prefix; each process its own client config.
export const settings = {
  prefix: process.env.BUCKET_PREFIX ?? "acme",
  configPath: process.env.CLIENT_CONFIG ?? "app.json",
};
