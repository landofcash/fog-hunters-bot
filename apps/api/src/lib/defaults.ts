import type { TenantRole } from "./domain";

export interface DefaultFeatureConfig {
  featureKey: string;
  enabled: boolean;
  configJson: Record<string, unknown>;
}

export interface DefaultCommandPolicy {
  commandKey: string;
  minRole: TenantRole;
  allowChannels: string[];
  denyChannels: string[];
}

export const DEFAULT_FEATURE_FLAGS: DefaultFeatureConfig[] = [
  {
    featureKey: "basic_commands",
    enabled: true,
    configJson: {},
  },
  {
    featureKey: "settings",
    enabled: true,
    configJson: {},
  },
  {
    featureKey: "ai_chat",
    enabled: false,
    configJson: {},
  },
];

export const DEFAULT_COMMAND_POLICIES: DefaultCommandPolicy[] = [
  {
    commandKey: "settings.view",
    minRole: "ADMIN",
    allowChannels: [],
    denyChannels: [],
  },
  {
    commandKey: "settings.admin.list",
    minRole: "ADMIN",
    allowChannels: [],
    denyChannels: [],
  },
  {
    commandKey: "settings.admin.add",
    minRole: "OWNER",
    allowChannels: [],
    denyChannels: [],
  },
  {
    commandKey: "settings.admin.remove",
    minRole: "OWNER",
    allowChannels: [],
    denyChannels: [],
  },
  {
    commandKey: "ai.status",
    minRole: "ADMIN",
    allowChannels: [],
    denyChannels: [],
  },
  {
    commandKey: "ai.model",
    minRole: "ADMIN",
    allowChannels: [],
    denyChannels: [],
  },
  {
    commandKey: "ai.enable",
    minRole: "ADMIN",
    allowChannels: [],
    denyChannels: [],
  },
  {
    commandKey: "ai.disable",
    minRole: "ADMIN",
    allowChannels: [],
    denyChannels: [],
  },
  {
    commandKey: "ai.prompt.view",
    minRole: "ADMIN",
    allowChannels: [],
    denyChannels: [],
  },
  {
    commandKey: "ai.prompt.set",
    minRole: "ADMIN",
    allowChannels: [],
    denyChannels: [],
  },
  {
    commandKey: "ai.prompt.reset",
    minRole: "ADMIN",
    allowChannels: [],
    denyChannels: [],
  },
  {
    commandKey: "ai.memory.clear",
    minRole: "ADMIN",
    allowChannels: [],
    denyChannels: [],
  },
  {
    commandKey: "ai.retention",
    minRole: "ADMIN",
    allowChannels: [],
    denyChannels: [],
  },
];

export const RETIRED_COMMAND_POLICY_KEYS = ["ai.style"] as const;
