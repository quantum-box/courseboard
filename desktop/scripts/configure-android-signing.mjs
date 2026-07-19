import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const buildFile = resolve(
	process.argv[2] ?? 'src-tauri/gen/android/app/build.gradle.kts',
)
const source = await readFile(buildFile, 'utf8')

if (source.includes('courseboard-upload-keystore')) {
	console.log(`Android signing is already configured in ${buildFile}`)
	process.exit(0)
}

const signingConfig = `    signingConfigs {
        create("release") {
            storeFile = file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            enableV1Signing = true
            enableV2Signing = true
        }
    } // courseboard-upload-keystore
`

let updated = source.replace('    buildTypes {', `${signingConfig}    buildTypes {`)
updated = updated.replace(
	'        getByName("release") {\n',
	'        getByName("release") {\n            signingConfig = signingConfigs.getByName("release")\n',
)

if (updated === source || !updated.includes('signingConfig = signingConfigs.getByName("release")')) {
	throw new Error(`Could not configure Android release signing in ${buildFile}`)
}

await writeFile(buildFile, updated)
console.log(`Configured Android release signing in ${buildFile}`)
