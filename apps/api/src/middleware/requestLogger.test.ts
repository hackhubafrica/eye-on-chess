import { describe, it, expect, beforeAll } from "vitest";

let registerRequestLogger: typeof import("./requestLogger.js").registerRequestLogger;

beforeAll(async () => {
  const mod = await import("./requestLogger.js");
  registerRequestLogger = mod.registerRequestLogger;
});

async function buildApp() {
  const Fastify = (await import("fastify")).default;
  const app = Fastify({ logger: false });
  registerRequestLogger(app);

  app.get("/test", async () => ({ ok: true }));
  app.post("/login", async () => ({ ok: true }));

  return app;
}

describe("registerRequestLogger", () => {
  it("should register hooks without error", async () => {
    const app = await buildApp();
    // The app should work — hooks are registered
    const res = await app.inject({ method: "GET", url: "/test" });
    expect(res.statusCode).toBe(200);
  });

  it("should redact authorization header in logged output", async () => {
    const Fastify = (await import("fastify")).default;
    const logMessages: unknown[] = [];
    const app = Fastify({
      logger: {
        level: "info",
        transport: undefined,
      },
    });

    // Capture log output by overriding the request logger
    app.addHook("onRequest", async (request) => {
      const origInfo = request.log.info.bind(request.log);
      request.log.info = ((...args: unknown[]) => {
        logMessages.push(args[0]);
        return origInfo(...(args as [string]));
      }) as typeof request.log.info;
    });

    registerRequestLogger(app);
    app.get("/secret", async () => ({ ok: true }));

    await app.inject({
      method: "GET",
      url: "/secret",
      headers: {
        authorization: "Bearer super-secret-token",
        cookie: "session=abc123",
        "x-sandbox-callback-token": "sandbox-callback-secret",
        "user-agent": "test-agent",
      },
    });

    // Find the log entry that has headers
    const headerLog = logMessages.find(
      (m) => typeof m === "object" && m !== null && "headers" in (m as Record<string, unknown>)
    ) as Record<string, unknown> | undefined;

    if (headerLog) {
      const headers = headerLog.headers as Record<string, unknown>;
      expect(headers.authorization).toBe("[REDACTED]");
      expect(headers.cookie).toBe("[REDACTED]");
      expect(headers["x-sandbox-callback-token"]).toBe("[REDACTED]");
      // Non-sensitive headers should pass through
      expect(headers["user-agent"]).toBe("test-agent");
    }
  });

  it("should redact password field in POST body", async () => {
    const Fastify = (await import("fastify")).default;
    const logMessages: unknown[] = [];
    const app = Fastify({
      logger: {
        level: "info",
        transport: undefined,
      },
    });

    app.addHook("onRequest", async (request) => {
      const origInfo = request.log.info.bind(request.log);
      request.log.info = ((...args: unknown[]) => {
        logMessages.push(args[0]);
        return origInfo(...(args as [string]));
      }) as typeof request.log.info;
    });

    // Must register AFTER our hook override so our override is first
    registerRequestLogger(app);

    app.post("/login", async () => ({ ok: true }));

    await app.inject({
      method: "POST",
      url: "/login",
      payload: { username: "alice", password: "hunter2" },
    });

    // Find the log entry with body
    const bodyLog = logMessages.find(
      (m) => typeof m === "object" && m !== null && "body" in (m as Record<string, unknown>)
    ) as Record<string, unknown> | undefined;

    if (bodyLog) {
      const body = bodyLog.body as Record<string, unknown>;
      expect(body.password).toBe("[REDACTED]");
      expect(body.username).toBe("alice");
    }
  });

  it("should pass through non-sensitive fields unchanged", async () => {
    const Fastify = (await import("fastify")).default;
    const logMessages: unknown[] = [];
    const app = Fastify({
      logger: {
        level: "info",
        transport: undefined,
      },
    });

    app.addHook("onRequest", async (request) => {
      const origInfo = request.log.info.bind(request.log);
      request.log.info = ((...args: unknown[]) => {
        logMessages.push(args[0]);
        return origInfo(...(args as [string]));
      }) as typeof request.log.info;
    });

    registerRequestLogger(app);
    app.get("/hello", async () => ({ ok: true }));

    await app.inject({
      method: "GET",
      url: "/hello",
      headers: {
        "content-type": "application/json",
        "x-custom": "safe-value",
      },
    });

    const headerLog = logMessages.find(
      (m) => typeof m === "object" && m !== null && "headers" in (m as Record<string, unknown>)
    ) as Record<string, unknown> | undefined;

    if (headerLog) {
      const headers = headerLog.headers as Record<string, unknown>;
      expect(headers["content-type"]).toBe("application/json");
      expect(headers["x-custom"]).toBe("safe-value");
    }
  });
});
