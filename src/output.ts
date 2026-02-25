import type { CliDeps } from "./types.js";

export function printJson(deps: Pick<CliDeps, "stdout">, value: unknown): void {
  deps.stdout(JSON.stringify(value, null, 2));
}
