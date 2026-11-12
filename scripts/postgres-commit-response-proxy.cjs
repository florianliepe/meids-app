const net = require("node:net");

function startPostgresCommitResponseProxy(target) {
  const state = {
    commitIntercepted: false,
    commitReadyObserved: false,
    connections: 0,
  };
  let interceptAvailable = true;
  const sockets = new Set();
  const server = net.createServer((client) => {
    state.connections += 1;
    sockets.add(client);
    const upstream = net.createConnection({ host: target.hostname, port: Number(target.port || 5432) });
    sockets.add(upstream);
    let dropCommitResponse = false;
    let serverBuffer = Buffer.alloc(0);
    let clientScan = Buffer.alloc(0);

    client.on("data", (chunk) => {
      clientScan = Buffer.concat([clientScan, chunk]).subarray(-128);
      if (interceptAvailable && clientScan.includes(Buffer.from("COMMIT\0"))) {
        interceptAvailable = false;
        dropCommitResponse = true;
        state.commitIntercepted = true;
      }
      upstream.write(chunk);
    });
    upstream.on("data", (chunk) => {
      if (!dropCommitResponse) {
        client.write(chunk);
        return;
      }
      serverBuffer = Buffer.concat([serverBuffer, chunk]);
      while (serverBuffer.length >= 5) {
        const length = serverBuffer.readUInt32BE(1);
        const frameLength = 1 + length;
        if (serverBuffer.length < frameLength) return;
        const type = String.fromCharCode(serverBuffer[0]);
        serverBuffer = serverBuffer.subarray(frameLength);
        if (type === "Z") {
          state.commitReadyObserved = true;
          client.destroy(new Error("Injected loss of PostgreSQL COMMIT response."));
          upstream.end();
          return;
        }
      }
    });
    const closeBoth = () => {
      if (!client.destroyed) client.destroy();
      if (!upstream.destroyed) upstream.destroy();
    };
    client.on("error", () => {});
    upstream.on("error", closeBoth);
    client.on("close", () => { sockets.delete(client); });
    upstream.on("close", () => { sockets.delete(upstream); });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: address.port,
        state,
        close: async () => {
          for (const socket of sockets) socket.destroy();
          await new Promise((done) => server.close(done));
        },
      });
    });
  });
}

module.exports = { startPostgresCommitResponseProxy };
