const config = require("./config.json");
const download = require("download");
const fetch = require("node-fetch");
const fs = require("fs");
const inquirer = require("inquirer");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const writeFile = promisify(fs.writeFile);

const questions = [
	{
		message: "The framework will be downloaded to your current directory. Do you wish to continue?",
		name: "confirm",
		choices: [ "Yes", "No" ],
		type: "list"
	},
	{
		message: "Press <space> to select plugins or type to search",
		name: "plugins",
		searchable: true,
		source: getPluginChoices,
		type: "checkbox-plus"
	}
];

let plugins;

run().catch(err => console.log(err));

async function run() {
	let answer = await inquirer.prompt(questions[0]);

	if (answer.confirm === "No") return;

	inquirer.registerPrompt("checkbox-plus", require("inquirer-checkbox-plus-prompt"));
	await downloadFramework();
	await downloadCourse();
	plugins = await getPluginList();
	answer = await inquirer.prompt(questions[1]);
	await writeAdaptJson(answer.plugins);
	console.log("Run 'adapt install' to continue installation");
}

function downloadFramework() {
	console.log("Downloading...");

	return download(config.framework, ".", {
		extract: true,
		filter: file => !file.path.startsWith(path.normalize("src/course")),
		strip: 1
	});
}

function downloadCourse() {
	return download(config.course, "builds/p101", { extract: true, strip: 1 });
}

async function getPluginList() {
	const response = await fetch(config.registry);

	return response.json();
}

async function getPluginChoices(answers, input) {
	const getPluginsByUser = user => {
		let list = plugins.filter(plugin => {
			return plugin.url.split("/")[3] === user &&
				plugin.name.toLowerCase().includes(input.toLowerCase());
		});

		return list.length ? [].concat(getSeparator(user), list.reverse()) : list;
	};

	const getThirdPartyPlugins = () => {
		let list = plugins.filter(plugin => {
			const user = plugin.user = plugin.url.split("/")[3];

			return user !== "adaptlearning" && user !== "cgkineo" &&
				plugin.name.toLowerCase().includes(input.toLowerCase());
		});

		if (!list.length) return list;

		return [].concat(getSeparator("other"), list.map(plugin => ({
			value: plugin.name,
			name: `${plugin.name} (${plugin.user})`
		})).reverse());
	};

	return [].concat(
		getPluginsByUser("adaptlearning"),
		getPluginsByUser("cgkineo"),
		getThirdPartyPlugins()
	);
}

function getSeparator(label) {
	return new inquirer.Separator(`--- ${label} ---`);
}

function writeAdaptJson(selection) {
	let output = { dependencies: {} };

	selection.forEach(plugin => output.dependencies[plugin] = "*");
	writeFile("adapt.json", JSON.stringify(output, null, 4) + os.EOL, "utf8");
}
