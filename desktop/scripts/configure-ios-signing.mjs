import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
const signingMarker = "        ENABLE_BITCODE: false\n";
const encryptionMarker = "        LSRequiresIPhoneOS: true\n";
const signingSettings = [
  signingMarker.trimEnd(),
  "        CODE_SIGN_STYLE: Manual",
  '        CODE_SIGN_IDENTITY: "Apple Distribution"',
  `        DEVELOPMENT_TEAM: ${teamId}`,
  `        PROVISIONING_PROFILE_SPECIFIER: "${profileName}"`,
  "",
].join("\n");

const source = readFileSync(projectSpec, "utf8");
if (!source.includes(signingMarker)) {
  throw new Error(`Could not find iOS signing settings marker in ${projectSpec}`);
}
if (!source.includes(encryptionMarker)) {
  throw new Error(`Could not find iOS encryption marker in ${projectSpec}`);
}

let configuredSource = source;
if (!configuredSource.includes("        CODE_SIGN_STYLE: Manual\n")) {
  configuredSource = configuredSource.replace(signingMarker, signingSettings);
}
if (!configuredSource.includes("        ITSAppUsesNonExemptEncryption: false\n")) {
  configuredSource = configuredSource.replace(
    encryptionMarker,
    `${encryptionMarker}        ITSAppUsesNonExemptEncryption: false\n`,
  );
}
writeFileSync(projectSpec, configuredSource);

const iosIconDirectory = resolve("src-tauri/icons/ios");
const generatedIconDirectory = resolve(
  projectDirectory,
  "Assets.xcassets/AppIcon.appiconset",
);
for (const icon of readdirSync(iosIconDirectory).filter((file) =>
  file.endsWith(".png"),
)) {
  copyFileSync(
    resolve(iosIconDirectory, icon),
    resolve(generatedIconDirectory, icon),
  );
}

execFileSync("xcodegen", ["generate", "--spec", projectSpec], {
  cwd: projectDirectory,
  stdio: "inherit",
});

const exportOptions = resolve(projectDirectory, "ExportOptions.plist");
const plistBuddy = "/usr/libexec/PlistBuddy";
for (const key of [
  "teamID",
  "signingStyle",
  "signingCertificate",
  "provisioningProfiles",
]) {
  try {
    execFileSync(plistBuddy, ["-c", `Delete :${key}`, exportOptions], {
      stdio: "ignore",
    });
  } catch {
    // A freshly generated export options plist does not contain these keys yet.
  }
}

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
