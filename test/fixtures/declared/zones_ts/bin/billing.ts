#!/usr/bin/env node
// The billing process, as the billing identity:
//   CLIENT_CONFIG=billing-svc.json node bin/billing.ts
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { settings } from "../src/config.ts";
import { connect } from "../src/store.ts";
import { ledgerKey } from "../src/catalogue.ts";

const client = connect(settings.configPath);
await client.send(new PutObjectCommand({ Bucket: settings.prefix, Key: ledgerKey("e1"), Body: "{}" }));
