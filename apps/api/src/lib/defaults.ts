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
    commandKey: "ai.status",
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
    commandKey: "ai.style",
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
