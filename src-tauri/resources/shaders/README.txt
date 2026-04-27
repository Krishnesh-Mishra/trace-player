Trace Player ships any *.glsl files in this folder as bundled resources.
The Upscaling settings page expects these specific filenames:

  Medium profile:
    FSRCNNX_x2_8-0-4-1.glsl
    KrigBilateral.glsl

  High profile:
    FSRCNNX_x2_16-0-4-1.glsl
    KrigBilateral.glsl

These are external shader files (MIT-licensed, by igv) that I can't
redistribute directly through this repo. Drop them into this folder
before building the installer.

Where to get them:

  FSRCNNX (NN-based luma upscaler):
    https://github.com/igv/FSRCNN-TensorFlow/releases
    (Look for FSRCNNX_x2_8-0-4-1.glsl and FSRCNNX_x2_16-0-4-1.glsl
     in the release assets.)

  KrigBilateral (chroma upscaler):
    https://gist.github.com/igv/a015fc885d5c22e6891820ad89555637

After dropping the .glsl files in this folder:
  - Dev mode: just restart `npm run dev` — the perf module finds them
    via Tauri's resource_dir() at runtime.
  - Production: `npm run tauri build` will include them in the bundle
    automatically (the manifest `resources` glob picks up *.glsl).

If a file is missing, the Upscaling page silently falls back to "Low"
and emits a console line like:
  [NP …ms WARN upscaling] FSRCNNX_x2_8-0-4-1.glsl missing — falling back to Low
