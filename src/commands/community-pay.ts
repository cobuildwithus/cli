import {
  buildCommunityTerminalPayPlan,
  REVNET_NATIVE_TOKEN,
  serializeProtocolBigInts,
} from "@cobuild/wire";
import type { ProtocolExecutionPlanLike } from "../protocol-plan/types.js";
import type { CliDeps } from "../types.js";
import {
  executeTerminalFundingPlan,
  readOptionalBigintLikeFromInputJson,
  readOptionalRecordFromInputJson,
  readOptionalStringFromInputJson,
  readRequiredBigintLikeFromInputJson,
  readRequiredJsonCommandInput,
  readRequiredStringFromInputJson,
  type TerminalFundingCommandOutput,
  type TerminalFundingJsonCommandInput,
} from "./terminal-funding-shared.js";

const COMMUNITY_PAY_USAGE =
  "Usage: cli community pay --input-json <json>|--input-file <path>|--input-stdin [--dry-run]";

type NumericLike = string | number | bigint;
type RouteInput = {
  goalIds?: readonly NumericLike[];
  weights?: readonly NumericLike[];
};

type CommunityPayPayload = {
  terminal?: string;
  projectId: NumericLike;
  token?: string;
  amount: NumericLike;
  beneficiary: string;
  minReturnedTokens?: NumericLike;
  memo?: string;
  route?: RouteInput;
  jbMetadata?: string;
  network?: string;
  agent?: string;
  idempotencyKey?: string;
};

export interface CommunityPayCommandInput extends TerminalFundingJsonCommandInput {}

export type CommunityPayCommandOutput = TerminalFundingCommandOutput<"community"> & {
  request?: {
    method: "POST";
    path: "/api/cli/exec";
    body: Record<string, unknown>;
  };
  kind?: string;
  transactionHash?: string;
  explorerUrl?: string;
  replayed?: true;
  terminal?: string;
  projectId?: string;
  token?: string;
  amount?: string;
  beneficiary?: string;
  minReturnedTokens?: string;
  memo?: string;
  route?: {
    goalIds: string[];
    weights: number[];
  };
  jbMetadata?: string;
  metadata?: string;
  approvalIncluded?: boolean;
};

type CommunityPayPlan = ReturnType<typeof buildCommunityTerminalPayPlan>;
type CommunityPayExecutionPlan = CommunityPayPlan &
  ProtocolExecutionPlanLike<"community.pay"> & {
  approvalIncluded?: boolean;
};

function readRoute(payload: Record<string, unknown>): RouteInput | undefined {
  const routePayload = readOptionalRecordFromInputJson(payload, "route", "community pay input");
  if (!routePayload) {
    return undefined;
  }

  return {
    goalIds: readRouteArray(routePayload, "goalIds"),
    weights: readRouteArray(routePayload, "weights"),
  };
}

function readRouteArray(
  payload: Record<string, unknown>,
  key: "goalIds" | "weights"
): readonly NumericLike[] | undefined {
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`community pay input "route.${key}" must be an array when provided.`);
  }

  return value.map((entry, index) => {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "bigint") {
      return entry;
    }
    throw new Error(`community pay input "route.${key}[${index}]" must be a string or integer.`);
  });
}

async function resolveCommunityPayPayload(
  input: CommunityPayCommandInput,
  deps: Pick<CliDeps, "fs" | "readStdin">
): Promise<CommunityPayPayload> {
  const payload = await readRequiredJsonCommandInput(input, deps, {
    usage: COMMUNITY_PAY_USAGE,
    valueLabel: "community pay input",
  });

  return {
    terminal: readOptionalStringFromInputJson(payload, "terminal", "community pay input"),
    projectId: readRequiredBigintLikeFromInputJson(payload, "projectId", "community pay input"),
    token: readOptionalStringFromInputJson(payload, "token", "community pay input"),
    amount: readRequiredBigintLikeFromInputJson(payload, "amount", "community pay input"),
    beneficiary: readRequiredStringFromInputJson(payload, "beneficiary", "community pay input"),
    minReturnedTokens: readOptionalBigintLikeFromInputJson(
      payload,
      "minReturnedTokens",
      "community pay input"
    ),
    memo: readOptionalStringFromInputJson(payload, "memo", "community pay input"),
    route: readRoute(payload),
    jbMetadata: readOptionalStringFromInputJson(payload, "jbMetadata", "community pay input"),
    network: readOptionalStringFromInputJson(payload, "network", "community pay input"),
    agent: readOptionalStringFromInputJson(payload, "agent", "community pay input"),
    idempotencyKey: readOptionalStringFromInputJson(
      payload,
      "idempotencyKey",
      "community pay input"
    ),
  };
}

