import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";

export default defineConfig({
  lint: { options: { typeAware: true, typeCheck: true } },
  plugins: [vanillaExtractPlugin(), react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
