#!/usr/bin/env node
// A model that answers nothing (test:e2e-setup-welcome). The setup's "Run all"
// must say each model step failed and why, still run the census (no model
// call), and end saying what waits for a person. Nothing is fetched or spent.
process.stderr.write("fake claude: no model in this test\n");
process.exit(1);
