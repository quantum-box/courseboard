import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const teamId = process.env.APPLE_DEVELOPMENT_TEAM;
const profileName = process.env.APPLE_PROVISIONING_PROFILE_SPECIFIER;

if (!teamId || !profileName) {
  throw new Error(
    "APPLE_DEVELOPMENT_TEAM and APPLE_PROVISIONING_PROFILE_SPECIFIER are required",
  );
}

const projectDirectory = resolve("src-tauri/gen/apple");
const projectSpec = resolve(projectDirectory, "project.yml");
const marker = "        ENABLE_BITCODE: false\n";
const signingSettings = [
  marker.trimEnd(),
  "        CODE_SIGN_STYLE: Manual",
  '        CODE_SIGN_IDENTITY: "Apple Distribution"',
  `        DEVELOPMENT_TEAM: ${teamId}`,
  `        PROVISIONING_PROFILE_SPECIFIER: "${profileName}"`,
  "",
].join("\n");

const source = readFileSync(projectSpec, "utf8");
if (!source.includes(marker)) {
  throw new Error(`Could not find iOS signing settings marker in ${projectSpec}`);
}

writeFileSync(projectSpec, source.replace(marker, signingSettings));
execFileSync("xcodegen", ["generate", "--spec", projectSpec], {
  cwd: projectDirectory,
  stdio: "inherit",
});
