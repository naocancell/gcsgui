import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons'
import path from 'path'
import legacy from '@vitejs/plugin-legacy'

// https://vitejs.dev/config/
const host = process.env.TAURI_DEV_HOST
const port = process.env.PORT ? parseInt(process.env.PORT) : 5173

export default defineConfig({
  clearScreen: false,
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11'],
    }),
    vue(),
    createSvgIconsPlugin({
      // Specify the icon folder to be cached
      iconDirs: [path.resolve(process.cwd(), 'src/assets/icons')],
      // Specify symbolId format
      symbolId: 'icon-[dir]-[name]',
    }),
  ],
  base: './',
  build: {
    target: ['es2015', 'chrome63'],
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('cesium')) {
              return 'vendor-cesium'
            }
            if (id.includes('naive-ui')) {
              return 'vendor-naive'
            }
            if (id.includes('echarts')) {
              return 'vendor-echarts'
            }
            return 'vendor-libs'
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve('./src'), // 相对路径别名配置，使用 @ 代替 src
    },
  },
  server: {
    watch: {
      ignored: ['**/target/**'],
    },
    port: port,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: port + 1,
        }
      : undefined,
    proxy: {
      '/onlinetest': {
        target: 'http://123.57.54.1:10323/',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/onlinetest/, ''),
      },
    },
    cors: true,
  },
  assetsInclude: ['**/*.gltf', '**/*.glb'],
  envPrefix: ['VITE_', 'TAURI_'],
})
