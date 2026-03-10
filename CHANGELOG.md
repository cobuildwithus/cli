# Changelog

All notable changes to this project will be documented in this file.

## [0.1.6] - 2026-03-10

### Added
- add indexed protocol inspect commands
- add goal and budget inspect commands
- add notifications list command
- adopt incur 0.3 globals
- harden agent-safe command execution paths
- add goal create command
- hard-cutover wallet modes with local parity
- add wallet balance command
- add explicit chat-api routing for canonical v1 endpoints
- complete incur backbone cutover
- cut over runtime to incur
- add per-agent x402 payer modes
- finalize secret-ref cutover and harden setup recovery
- add farcaster signup command

### Fixed
- align notifications cursor contract
- run local pre-commit before husky fallback
- upgrade incur to 0.1.17
- bump wire dependency to 0.1.3
- harden mcp runtime and config defaults
- restore farcaster payer alias
- harden incur runtime contracts
- harden canonical v1 cutover guidance
- stabilize x402 and tool coverage checks
- correct x402 payee and warn on verify costs

### Changed
- align release docs with ts projects
- split ts projects for source dev
- checkpoint dirty worktree
- add participant protocol cli tracks
- cut create to shared wire helpers
- bump wire to 0.1.8
- close phase 2 inspect plan
- bump wire to v0.1.6
- bump repo-tools to v0.1.13
- remove fallback fixture assumptions
- align shared review dependencies
- clear coordination ledger
- document published wire verification guard
- enforce published dependency
- bump to 0.1.8
- use published 0.1.6 wrappers
- share audit and dependency wrappers
- use published repo-tools
- share repo tooling
- extract shared repo scripts
- simplify drift guardrails
- remove local wrapper scripts
- simplify agent-safety internals
- prefer local cli and enforce published dep
- run husky hooks before commit-tree writes
- harden timeout coverage
- use canonical wire goal abi and shared ensure script
- consolidate cli wallet setup and execution helpers
- simplify command routing and add payer-config coverage
- enforce published wire resolution in pre-commit
- add zod response schemas for stable api parsing
- add zod parser edge-case coverage
- split god files into modules
- centralize header and key contract
- add generated key validation coverage
- cutover to cli
- require build in verification checks
- hard-cutover payer namespace
- hard-cutover to unified payer setup
- extend x402 setup coverage
- stabilize hard-cutover test gates
- add config origin auth regression cases
- add backbone regression coverage invariants
- add dual-api-url routing boundary coverage
- add zip:src audit package script
- cover 404 tool-name mismatch classification
- remove remaining legacy command wrappers
- cover execute surface stdout contract
- add canonical route cutover edge coverage
- add backbone cutover coverage audit
- cover canonical candidate retry path
- add farcaster post reply-to support via x402 flow
- simplify x402 payer-mode flow
- align farcaster signup fixture to txHash
- migrate docs and tools to canonical tool executions
- bump @cobuild/review-gpt to 0.2.7
- bump @cobuild/review-gpt to 0.2.6
- mark releases as user-operated
- bump review-gpt cli to 0.2.3
- Update doc-inventory.md

## [0.1.5] - 2026-02-25

### Fixed
- enforce provenance repository metadata

## [0.1.4] - 2026-02-25

### Fixed
- harden docs drift release exemptions

## [0.1.3] - 2026-02-25

### Changed
- Update doc-inventory.md

## [0.1.2] - 2026-02-25

### Fixed
- enforce docs gates and pinless pnpm setup

### Changed
- streamline verify and tighten docs guardrails

## [0.1.1] - 2026-02-25

### Added
- add codex-style changelog and notes
- split interface and chat-api endpoints
- add CLI tools commands
- normalize interface urls and add defaults
- add docs search command
- sync gpt draft workflow

### Fixed
- harden prerelease guards and ci parity
- harden exec safety and approval flow
- prefill no-send prompt inline
- harden transport and setup security paths
- harden setup and config trust boundaries

### Changed
- use agent skill wording
- hard-cutover naming and release guards
- add cli rebrand guard tests
- use @cobuild/review-gpt@0.2.2
- refresh generated inventory
- sync docs and setup rename assertions
- simplify release fixture setup
- simplify dist-tag and setup URL normalization
- add viem for exec input validation
- harden npm release pipeline
- simplify viem hex validation guard
- add funds safety audit assertions
- hard-cut interface-only docs tools routing
- migrate to shared review cli
- sync CLI tool guidance
- add design and product spec docs
- expand docs command coverage
- cut over CLI naming and skill docs
- add ci coverage and codeql gates
- first commit
- add security hardening regression tests
- bootstrap repository

## [0.1.0] - 2026-02-25

### Added
- Initial public package + CLI workflow.
