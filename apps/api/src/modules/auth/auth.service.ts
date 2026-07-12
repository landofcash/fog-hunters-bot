import type { AppConfig } from "../../lib/config";
import { ApiError } from "../../lib/errors";
import { generateToken, hashToken } from "../../lib/ids";
import type { AppRepository, DiscordProfile } from "../../repositories/types";

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
}

interface DiscordUserResponse {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export class AuthService {
  constructor(
    private readonly config: AppConfig,
    private readonly repository: AppRepository,
  ) {}

  getDiscordAuthorizeUrl(state: string): string {
    if (!this.config.discordClientId || !this.config.discordRedirectUri) {
      throw new ApiError(500, "DISCORD_AUTH_NOT_CONFIGURED", "Discord OAuth settings are incomplete.");
    }

    const url = new URL(`${this.config.discordApiBase}/oauth2/authorize`);
    url.searchParams.set("client_id", this.config.discordClientId);
    url.searchParams.set("redirect_uri", this.config.discordRedirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.config.discordBotScope);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async authenticateWithDiscordCode(code: string): Promise<DiscordProfile> {
    if (this.config.mockDiscordOauth) {
      const mockUserId = code.startsWith("discord_") ? code.slice("discord_".length) : code;
      return {
        discordUserId: mockUserId,
        username: `mock_${mockUserId}`,
        globalName: `Mock ${mockUserId}`,
        avatarUrl: null,
      };
    }

    if (!this.config.discordClientId || !this.config.discordClientSecret || !this.config.discordRedirectUri) {
      throw new ApiError(500, "DISCORD_AUTH_NOT_CONFIGURED", "Discord OAuth settings are incomplete.");
    }

    const tokenEndpoint = `${this.config.discordApiBase}/oauth2/token`;
    const tokenResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.config.discordClientId,
        client_secret: this.config.discordClientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: this.config.discordRedirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      throw new ApiError(401, "DISCORD_TOKEN_EXCHANGE_FAILED", "Failed to exchange Discord OAuth code.");
    }

    const token = (await tokenResponse.json()) as DiscordTokenResponse;
    const userResponse = await fetch(`${this.config.discordApiBase}/users/@me`, {
      headers: { Authorization: `${token.token_type} ${token.access_token}` },
    });

    if (!userResponse.ok) {
      throw new ApiError(401, "DISCORD_PROFILE_FETCH_FAILED", "Failed to retrieve Discord profile.");
    }

    const profile = (await userResponse.json()) as DiscordUserResponse;
    return {
      discordUserId: profile.id,
      username: profile.username,
      globalName: profile.global_name,
      avatarUrl: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null,
    };
  }

  async createSession(input: {
    code: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ sessionToken: string; csrfToken: string; userId: string; discordUserId: string }> {
    const profile = await this.authenticateWithDiscordCode(input.code);
    const isPlatformAdmin = this.config.platformAdminDiscordIds.has(profile.discordUserId);
    const user = await this.repository.upsertUserFromDiscord(profile, isPlatformAdmin);

    const sessionToken = generateToken();
    const csrfToken = generateToken(24);
    const sessionTokenHash = hashToken(sessionToken, this.config.sessionSecret);
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 60 * 60 * 1000);

    await this.repository.createSession({
      userId: user.id,
      sessionTokenHash,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      expiresAt,
    });

    return {
      sessionToken,
      csrfToken,
      userId: user.id,
      discordUserId: user.discordUserId,
    };
  }
}
