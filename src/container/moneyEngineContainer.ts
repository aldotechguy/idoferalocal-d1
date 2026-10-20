/**
 * Cloudflare Container binding for the Rust money engine.
 *
 * The Mall Worker runs on D1 and cannot load native addons; this Durable Object
 * proxies requests to the Rust binary (native/crates/money_engine_server) so
 * production money checks execute the Rust engine.
 *
 * Configured in wrangler.toml:
 *   [[env.mall.containers]] class_name = "MoneyEngineContainer" ...
 *   [[env.mall.durable_objects.bindings]] name = "MONEY_ENGINE_CONTAINER"
 * See docs/money-engine-service.md for build/push/rollback steps.
 */
import { Container } from '@cloudflare/containers';

export class MoneyEngineContainer extends Container {
  /** The Rust server binds PORT (8080 in the image). */
  defaultPort = 8080;
  /** One warm instance serves the Worker; idle instances sleep to save quota. */
  sleepAfter = '30m';
  /** The engine is fully self-contained and must not reach the internet. */
  enableInternet = false;
  /** Use the engine's own readiness route as the startup probe. */
  pingEndpoint = '/health';
}
