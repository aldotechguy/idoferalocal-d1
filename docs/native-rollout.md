# Native bridge controlled rollout
The native addon is **off by default**. Production logic continues to use the established TypeScript implementations unless `IDOFERA_NATIVE_ENABLED=true` is set. Every bridge retains a TypeScript fallback.

## Stage 0 — baseline
1. Deploy with `IDOFERA_NATIVE_ENABLED` unset (or `false`).
2. Optionally set `IDOFERA_NATIVE_TELEMETRY=true` to log structured `[native-bridge]` fallback events. Confirm service health and establish baseline latency/error rates.

## Stage 1 — canary
1. Build and package the platform-specific addon using `npm run build:native`.
2. Enable `IDOFERA_NATIVE_ENABLED=true` and `IDOFERA_NATIVE_TELEMETRY=true` for one canary instance or a small traffic slice only.
3. Observe native/fallback events, application errors, memory, and domain outputs. Fallback events can be collected through `setNativeBridgeTelemetry()` to your normal metrics pipeline. Avoid recording event reasons if they can contain sensitive data.
4. Run `npm run test:native-rollout` in the same build environment before rollout.

## Stage 2 — expand and rollback
Expand the enabled fraction only after parity and stability hold for the agreed observation window. Roll back immediately by unsetting `IDOFERA_NATIVE_ENABLED` (and restart/redeploy if environment values are startup-captured). The TypeScript implementations remain the fallback. Keep native telemetry on during the canary; disable it after the fallback rate and native error rate are understood.

## CI platform validation
`.github/workflows/native.yml` builds/tests on Ubuntu, macOS, and Windows. A local run cannot substitute for hosted runner results. Confirm all three matrix jobs are green in GitHub Actions before enabling the addon for production. The workflow must be pushed to the repository before hosted runners can execute it.
