import fs from 'fs'
import fsp from 'fs/promises'
import { createRequire } from 'module'
import path from 'path'

import AdmZip from 'adm-zip'

const target = process.argv.slice(2)[0]
const ARCH_MAP = {
  'x86_64-pc-windows-msvc': 'x64',
  'aarch64-pc-windows-msvc': 'arm64',
}

const PROCESS_MAP = {
  x64: 'x64',
  arm64: 'arm64',
}
const arch = target ? ARCH_MAP[target] : PROCESS_MAP[process.arch]
/// Script for ci
/// 打包绿色版/便携版 (only Windows)
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

  // Tauri 默认 Cargo 包名为 app，输出为 app.exe；或者为应用的名称
  let exePath = path.join(releaseDir, `${name}.exe`)
  if (!fs.existsSync(exePath)) {
    exePath = path.join(releaseDir, 'app.exe')
  }

  if (fs.existsSync(exePath)) {
    // 将找到的可执行文件以项目名字 (如 gcsgui.exe) 添加进压缩包根目录
    zip.addLocalFile(exePath, '', `${name}.exe`)
    console.log(`[INFO]: Add executable ${path.basename(exePath)} as ${name}.exe`)
  } else {
    console.error(`[ERROR]: Could not find executable in ${releaseDir}`)
  }

  if (fs.existsSync(path.join(releaseDir, 'resources'))) {
    zip.addLocalFolder(path.join(releaseDir, 'resources'), 'resources')
  }
  zip.addLocalFolder(configDir, '.config')

  const zipFile = `GCSGUI_${version}_${arch}_portable.zip`
  zip.writeZip(zipFile)
  console.log('[INFO]: create portable zip successfully')
}

resolvePortable().catch(console.error)
