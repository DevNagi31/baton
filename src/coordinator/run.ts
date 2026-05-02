export async function runTask(_cwd: string, task: string): Promise<void> {
  // TODO Phase 1: load config, decompose task into a plan via the plan-stage
  // agent (Claude by default), append the plan to .baton/context.md, then
  // dispatch each step in sequence via the routing rule table.
  console.log(`[baton] received task: ${task}`);
  console.log("[baton] runner not implemented yet — see ROADMAP Phase 1.");
}
