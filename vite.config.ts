import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";

export default defineConfig({
  lint: { options: { typeAware: true, typeCheck: true } },
  plugins: [vanillaExtractPlugin(), react()],
});
