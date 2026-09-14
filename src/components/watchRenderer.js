/**
 * Logs what a freeze report needs to be useful: which GPU the browser gave
 * us, and whether the WebGL context was lost. A lost context leaves the canvas
 * blank or stuck on its last frame while the page around it carries on, which
 * from the outside is indistinguishable from the scene hanging.
 */
export function watchRenderer(gl) {
  const canvas = gl.domElement;
  const context = gl.getContext();

  // Firefox reports the real renderer here and deprecates the extension;
  // Chrome only says "WebKit WebGL" unless asked through it.
  let renderer = context.getParameter(context.RENDERER);
  if (renderer === "WebKit WebGL") {
    const info = context.getExtension("WEBGL_debug_renderer_info");
    if (info) renderer = context.getParameter(info.UNMASKED_RENDERER_WEBGL);
  }
  console.info(`[scene] WebGL renderer: ${renderer}`);

  canvas.addEventListener("webglcontextlost", () => {
    console.error(
      "[scene] WebGL context lost — the GPU process crashed or reset. " +
        "Reload to get the scene back."
    );
  });
  canvas.addEventListener("webglcontextrestored", () => {
    console.warn("[scene] WebGL context restored");
  });
}
