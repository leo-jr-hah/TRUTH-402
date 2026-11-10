import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

// Preload for QA only. Deny outbound TCP even if an unexpected library bypasses
// fetch. Unix sockets and loopback remain available to Next.js workers/smoke.
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  const options = typeof first === "object" && first !== null ? first : null;
  const pipe =
    options?.path || (typeof first === "string" && !/^\d+$/u.test(first));
  if (!pipe) {
    const host =
      options?.host ??
      (typeof normalized[1] === "string" ? normalized[1] : "localhost");
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
      throw new Error(
        "OFFLINE_GUARD: external TCP connection blocked during demo verification.",
      );
    }
  }
  return connect.apply(this, args);
};
syncBuiltinESMExports();
