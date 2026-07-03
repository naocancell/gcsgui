import fs from 'fs'
import fsp from 'fs/promises'
import { createRequire } from 'module'
import path from 'path'

import AdmZip from 'adm-zip'

const target = process.argv.slice(2)[0]

const ARCH_MAP = {
  'x86_64-pc-windows-msvc': 'x64',
  'i686-pc-windows-msvc': 'x86',
  'aarch64-pc-windows-msvc': 'arm64',
}

const PROCESS_MAP = {
  x64: 'x64',
  ia32: 'x86',
  arm64: 'arm64',
}
const arch = target ? ARCH_MAP[target] : PROCESS_MAP[process.arch]
/// 纯本地打包绿色便携版（带固定版本 WebView2 运行时）
async function resolvePortable() {
  if (process.platform !== 'win32') return

  const releaseDir = target
    ? `./src-tauri/target/${target}/release`
    : `./src-tauri/target/release`

  const configDir = path.join(releaseDir, '.config')

  if (!fs.existsSync(releaseDir)) {
    throw new Error('could not found the release dir')
  }

  await fsp.mkdir(configDir, { recursive: true })
  if (!fs.existsSync(path.join(configDir, 'PORTABLE'))) {
    await fsp.writeFile(path.join(configDir, 'PORTABLE'), '')
  }

  const zip = new AdmZip()

  const require = createRequire(import.meta.url)
  const packageJson = require('../package.json')
  const { version, name } = packageJson

  let exePath = path.join(releaseDir, `${name}.exe`)
  if (!fs.existsSync(exePath)) {
    exePath = path.join(releaseDir, 'app.exe')
  }

  if (fs.existsSync(exePath)) {
    zip.addLocalFile(exePath, '', `${name}.exe`)
    console.log(`[INFO]: Add executable ${path.basename(exePath)} as ${name}.exe`)
  } else {
    console.error(`[ERROR]: Could not find executable in ${releaseDir}`)
  }

  if (fs.existsSync(path.join(releaseDir, 'resources'))) {
    zip.addLocalFolder(path.join(releaseDir, 'resources'), 'resources')
  }
  const webviewFolder = `Microsoft.WebView2.FixedVersionRuntime.133.0.3065.92.${arch}`
  if (fs.existsSync(path.join(releaseDir, webviewFolder))) {
    zip.addLocalFolder(path.join(releaseDir, webviewFolder), webviewFolder)
  }
  zip.addLocalFolder(configDir, '.config')

  const zipFile = `GCSGUI_${version}_${arch}_fixed_webview2_portable.zip`
  zip.writeZip(zipFile)

  console.log('[INFO]: create portable zip successfully')
}

resolvePortable().catch(console.error)
