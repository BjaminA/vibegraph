// A library: it defines and computes at load, and runs nothing.
export function run(target: string): string { return `ran ${target}`; }
export const DEFAULT = run("default");
