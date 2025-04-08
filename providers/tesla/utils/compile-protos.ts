// Compile https://github.com/teslamotors/fleet-telemetry protobufs to TypeScript

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

(async () => {
  const REPO_URL = "https://github.com/teslamotors/fleet-telemetry.git";
  const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-telemetry-"));

  try {
    console.log("Cloning repository...");
    execSync(`git clone ${REPO_URL} ${TEMP_DIR}`, { stdio: "inherit" });

    const PROTO_DIR = path.join(TEMP_DIR, "protos");
    if (!fs.existsSync(PROTO_DIR)) {
      throw new Error(`Protobuf directory not found: ${PROTO_DIR}`);
    }

    console.log("Compiling proto files...");
    if (!fs.existsSync("../telemetry-protos")) {
      fs.mkdirSync("../telemetry-protos");
    }
    
    execSync(
      `npx @douglasgomes98/protoc -I=${PROTO_DIR} --es_out=../telemetry-protos --es_opt=target=ts ${path.join(
        PROTO_DIR,
        "*.proto"
      )}`,
      {
        stdio: "inherit",
      }
    );

    console.log("Done! Protobuf files compiled.");
  } catch (error) {
    console.error("Error during the process:", error);
  }

  console.log("Cleaning up...");
  fs.rmdirSync(TEMP_DIR, { recursive: true });
})();
