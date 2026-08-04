// Public entry for the layout module.
//
// PLAN.md M3 split layout out of App.tsx into its own folder so the column-
// based manual algorithm can later be replaced (PLAN says "Dagre may replace
// it later") without touching the React tree.

export { buildLayout, calcHeight } from "./buildLayout";
export { buildProjectLayout, basename } from "./buildProjectLayout";
export { astEdgesToFlow, EDGE_STYLES } from "./edges";
export { applyFilters, computeExcluded, nodePassesFilter } from "./filters";
