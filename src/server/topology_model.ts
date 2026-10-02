// ONE TOPOLOGY MODEL (2026-10-02, field report "the location split", M7).
// What VibeGraph reads from the code (data_arch.ts) is the lowest-ranked
// source; a project's own generator overrides it wherever both speak. Every
// reader takes the model from here — the rule checks, `plan check`, the
// `topology` commands, the lenses and the export — so a zone found in the code
// is checkable everywhere, not only where someone registered a generator.

import type { TopologyModel } from "../shared/topology_types.ts";
import { loadTopology } from "./topology_store.ts";
import { deriveDataArchitecture } from "./data_arch.ts";
import { buildStackIndex } from "./stack.ts";

interface EnvLike { files?: Record<string, any>; threads?: any[]; entryPoints?: any[] }

export function topologyFor(root: string, env: EnvLike, stack?: unknown): TopologyModel {
  const files = env.files ?? {};
  let derived;
  try {
    const st = stack ?? buildStackIndex({ files, threads: env.threads ?? [] } as never, root);
    derived = deriveDataArchitecture(files, st as never, (env.threads ?? []) as never).topology;
  } catch { derived = undefined; }
  return loadTopology(root, derived);
}
