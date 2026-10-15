import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { hashPassword } from "./auth.ts";

// Prints the ADMIN_PASSWORD_HASH line for server/.env. The password is read without echo and never stored.
process.stderr.write("Admin password (12+ characters): ");
const muted = new Writable({ write: (_chunk, _enc, done) => done() });
const rl = createInterface({ input: process.stdin, output: muted, terminal: Boolean(process.stdin.isTTY) });
rl.once("line", (password) => {
  rl.close();
  process.stderr.write("\n");
  if (password.length < 12) {
    console.error("Use at least 12 characters.");
    process.exit(1);
  }
  console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
});
