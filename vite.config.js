import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pinned so this app never lands on 5173, which another project on this
  // machine already holds. Without it Vite silently picks the next free
  // port and it's easy to end up looking at the wrong app.
  server: { port: 5180 },
  preview: { port: 5181 },
});
