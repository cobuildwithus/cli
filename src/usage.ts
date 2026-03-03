import type { CliDeps } from "./types.js";

export const USAGE_TEXT = `cli

Usage:
  cli setup [--url <interface-url>] [--chat-api-url <chat-api-url>] [--dev] [--token <refresh-token>|--token-file <path>|--token-stdin] [--agent <key>] [--network <network>] [--write] [--show-approval-url] --wallet-mode hosted|local-generate|local-key [--wallet-private-key-stdin|--wallet-private-key-file <path>] [--json] [--link]
  cli config set --url <interface-url> [--chat-api-url <chat-api-url>] --token <refresh-token>|--token-file <path>|--token-stdin [--agent <key>]
  cli config show
  cli wallet [status] [--network <network>] [--agent <key>]
  cli wallet init [--agent <key>] [--mode hosted|local-generate|local-key] [--private-key-stdin|--private-key-file <path>] [--no-prompt]
  cli farcaster signup [--agent <key>] [--recovery <0x...>] [--extra-storage <n>] [--out-dir <path>]
  cli farcaster post --text <text> [--fid <n>] [--reply-to <parent-fid:0x-parent-hash>] [--signer-file <path>] [--idempotency-key <key>] [--verify[=once|poll]|--verify=none]
  cli goal create --factory <address> [--params-file <path>|--params-json <json>|--params-stdin] [--network <network>] [--agent <key>] [--idempotency-key <key>]
  cli docs <query> [--limit <n>]
  cli tools get-user <fname>
  cli tools get-cast <identifier> [--type <hash|url>]
  cli tools cast-preview --text <text> [--embed <url>] [--parent <value>]
  cli tools get-treasury-stats
  cli tools get-wallet-balances [--agent <key>] [--network <network>]
  cli send <token> <amount> <to> [--network <network>] [--decimals <n>] [--agent <key>] [--idempotency-key <key>]
  cli tx --to <address> --data <hex> [--value <eth>] [--network <network>] [--agent <key>] [--idempotency-key <key>]

Examples:
  cli setup --url http://localhost:3000 --chat-api-url http://localhost:4000 --agent default --network base
  cli setup --url https://co.build --agent default
  cli setup --url https://co.build --agent default --write
  cli setup --dev --agent default --network base
  cli setup --url https://co.build --agent default --wallet-mode hosted
  cli setup --url https://co.build --agent default --wallet-mode local-generate
  echo "0x<64-hex-private-key>" | cli setup --url https://co.build --agent default --wallet-mode local-key --wallet-private-key-stdin
  echo "rfr_xxx" | cli setup --url http://localhost:3000 --token-stdin --network base
  cli setup --url http://localhost:3000 --network base --json
  cli setup --url http://localhost:3000 --network base --link
  cli config set --url http://localhost:3000 --chat-api-url http://localhost:4000 --token rfr_xxx --agent default
  cli config set --token-file ./cli.token
  cli wallet --network base
  cli wallet init --agent default --mode local-generate
  cli farcaster signup --agent default
  cli farcaster signup --agent default --recovery 0x000000000000000000000000000000000000dEaD
  cli farcaster post --text "Ship update"
  cli farcaster post --text "Replying on thread" --reply-to 123:0x1111111111111111111111111111111111111111
  cli farcaster post --text "Ship update" --fid 123 --idempotency-key 8e03978e-40d5-43e8-bc93-6894a57f9324 --verify=once
  cli goal create --factory 0x000000000000000000000000000000000000dEaD --params-file ./goal-deploy.json --network base
  cli docs setup approval flow --limit 5
  cli docs -- --token-stdin
  cli tools get-user will
  cli tools get-cast https://warpcast.com/user/0x123 --type url
  cli tools cast-preview --text "Ship update" --embed https://image.example/pic.png
  cli tools get-treasury-stats
  cli tools get-wallet-balances --agent default --network base
  cli send usdc 0.10 0x000000000000000000000000000000000000dEaD --network base
  cli tx --to 0x1234... --data 0xabcdef --value 0 --network base`;

export function printUsage(deps: Pick<CliDeps, "stdout">): void {
  deps.stdout(USAGE_TEXT);
}
