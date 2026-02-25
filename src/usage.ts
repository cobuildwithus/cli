import type { CliDeps } from "./types.js";

export const USAGE_TEXT = `buildbot

Usage:
  buildbot setup [--url <interface-url>] [--token <pat>|--token-file <path>|--token-stdin] [--agent <key>] [--network <network>] [--json] [--link]
  buildbot config set --url <interface-url> --token <pat>|--token-file <path>|--token-stdin [--agent <key>]
  buildbot config show
  buildbot wallet [--network <network>] [--agent <key>]
  buildbot docs <query> [--limit <n>]
  buildbot send <token> <amount> <to> [--network <network>] [--decimals <n>] [--agent <key>] [--idempotency-key <key>]
  buildbot tx --to <address> --data <hex> [--value <eth>] [--network <network>] [--agent <key>] [--idempotency-key <key>]

Examples:
  buildbot setup --url http://localhost:3000 --agent default --network base-sepolia
  echo "bbt_xxx" | buildbot setup --url http://localhost:3000 --token-stdin --network base-sepolia
  buildbot setup --url http://localhost:3000 --network base-sepolia --json
  buildbot setup --url http://localhost:3000 --network base-sepolia --link
  buildbot config set --url http://localhost:3000 --token bbt_xxx --agent default
  buildbot config set --token-file ./buildbot.token
  buildbot wallet --network base-sepolia
  buildbot docs setup approval flow --limit 5
  buildbot docs -- --token-stdin
  buildbot send usdc 0.10 0x000000000000000000000000000000000000dEaD --network base-sepolia
  buildbot tx --to 0x1234... --data 0xabcdef --value 0 --network base`;

export function printUsage(deps: Pick<CliDeps, "stdout">): void {
  deps.stdout(USAGE_TEXT);
}