function buildCommunityPayExecutionPlan(plan: CommunityPayPlan): CommunityPayExecutionPlan {
  return {
    ...plan,
    network: plan.network,
    action: "community.pay",
    riskClass: "economic",
    summary: `Pay community ${plan.projectId.toString()} through terminal ${plan.terminal}.`,
    preconditions:
      plan.token === REVNET_NATIVE_TOKEN
        ? []
        : [
            `Ensure payment token allowance for community terminal covers at least ${plan.amount.toString()}.`,
          ],
    expectedEvents: ["Pay"],
    steps: [
      {
        kind: "contract-call",
        contract: "CobuildCommunityTerminal",
        functionName: "pay",
        label: "Pay community terminal",
        transaction: plan.transaction,
      },
    ],
    approvalIncluded: false,
  };
}

function resolveCommunityPayExecutionPlan(plan: CommunityPayPlan): CommunityPayExecutionPlan {
  const candidate = plan as CommunityPayPlan & Partial<CommunityPayExecutionPlan>;
  if (
    typeof candidate.action === "string" &&
    typeof candidate.riskClass === "string" &&
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.preconditions) &&
    Array.isArray(candidate.steps)
  ) {
    return {
      ...candidate,
      expectedEvents: Array.isArray(candidate.expectedEvents) ? candidate.expectedEvents : [],
      approvalIncluded: candidate.approvalIncluded === true,
    } as CommunityPayExecutionPlan;
  }
  return buildCommunityPayExecutionPlan(plan);
}

function serializePlanContext(
  plan: CommunityPayExecutionPlan,
  walletMode: "hosted" | "local"
): Record<string, unknown> {
  return serializeProtocolBigInts({
    walletMode,
    network: plan.network,
    terminal: plan.terminal,
    projectId: plan.projectId,
    token: plan.token,
    amount: plan.amount,
    beneficiary: plan.beneficiary,
    minReturnedTokens: plan.minReturnedTokens,
    memo: plan.memo,
    route: {
      goalIds: [...plan.route.goalIds],
      weights: [...plan.route.weights],
    },
    jbMetadata: plan.jbMetadata,
    metadata: plan.metadata,
    approvalIncluded: plan.approvalIncluded === true,
  }) as Record<string, unknown>;
}

export async function executeCommunityPayCommand(
  input: CommunityPayCommandInput,
  deps: CliDeps
): Promise<CommunityPayCommandOutput> {
  const payload = await resolveCommunityPayPayload(input, deps);
  const basePlan = buildCommunityTerminalPayPlan({
    ...(payload.terminal !== undefined ? { terminal: payload.terminal } : {}),
    projectId: payload.projectId,
    ...(payload.token !== undefined ? { token: payload.token } : {}),
    amount: payload.amount,
    beneficiary: payload.beneficiary,
    ...(payload.minReturnedTokens !== undefined
      ? { minReturnedTokens: payload.minReturnedTokens }
      : {}),
    ...(payload.memo !== undefined ? { memo: payload.memo } : {}),
    ...(payload.route !== undefined ? { route: payload.route } : {}),
    ...(payload.jbMetadata !== undefined ? { jbMetadata: payload.jbMetadata } : {}),
    ...(payload.network !== undefined ? { network: payload.network } : {}),
  });
  const plan = resolveCommunityPayExecutionPlan(basePlan);
  const execution = await executeTerminalFundingPlan({
    deps,
    family: "community",
    input: {
      agent: payload.agent,
      dryRun: input.dryRun,
      idempotencyKey: payload.idempotencyKey,
      network: payload.network,
    },
    plan,
  });
  const context = serializePlanContext(plan, execution.walletMode);
  const lastStep = execution.steps.at(-1);
  const compatibilityFields: Record<string, unknown> = {};

  if (execution.dryRun === true && lastStep) {
    compatibilityFields.request = {
      method: "POST",
      path: "/api/cli/exec",
      body: lastStep.request,
    };
  } else if (lastStep) {
    if (typeof lastStep.transactionHash === "string") {
      compatibilityFields.transactionHash = lastStep.transactionHash;
    }
    if (typeof lastStep.explorerUrl === "string") {
      compatibilityFields.explorerUrl = lastStep.explorerUrl;
    }
    if (lastStep.replayed === true) {
      compatibilityFields.replayed = true;
    }

    const stepResult = lastStep.result as Record<string, unknown> | undefined;
    if (stepResult && typeof stepResult.kind === "string") {
      compatibilityFields.kind = stepResult.kind;
    }
  }

  return {
    ...execution,
    ...context,
    ...compatibilityFields,
  } as CommunityPayCommandOutput;
}
