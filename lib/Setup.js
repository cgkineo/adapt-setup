import checkboxPlus from "inquirer-checkbox-plus-prompt";
import download from "download";
import makeDir from "make-dir";
import fs from "graceful-fs";
import endpoints from "../conf/endpoints.json" assert { type: "json" };
import { EOL } from "os";
import fetch from "node-fetch";
import inquirer from "inquirer";
import lang from "../conf/lang.json" assert { type: "json" };
import path from "path";
import { writeFile } from "fs/promises";

export default class Setup {

	plugins;

	prompts = {
		confirm: {
			...lang.prompts.confirm,
			name: "confirm",
			type: "list"
		},
		courseSource: {
			...lang.prompts.courseSource,
			name: "courseSource",
			type: "list"
		},
		plugins: {
			...lang.prompts.plugins,
			name: "plugins",
			searchable: true,
			source: this.getPluginChoices.bind(this),
			type: "checkbox-plus"
		}
	};

	async run() {
		let answer = await inquirer.prompt(this.prompts.confirm);

		if (!answer.confirm) return;

		const answerCourse = await inquirer.prompt(this.prompts.courseSource);

		await this.downloadFramework(answerCourse.courseSource);

		if (answerCourse.courseSource !== "frameworkcourse") {
			await this.downloadCourse();
		} else {
			await makeDir('builds/p101/course');
			fs.rename('src/course', 'builds/p101/course', (err) => {
				if (err) throw err
			});
		}

		this.plugins = await this.getPluginList();
		inquirer.registerPrompt("checkbox-plus", checkboxPlus);
		answer = await inquirer.prompt(this.prompts.plugins);
		await this.writeAdaptJson(answer.plugins);
		console.log(lang.finish);
	}

	downloadFramework(courseSource) {
		console.log(lang.download);

		const useFrameworkCourse = (courseSource === "frameworkcourse");
		const filter = !useFrameworkCourse ? file => !file.path.startsWith(path.normalize("src/course")) : '';

		return download(endpoints.framework, ".", {
			extract: true,
			filter,
			strip: 1
		});
	}

	downloadCourse() {
		return download(endpoints.course, "builds/p101", { extract: true, strip: 1 });
	}

	async getPluginList() {
		const response = await fetch(endpoints.registry);
	
		return response.json();
	}

	async getPluginChoices(answers, input) {
		const getPluginsByUser = user => {
			const list = this.plugins.filter(({ url, name }) => {
				return url.split("/")[3] === user &&
					name.toLowerCase().includes(input.toLowerCase());
			});

			return list.length ? [ this.getSeparator(user), ...list.reverse() ] : list;
		};

		const getThirdPartyPlugins = () => {
			const list = this.plugins.filter(plugin => {
				const user = plugin.user = plugin.url.split("/")[3];
	
				return user !== "adaptlearning" && user !== "cgkineo" &&
					plugin.name.toLowerCase().includes(input.toLowerCase());
			});

			if (!list.length) return list;

			return [ this.getSeparator(lang.other), ...list.map(({ name, user }) => {
				return { value: name, name: `${name} (${user})` };
			}).reverse() ];
		};

		return [
			...getPluginsByUser("adaptlearning"),
			...getPluginsByUser("cgkineo"),
			...getThirdPartyPlugins()
		];
	}

	getSeparator(label) {
		return new inquirer.Separator(`--- ${label} ---`);
	}

	writeAdaptJson(selection) {
		let output = { dependencies: {} };

		selection.forEach(plugin => output.dependencies[plugin] = "*");

		return writeFile("adapt.json", JSON.stringify(output, null, 4) + EOL, "utf8");
	}

}
