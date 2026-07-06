// vite.config.ts
import { defineConfig } from "file:///C:/Users/ZXS/Desktop/GCSGUI-tauri%20(2)/gcsgui/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.41_sass@1.100.0_terser@5.48.0/node_modules/vite/dist/node/index.js";
import vue from "file:///C:/Users/ZXS/Desktop/GCSGUI-tauri%20(2)/gcsgui/node_modules/.pnpm/@vitejs+plugin-vue@5.2.4_vi_c2fa125854326b21b41e4c4fdb6d63ac/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import { createSvgIconsPlugin } from "file:///C:/Users/ZXS/Desktop/GCSGUI-tauri%20(2)/gcsgui/node_modules/.pnpm/vite-plugin-svg-icons@2.0.1_d49afac3d4b9ed5ed415a77bcdfd7819/node_modules/vite-plugin-svg-icons/dist/index.mjs";
import path from "path";
import legacy from "file:///C:/Users/ZXS/Desktop/GCSGUI-tauri%20(2)/gcsgui/node_modules/.pnpm/@vitejs+plugin-legacy@6.1.1_4b5c38c1f7299e8efddb5c1cf9cded88/node_modules/@vitejs/plugin-legacy/dist/index.mjs";
var host = process.env.TAURI_DEV_HOST;
var port = process.env.PORT ? parseInt(process.env.PORT) : 5173;
var vite_config_default = defineConfig({
  clearScreen: false,
  plugins: [
    legacy({
      targets: ["defaults", "not IE 11"]
    }),
    vue(),
    createSvgIconsPlugin({
      // Specify the icon folder to be cached
      iconDirs: [path.resolve(process.cwd(), "src/assets/icons")],
      // Specify symbolId format
      symbolId: "icon-[dir]-[name]"
    })
  ],
  base: "./",
  build: {
    target: ["es2015", "chrome63"],
    chunkSizeWarningLimit: 5e3,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("cesium")) {
              return "vendor-cesium";
            }
            if (id.includes("naive-ui")) {
              return "vendor-naive";
            }
            if (id.includes("echarts")) {
              return "vendor-echarts";
            }
            return "vendor-libs";
          }
        }
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve("./src")
      // 相对路径别名配置，使用 @ 代替 src
    }
  },
  server: {
    port,
    strictPort: true,
    host: host || false,
    hmr: host ? {
      protocol: "ws",
      host,
      port: port + 1
    } : void 0,
    proxy: {
      "/onlinetest": {
        target: "http://123.57.54.1:10323/",
        changeOrigin: true,
        rewrite: (path2) => path2.replace(/^\/onlinetest/, "")
      }
    },
    cors: true
  },
  assetsInclude: ["**/*.gltf", "**/*.glb"],
  envPrefix: ["VITE_", "TAURI_"]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxaWFNcXFxcRGVza3RvcFxcXFxHQ1NHVUktdGF1cmkgKDIpXFxcXGdjc2d1aVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiQzpcXFxcVXNlcnNcXFxcWlhTXFxcXERlc2t0b3BcXFxcR0NTR1VJLXRhdXJpICgyKVxcXFxnY3NndWlcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L1VzZXJzL1pYUy9EZXNrdG9wL0dDU0dVSS10YXVyaSUyMCgyKS9nY3NndWkvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xyXG5pbXBvcnQgdnVlIGZyb20gJ0B2aXRlanMvcGx1Z2luLXZ1ZSdcclxuaW1wb3J0IHsgY3JlYXRlU3ZnSWNvbnNQbHVnaW4gfSBmcm9tICd2aXRlLXBsdWdpbi1zdmctaWNvbnMnXHJcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnXHJcbmltcG9ydCBsZWdhY3kgZnJvbSAnQHZpdGVqcy9wbHVnaW4tbGVnYWN5J1xyXG5cclxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cclxuY29uc3QgaG9zdCA9IHByb2Nlc3MuZW52LlRBVVJJX0RFVl9IT1NUXHJcbmNvbnN0IHBvcnQgPSBwcm9jZXNzLmVudi5QT1JUID8gcGFyc2VJbnQocHJvY2Vzcy5lbnYuUE9SVCkgOiA1MTczXHJcblxyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xyXG4gIGNsZWFyU2NyZWVuOiBmYWxzZSxcclxuICBwbHVnaW5zOiBbXHJcbiAgICBsZWdhY3koe1xyXG4gICAgICB0YXJnZXRzOiBbJ2RlZmF1bHRzJywgJ25vdCBJRSAxMSddLFxyXG4gICAgfSksXHJcbiAgICB2dWUoKSxcclxuICAgIGNyZWF0ZVN2Z0ljb25zUGx1Z2luKHtcclxuICAgICAgLy8gU3BlY2lmeSB0aGUgaWNvbiBmb2xkZXIgdG8gYmUgY2FjaGVkXHJcbiAgICAgIGljb25EaXJzOiBbcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdzcmMvYXNzZXRzL2ljb25zJyldLFxyXG4gICAgICAvLyBTcGVjaWZ5IHN5bWJvbElkIGZvcm1hdFxyXG4gICAgICBzeW1ib2xJZDogJ2ljb24tW2Rpcl0tW25hbWVdJyxcclxuICAgIH0pLFxyXG4gIF0sXHJcbiAgYmFzZTogJy4vJyxcclxuICBidWlsZDoge1xyXG4gICAgdGFyZ2V0OiBbJ2VzMjAxNScsICdjaHJvbWU2MyddLFxyXG4gICAgY2h1bmtTaXplV2FybmluZ0xpbWl0OiA1MDAwLFxyXG4gICAgcm9sbHVwT3B0aW9uczoge1xyXG4gICAgICBvdXRwdXQ6IHtcclxuICAgICAgICBtYW51YWxDaHVua3MoaWQpIHtcclxuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbm9kZV9tb2R1bGVzJykpIHtcclxuICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdjZXNpdW0nKSkge1xyXG4gICAgICAgICAgICAgIHJldHVybiAndmVuZG9yLWNlc2l1bSdcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25haXZlLXVpJykpIHtcclxuICAgICAgICAgICAgICByZXR1cm4gJ3ZlbmRvci1uYWl2ZSdcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ2VjaGFydHMnKSkge1xyXG4gICAgICAgICAgICAgIHJldHVybiAndmVuZG9yLWVjaGFydHMnXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuICd2ZW5kb3ItbGlicydcclxuICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgfSxcclxuICB9LFxyXG4gIHJlc29sdmU6IHtcclxuICAgIGFsaWFzOiB7XHJcbiAgICAgICdAJzogcGF0aC5yZXNvbHZlKCcuL3NyYycpLCAvLyBcdTc2RjhcdTVCRjlcdThERUZcdTVGODRcdTUyMkJcdTU0MERcdTkxNERcdTdGNkVcdUZGMENcdTRGN0ZcdTc1MjggQCBcdTRFRTNcdTY2RkYgc3JjXHJcbiAgICB9LFxyXG4gIH0sXHJcbiAgc2VydmVyOiB7XHJcbiAgICBwb3J0OiBwb3J0LFxyXG4gICAgc3RyaWN0UG9ydDogdHJ1ZSxcclxuICAgIGhvc3Q6IGhvc3QgfHwgZmFsc2UsXHJcbiAgICBobXI6IGhvc3RcclxuICAgICAgPyB7XHJcbiAgICAgICAgICBwcm90b2NvbDogJ3dzJyxcclxuICAgICAgICAgIGhvc3QsXHJcbiAgICAgICAgICBwb3J0OiBwb3J0ICsgMSxcclxuICAgICAgICB9XHJcbiAgICAgIDogdW5kZWZpbmVkLFxyXG4gICAgcHJveHk6IHtcclxuICAgICAgJy9vbmxpbmV0ZXN0Jzoge1xyXG4gICAgICAgIHRhcmdldDogJ2h0dHA6Ly8xMjMuNTcuNTQuMToxMDMyMy8nLFxyXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICByZXdyaXRlOiAocGF0aCkgPT4gcGF0aC5yZXBsYWNlKC9eXFwvb25saW5ldGVzdC8sICcnKSxcclxuICAgICAgfSxcclxuICAgIH0sXHJcbiAgICBjb3JzOiB0cnVlLFxyXG4gIH0sXHJcbiAgYXNzZXRzSW5jbHVkZTogWycqKi8qLmdsdGYnLCAnKiovKi5nbGInXSxcclxuICBlbnZQcmVmaXg6IFsnVklURV8nLCAnVEFVUklfJ10sXHJcbn0pXHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBb1UsU0FBUyxvQkFBb0I7QUFDalcsT0FBTyxTQUFTO0FBQ2hCLFNBQVMsNEJBQTRCO0FBQ3JDLE9BQU8sVUFBVTtBQUNqQixPQUFPLFlBQVk7QUFHbkIsSUFBTSxPQUFPLFFBQVEsSUFBSTtBQUN6QixJQUFNLE9BQU8sUUFBUSxJQUFJLE9BQU8sU0FBUyxRQUFRLElBQUksSUFBSSxJQUFJO0FBRTdELElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLGFBQWE7QUFBQSxFQUNiLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLFNBQVMsQ0FBQyxZQUFZLFdBQVc7QUFBQSxJQUNuQyxDQUFDO0FBQUEsSUFDRCxJQUFJO0FBQUEsSUFDSixxQkFBcUI7QUFBQTtBQUFBLE1BRW5CLFVBQVUsQ0FBQyxLQUFLLFFBQVEsUUFBUSxJQUFJLEdBQUcsa0JBQWtCLENBQUM7QUFBQTtBQUFBLE1BRTFELFVBQVU7QUFBQSxJQUNaLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFDQSxNQUFNO0FBQUEsRUFDTixPQUFPO0FBQUEsSUFDTCxRQUFRLENBQUMsVUFBVSxVQUFVO0FBQUEsSUFDN0IsdUJBQXVCO0FBQUEsSUFDdkIsZUFBZTtBQUFBLE1BQ2IsUUFBUTtBQUFBLFFBQ04sYUFBYSxJQUFJO0FBQ2YsY0FBSSxHQUFHLFNBQVMsY0FBYyxHQUFHO0FBQy9CLGdCQUFJLEdBQUcsU0FBUyxRQUFRLEdBQUc7QUFDekIscUJBQU87QUFBQSxZQUNUO0FBQ0EsZ0JBQUksR0FBRyxTQUFTLFVBQVUsR0FBRztBQUMzQixxQkFBTztBQUFBLFlBQ1Q7QUFDQSxnQkFBSSxHQUFHLFNBQVMsU0FBUyxHQUFHO0FBQzFCLHFCQUFPO0FBQUEsWUFDVDtBQUNBLG1CQUFPO0FBQUEsVUFDVDtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLE9BQU87QUFBQTtBQUFBLElBQzNCO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ047QUFBQSxJQUNBLFlBQVk7QUFBQSxJQUNaLE1BQU0sUUFBUTtBQUFBLElBQ2QsS0FBSyxPQUNEO0FBQUEsTUFDRSxVQUFVO0FBQUEsTUFDVjtBQUFBLE1BQ0EsTUFBTSxPQUFPO0FBQUEsSUFDZixJQUNBO0FBQUEsSUFDSixPQUFPO0FBQUEsTUFDTCxlQUFlO0FBQUEsUUFDYixRQUFRO0FBQUEsUUFDUixjQUFjO0FBQUEsUUFDZCxTQUFTLENBQUNBLFVBQVNBLE1BQUssUUFBUSxpQkFBaUIsRUFBRTtBQUFBLE1BQ3JEO0FBQUEsSUFDRjtBQUFBLElBQ0EsTUFBTTtBQUFBLEVBQ1I7QUFBQSxFQUNBLGVBQWUsQ0FBQyxhQUFhLFVBQVU7QUFBQSxFQUN2QyxXQUFXLENBQUMsU0FBUyxRQUFRO0FBQy9CLENBQUM7IiwKICAibmFtZXMiOiBbInBhdGgiXQp9Cg==
