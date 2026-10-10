// Narrow Bun runtime augmentation for CLI entrypoint guards.
// Do not make application code depend on Bun-only types where it runs in Next.js.
interface ImportMeta {
  main: boolean;
}
