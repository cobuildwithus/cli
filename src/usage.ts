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
  cli goal create [--factory <address>] [--params-file <path>|--params-json <json>|--params-stdin] [--network <network>] [--agent <key>] [--idempotency-key <key>]
  cli tcr inspect <identifier>
  cli tcr submit-budget --input-json <json>|--input-file <path>|--input-stdin [--dry-run]
  cli tcr submit-mechanism --input-json <json>|--input-file <path>|--input-stdin [--dry-run]
  cli tcr submit-round-submission --input-json <json>|--input-file <path>|--input-stdin [--dry-run]
  cli tcr remove --registry <address> --deposit-token <address> --item-id <bytes32> --costs-json <json>|--costs-file <path>|--costs-stdin [--evidence <text>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli tcr challenge --registry <address> --deposit-token <address> --item-id <bytes32> --request-type <registrationRequested|clearingRequested|2|3> --costs-json <json>|--costs-file <path>|--costs-stdin [--evidence <text>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli tcr execute --registry <address> --item-id <bytes32> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli tcr timeout --registry <address> --item-id <bytes32> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli tcr evidence --registry <address> --item-id <bytes32> --evidence <text> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli tcr withdraw --registry <address> --beneficiary <address> --item-id <bytes32> --request-index <n> --round-index <n> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli vote status <identifier> [--juror <address>]
  cli vote commit --arbitrator <address> --dispute-id <n> [--commit-hash <bytes32>|--round <n> --choice <n> --salt <bytes32> [--voter <address>] [--reason <text>] [--chain-id <n>]] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli vote commit-for --arbitrator <address> --dispute-id <n> --voter <address> [--commit-hash <bytes32>|--round <n> --choice <n> --salt <bytes32> [--reason <text>] [--chain-id <n>]] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli vote reveal --arbitrator <address> --dispute-id <n> --voter <address> --choice <n> --salt <bytes32> [--reason <text>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli vote rewards --arbitrator <address> --dispute-id <n> --round <n> --voter <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli vote invalid-round-rewards --arbitrator <address> --dispute-id <n> --round <n> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli vote execute-ruling --arbitrator <address> --dispute-id <n> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli stake status <identifier> <account>
  cli stake deposit-goal --vault <address> --token <address> --amount <n> [--approval-mode <auto|force|skip>] [--current-allowance <n>] [--approval-amount <n>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli stake deposit-cobuild --vault <address> --token <address> --amount <n> [--approval-mode <auto|force|skip>] [--current-allowance <n>] [--approval-amount <n>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli stake prepare-underwriter-withdrawal --vault <address> --max-budgets <n> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli stake withdraw-goal --vault <address> --amount <n> --recipient <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli stake withdraw-cobuild --vault <address> --amount <n> --recipient <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli premium status <identifier> [--account <address>]
  cli premium checkpoint --escrow <address> --account <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli premium claim --escrow <address> --recipient <address> [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli revnet pay --amount <wei> [--project-id <n>] [--beneficiary <address>] [--min-returned-tokens <n>] [--memo <text>] [--metadata <hex>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli revnet cash-out --cash-out-count <n> [--project-id <n>] [--beneficiary <address>] [--min-reclaim-amount <n>] [--preferred-base-token <address>] [--metadata <hex>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli revnet loan --collateral-count <n> --repay-years <n> [--project-id <n>] [--beneficiary <address>] [--min-borrow-amount <n>] [--preferred-base-token <address>] [--preferred-loan-token <address>] [--permission-mode <auto|force|skip>] [--network <network>] [--agent <key>] [--idempotency-key <key>] [--dry-run]
  cli revnet issuance-terms [--project-id <n>]
  cli docs <query> [--limit <n>]
  cli tools get-user <fname>
  cli tools get-cast <identifier> [--type <hash|url>]
  cli tools cast-preview --text <text> [--embed <url>] [--parent <value>]
  cli tools get-treasury-stats
  cli tools get-wallet-balances [--agent <key>] [--network <network>]
  cli tools notifications list [--limit <n>] [--cursor <cursor>] [--unread-only] [--kind <kind>]
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
  cli goal create --params-file ./goal-deploy.json --network base
  cli tcr submit-budget --input-file ./budget-tcr-submit.json --dry-run
  cli tcr challenge --registry 0x000000000000000000000000000000000000dEaD --deposit-token 0x00000000000000000000000000000000000000aa --item-id 0x1111111111111111111111111111111111111111111111111111111111111111 --request-type registrationRequested --costs-file ./tcr-costs.json --dry-run
  cli vote commit --arbitrator 0x000000000000000000000000000000000000dEaD --dispute-id 1 --round 0 --voter 0x00000000000000000000000000000000000000aa --choice 1 --salt 0x1111111111111111111111111111111111111111111111111111111111111111 --dry-run
  cli stake deposit-goal --vault 0x000000000000000000000000000000000000dEaD --token 0x00000000000000000000000000000000000000aa --amount 1000000 --dry-run
  cli premium claim --escrow 0x000000000000000000000000000000000000dEaD --recipient 0x00000000000000000000000000000000000000aa --dry-run
  cli revnet pay --amount 1000000000000000 --dry-run
  cli revnet cash-out --cash-out-count 1000000000000000000 --dry-run
  cli revnet loan --collateral-count 1000000000000000000 --repay-years 1 --dry-run
  cli revnet issuance-terms
  cli revnet issuance-terms --project-id 138
  cli docs setup approval flow --limit 5
  cli docs -- --token-stdin
  cli tools get-user will
  cli tools get-cast https://warpcast.com/user/0x123 --type url
  cli tools cast-preview --text "Ship update" --embed https://image.example/pic.png
  cli tools get-treasury-stats
  cli tools get-wallet-balances --agent default --network base
  cli tools notifications list --limit 10 --unread-only --kind discussion
  cli send usdc 0.10 0x000000000000000000000000000000000000dEaD --network base
  cli tx --to 0x1234... --data 0xabcdef --value 0 --network base`;

export function printUsage(deps: Pick<CliDeps, "stdout">): void {
  deps.stdout(USAGE_TEXT);
}
