// Test-only preload: isolate the OS home without adding a production config override.
import os from "node:os";
if (!process.env.BAAH_TEST_HOME) throw new Error("BAAH_TEST_HOME is required by the test preload");
os.homedir = () => process.env.BAAH_TEST_HOME;
