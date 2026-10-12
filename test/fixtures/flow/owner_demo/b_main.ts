#!/usr/bin/env node
// Resolves a folder next to itself with the standard library's URL helpers.
import { fileURLToPath } from "node:url";

const EXAMPLES = fileURLToPath(new URL("../examples/", import.meta.url));
console.log(EXAMPLES);
