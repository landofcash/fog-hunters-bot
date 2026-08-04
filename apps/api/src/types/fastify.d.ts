import type { AppConfig } from "../lib/config";
import type { AuthContext } from "../lib/domain";
import type { JobsService } from "../modules/jobs/jobs.service";
import type {
  AppRepository,
  BotInstanceRecord,
  BotRuntimeLeaseRecord,
  GuildRecord,
  MembershipRecord,
} from "../repositories/types";

declare module "fastify" {
  interface FastifyInstance {
    appConfig: AppConfig;
    repository: AppRepository;
    jobs: JobsService;
  }

  interface FastifyRequest {
    auth?: AuthContext;
    guildContext?: {
      guild: GuildRecord;
      membership: MembershipRecord;
    };
    botLeaseContext?: {
      bot: BotInstanceRecord;
      lease: BotRuntimeLeaseRecord;
      leaseTokenHash: string;
    };
  }
}
