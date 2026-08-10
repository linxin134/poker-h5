import { z } from "zod";
import type { Card, LegalActions, PlayerAction, PokerState } from "../game/types";

export interface AgentObservation {
  handId: string;
  seatId: string;
  holeCards: Card[];
  communityCards: Card[];
  pot: number;
  stack: number;
  legalActions: LegalActions;
  publicState: Omit<PokerState, "deck" | "events" | "seats"> & {
    seats: Array<Omit<PokerState["seats"][number], "holeCards">>;
  };
}

export interface AgentDecision {
  action: PlayerAction;
  raiseTo?: number;
  message?: string;
}

export interface PokerAgent {
  readonly id: string;
  decide(observation: AgentObservation, signal?: AbortSignal): Promise<AgentDecision>;
}

export const agentDecisionSchema = z.object({
  action: z.enum(["fold", "check", "call", "raise", "all-in"]),
  raiseTo: z.number().int().positive().optional(),
  message: z.string().max(120).optional()
});

export function validateAgentDecision(value: unknown, legal: LegalActions): AgentDecision {
  const decision = agentDecisionSchema.parse(value);
  if (!legal.actions.includes(decision.action)) throw new Error("Agent 返回了非法行动");
  if (decision.action === "raise") {
    if (!decision.raiseTo || decision.raiseTo < legal.minRaiseTo || decision.raiseTo > legal.maxRaiseTo) throw new Error("Agent 加注额非法");
  }
  return decision;
}

/** Future adapter boundary. Keep API keys and model calls on the server. */
export interface RemoteAgentGateway {
  requestDecision(agentId: string, observation: AgentObservation, signal?: AbortSignal): Promise<unknown>;
}
