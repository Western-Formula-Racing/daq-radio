import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          // Use simple names for fonts (ESP32 compatible)
          if (assetInfo.name?.match(/\.(otf|ttf|woff|woff2)$/)) {
            const ext = assetInfo.name.split('.').pop();
            const name = assetInfo.name.replace(/\.(otf|ttf|woff|woff2)$/, '');
            // Shorten name to be ESP32 friendly (max ~30 chars recommended)
            const shortName = name.substring(0, 20);
            return `assets/${shortName}.${ext}`;
          }
          // Default behavior for other assets
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  }
});
