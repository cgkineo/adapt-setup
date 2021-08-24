import Setup from "./lib/Setup.js";

const setup = new Setup();

setup.run().catch(error => {
	console.error(error);
	process.kill(process.pid, "SIGTERM");
});
