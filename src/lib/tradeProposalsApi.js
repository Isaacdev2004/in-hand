import { supabase } from "./supabaseClient";

export function tradeProposalToRow(p) {
  return {
    id: p.id,
    proposer_id: p.proposerId,
    receiver_id: p.receiverId,
    target_card_id: p.targetCardId,
    offered_card_ids: p.offeredCardIds || [],
    topup_suggested: p.topupSuggested ?? 0,
    topup_agreed: p.topupAgreed ?? 0,
    topup_counter_round: p.topupCounterRound ?? 0,
    topup_status: p.topupStatus || "none",
    last_topup_by: p.lastTopupBy || null,
    status: p.status || "pending",
    created_at: p.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function insertTradeProposal(proposal) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase.from("trade_proposals").insert(tradeProposalToRow(proposal));
}

export async function updateTradeProposal(proposalId, patch) {
  if (!supabase) return { data: null, error: null, skipped: true };
  const row = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.topupSuggested !== undefined) row.topup_suggested = patch.topupSuggested;
  if (patch.topupAgreed !== undefined) row.topup_agreed = patch.topupAgreed;
  if (patch.topupCounterRound !== undefined) row.topup_counter_round = patch.topupCounterRound;
  if (patch.topupStatus !== undefined) row.topup_status = patch.topupStatus;
  if (patch.lastTopupBy !== undefined) row.last_topup_by = patch.lastTopupBy;
  return supabase.from("trade_proposals").update(row).eq("id", proposalId);
}

/** Receiver accepts — atomically swaps all listings (multi-figure). */
export async function executeTradeProposal(proposalId) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase.rpc("execute_trade_proposal", { p_proposal_id: proposalId });
}
