import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const teamId = process.env.APPLE_DEVELOPMENT_TEAM;
const profileName = process.env.APPLE_PROVISIONING_PROFILE_SPECIFIER;
const bundleId = process.env.APPLE_BUNDLE_ID;

if (!teamId || !profileName || !bundleId) {
  throw new Error(
    "APPLE_DEVELOPMENT_TEAM, APPLE_PROVISIONING_PROFILE_SPECIFIER, and APPLE_BUNDLE_ID are required",
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

const exportOptions = resolve(projectDirectory, "ExportOptions.plist");
const plistBuddy = "/usr/libexec/PlistBuddy";
const plistCommands = [
  "Set :method app-store-connect",
  `Add :teamID string ${teamId}`,
  "Add :signingStyle string manual",
  'Add :signingCertificate string "Apple Distribution"',
  "Add :provisioningProfiles dict",
  `Add :provisioningProfiles:${bundleId} string "${profileName}"`,
];

for (const command of plistCommands) {
  execFileSync(plistBuddy, ["-c", command, exportOptions], { stdio: "inherit" });
}
