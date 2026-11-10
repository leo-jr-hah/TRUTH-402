import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";

import "./demo-network-guard.mjs";

for (const args of [
  [{ host: "example.com", port: 443 }],
  [443, "example.com"],
  ["443", "example.com"],
  [[{ host: "203.0.113.10", port: 443 }]],
  [{ host: "::ffff:203.0.113.10", port: 443 }],
]) {
  const socket = new net.Socket();
  try {
    assert.throws(() => socket.connect(...args), /OFFLINE_GUARD/u);
  } finally {
    socket.destroy();
  }
}
const server = net.createServer((socket) => socket.end());
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
const socket = net.connect({ host: "127.0.0.1", port: address.port });
await once(socket, "connect");
socket.destroy();
await new Promise((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
);
console.log(
  "Offline TCP guard rejects object, numeric, string-port and normalized external connections; loopback allowed; listener closed.",
);
