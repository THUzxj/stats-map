// ESM resolves beside this module. The classic-script build substitutes a URL
// beside that script, captured before document.currentScript becomes null.
export const dorlingWorkerUrl=new URL('./dorling-worker.js',import.meta.url);
