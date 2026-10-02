#!/usr/bin/env node
// The report process: reads the default client config.
import { settings } from "../src/config.ts";
import { connect } from "../src/store.ts";
import { MemoryBucket, save, bucketName } from "../src/store.ts";

const client = connect(settings.configPath);
await save(new MemoryBucket(), bucketName("orders"), "ok");
client.destroy();
