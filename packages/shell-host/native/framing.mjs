import { MAX_NATIVE_MESSAGE_BYTES } from './contracts.mjs';

export const NATIVE_EOF = Symbol('NATIVE_EOF');

export function createNativeMessageChannel({
  input = process.stdin,
  output = process.stdout,
  logLine,
  onInvalidFrame = () => process.exit(1),
}) {
  let buffer = Buffer.alloc(0);
  let messageResolve = null;
  const messageQueue = [];
  let inputEnded = false;

  function settleEnd() {
    inputEnded = true;
    if (!messageResolve) return;
    const resolve = messageResolve;
    messageResolve = null;
    resolve(NATIVE_EOF);
  }

  function deliver(message) {
    if (!messageResolve) {
      messageQueue.push(message);
      return;
    }
    const resolve = messageResolve;
    messageResolve = null;
    resolve(message);
  }

  function drainBuffer() {
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length === 0 || length > MAX_NATIVE_MESSAGE_BYTES) {
        logLine(`Invalid message length: ${length} (max ${MAX_NATIVE_MESSAGE_BYTES}). The extension should chunk requests; see issue #297.`);
        buffer = Buffer.alloc(0);
        inputEnded = true;
        onInvalidFrame(length);
        return;
      }
      if (buffer.length < 4 + length) return;
      const json = buffer.subarray(4, 4 + length).toString('utf8');
      buffer = buffer.subarray(4 + length);
      try {
        deliver(JSON.parse(json));
      } catch (error) {
        logLine(`JSON parse error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  input.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    drainBuffer();
  });
  input.on('end', settleEnd);
  input.on('error', settleEnd);

  return {
    readMessage() {
      if (messageQueue.length > 0) return Promise.resolve(messageQueue.shift());
      if (inputEnded) return Promise.resolve(NATIVE_EOF);
      return new Promise(resolve => { messageResolve = resolve; });
    },
    writeMessage(message) {
      return new Promise(resolve => {
        const body = Buffer.from(JSON.stringify(message), 'utf8');
        if (body.length > Math.floor(MAX_NATIVE_MESSAGE_BYTES * 0.95)) {
          logLine(`writeNativeMessage WARNING body=${body.length} bytes approaches the ${MAX_NATIVE_MESSAGE_BYTES} native messaging cap; Chrome may truncate this response.`);
        }
        const header = Buffer.alloc(4);
        header.writeUInt32LE(body.length, 0);
        output.write(header);
        output.write(body, resolve);
      });
    },
  };
}
