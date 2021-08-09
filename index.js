import Setup from "./lib/Setup.js";

const setup = new Setup();

setup.run().catch(err => {
	console.log(err);
	process.kill(process.pid, "SIGTERM");
});
