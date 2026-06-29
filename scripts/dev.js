import { spawn } from 'child_process'
import net from 'net'

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => {
      resolve(false)
    })
    server.once('listening', () => {
      server.close(() => {
        resolve(true)
      })
    })
    server.listen(port, '127.0.0.1')
  })
}

async function findAvailablePort(startPort) {
  let port = startPort
  while (!(await isPortAvailable(port))) {
    port++
  }
  return port
}

async function main() {
  const startPort = 5173
  const devPort = await findAvailablePort(startPort)
  console.log(`\x1b[36m[Tauri Dev Launcher] 探测到空闲端口: ${devPort}\x1b[0m`)

  let tauriConfig = JSON.stringify({
    build: {
      devUrl: `http://localhost:${devPort}`,
    },
  })

  if (process.platform === 'win32') {
    tauriConfig = `"${tauriConfig.replace(/"/g, '\\"')}"`
  }

  const child = spawn('npx', ['tauri', 'dev', '--config', tauriConfig], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      PORT: devPort.toString(),
    },
  })

  child.on('close', (code) => {
    process.exit(code || 0)
  })
}

main().catch((err) => {
  console.error('\x1b[31m[Tauri Dev Launcher] 启动失败:\x1b[0m', err)
  process.exit(1)
})
