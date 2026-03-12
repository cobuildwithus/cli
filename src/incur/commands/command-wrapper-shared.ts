import type { CliDeps } from "../../types.js";

type CommandExecutor<TInput, TOutput> = (input: TInput, deps: CliDeps) => Promise<TOutput> | TOutput;

export function forwardOptionsToExecutor<
  TOptions extends Record<string, unknown>,
  TOutput,
>(deps: CliDeps, executor: CommandExecutor<TOptions, TOutput>) {
  return (context: { options: TOptions }) => executor(context.options, deps) as Promise<TOutput>;
}

export function mapOptionsToExecutor<
  TOptions extends Record<string, unknown>,
  TInput,
  TOutput,
>(deps: CliDeps, executor: CommandExecutor<TInput, TOutput>, map: (options: TOptions) => TInput) {
  return (context: { options: TOptions }) => executor(map(context.options), deps) as Promise<TOutput>;
}
