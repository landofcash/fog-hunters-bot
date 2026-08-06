const packageMetadata = require("../../package.json") as { version?: unknown };

if (typeof packageMetadata.version !== "string" || packageMetadata.version.length === 0) {
  throw new Error("API package version is missing.");
}

export const APP_VERSION = packageMetadata.version;
