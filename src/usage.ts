import type { CliDeps } from "./types.js";

export const USAGE_TEXT = `cli

Usage:
  cli setup [--url <interface-url>] [--dev] [--token <pat>|--token-file <path>|--token-stdin] [--agent <key>] [--network <network>] [--json] [--link]
  cli config set --url <interface-url> --token <pat>|--token-file <path>|--token-stdin [--agent <key>]
  cli config show
  cli wallet [--network <network>] [--agent <key>]
  cli farcaster signup [--agent <key>] [--recovery <0x...>] [--extra-storage <n>] [--out-dir <path>]
  cli farcaster post --text <text> [--fid <n>] [--signer-file <path>] [--idempotency-key <key>] [--verify]
  cli docs <query> [--limit <n>]
  cli tools get-user <fname>
  cli tools get-cast <identifier> [--type <hash|url>]
  cli tools cast-preview --text <text> [--embed <url>] [--parent <value>]
  cli tools cobuild-ai-context
  cli send <token> <amount> <to> [--network <network>] [--decimals <n>] [--agent <key>] [--idempotency-key <key>]
  cli tx --to <address> --data <hex> [--value <eth>] [--network <network>] [--agent <key>] [--idempotency-key <key>]

Examples:
  cli setup --url http://localhost:3000 --agent default --network base-sepolia
  cli setup --url https://co.build --agent default
  cli setup --dev --agent default --network base-sepolia
  echo "bbt_xxx" | cli setup --url http://localhost:3000 --token-stdin --network base-sepolia
  cli setup --url http://localhost:3000 --network base-sepolia --json
  cli setup --url http://localhost:3000 --network base-sepolia --link
  cli config set --url http://localhost:3000 --token bbt_xxx --agent default
  cli config set --token-file ./cli.token
  cli wallet --network base-sepolia
  cli farcaster signup --agent default
  cli farcaster signup --agent default --recovery 0x000000000000000000000000000000000000dEaD
  cli farcaster post --text "Ship update"
  cli farcaster post --text "Ship update" --fid 123 --idempotency-key 8e03978e-40d5-43e8-bc93-6894a57f9324
  cli docs setup approval flow --limit 5
  cli docs -- --token-stdin
  cli tools get-user will
  cli tools get-cast https://warpcast.com/user/0x123 --type url
  cli tools cast-preview --text "Ship update" --embed https://image.example/pic.png
  cli tools cobuild-ai-context
  cli send usdc 0.10 0x000000000000000000000000000000000000dEaD --network base-sepolia
  cli tx --to 0x1234... --data 0xabcdef --value 0 --network base`;

export function printUsage(deps: Pick<CliDeps, "stdout">): void {
  deps.stdout(USAGE_TEXT);
}
