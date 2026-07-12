export type TenantRole = "OWNER" | "ADMIN" | "MODERATOR" | "USER";
export type PlatformRole = "PLATFORM_ADMIN" | "NONE";
export type GuildStatus = "ACTIVE" | "DISABLED" | "LEFT";
export type MemberStatus = "ACTIVE" | "INVITED" | "REMOVED";
export type JobStatus = "QUEUED" | "RUNNING" | "FAILED" | "COMPLETED" | "CANCELLED";
export type AuditActorType = "USER" | "SYSTEM" | "PLATFORM_ADMIN";
export type LlmConversationType = "GUILD_CHANNEL" | "DM";
export type LlmMessageRole = "SYSTEM" | "USER" | "ASSISTANT";
export type LlmGenerationStatus = "SUCCESS" | "FAILED" | "SKIPPED";

export interface AuthContext {
  userId: string;
  discordUserId: string;
  platformRole: PlatformRole;
  sessionTokenHash: string;
}
