import type { Approval } from "@breeze/common";

/**
 * Approval service: creation is centralized in the broker; this module
 * exposes read + decision operations used by UI routes.
 */
export const ApprovalService = {
  async listPending(_userId: string): Promise<Approval[]> {
    return [];
  },

  async listRecentDecided(_userId: string, _limit = 25): Promise<Approval[]> {
    return [];
  },

  async get(_id: string, _userId: string): Promise<Approval> {
    throw new Error("ApprovalService.get not implemented");
  },

  async approve(
    _id: string,
    _userId: string,
    _opts: { edit?: Record<string, unknown>; note?: string }
  ): Promise<Approval> {
    throw new Error("ApprovalService.approve not implemented");
  },

  async deny(_id: string, _userId: string, _note?: string): Promise<Approval> {
    throw new Error("ApprovalService.deny not implemented");
  },

  async cancel(_id: string, _userId: string): Promise<Approval> {
    throw new Error("ApprovalService.cancel not implemented");
  },
};
