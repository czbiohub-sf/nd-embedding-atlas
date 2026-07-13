/** Extension host API version, released independently from the app. */
import packageJson from "../package.json";

export const SDK_VERSION = packageJson.version;

export function sdkMajor(version: string): string {
  return version.split(".")[0];
}
