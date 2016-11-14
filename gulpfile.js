var _ = require("underscore");
var buffer = require("vinyl-buffer");
var decompress = require("gulp-decompress");
var del = require("del");
var fs = require("fs");
var gulp = require("gulp");
var gutil = require("gulp-util");
var inquirer = require("inquirer");
var path = require("path");
var Q = require("q");
var request = require("request");
var source = require("vinyl-source-stream");
var tap = require("gulp-tap");
var Waiter = require("./Waiter");

var config = require("./config.json");
var questionsMap = _.indexBy(config.questions, "name");
var registry = [];
var registryMap = {};
var installedPlugins = [];
var installedPluginsMap = {};

gulp.task("create", function() {
	return getRegistry()
		.then(getFramework)
		.then(function() { return getPlugins("courses"); })
		.then(function() { return getDefaults("courses"); })
		.then(function() { return getPlugins("menus"); })
		.then(function() { return getPlugins("themes"); })
		.then(function() { return getPlugins("components"); })
		.then(function() { return getPlugins("extensions"); })
		.then(finish);
});

gulp.task("install", function() {
	return getRegistry().then(getInstalledPlugins).then(getPlugins).then(finish);
});

gulp.task("list", function() {
	return getInstalledPlugins().then(list).then(finish);
});

gulp.task("uninstall", function() {
	return getInstalledPlugins().then(uninstallPlugins).then(finish);
});

gulp.task("update", function() {
	return getRegistry()
		.then(getInstalledPlugins)
		.then(updateFramework)
		.then(updatePlugins)
		.then(finish);
});

function getRegistry() {
	var deferred = Q.defer();

	request(getURL(config.registry))
		.pipe(source())
		.pipe(buffer())
		.pipe(decompress({
			filter: function(file) { return path.extname(file.path) === ".json"; }
		}))
		.pipe(tap(function(file) {
			var contents = JSON.parse(file.contents);
			var type = path.basename(file.path, ".json");

			if (type === "framework") {
				contents.type = type;

				return registry.push(contents);
			}

			for (var i = 0, j = contents.length; i < j; i++) {
				var plugin = contents[i];
				
				plugin.type = type;
				registry.push(plugin);
			}
		}))
		.on("end", function() {
			registryMap = _.indexBy(registry, "name");
			deferred.resolve();
		});

	return deferred.promise;
}

function getFramework() {
	var deferred = Q.defer();

	gutil.log("Installing framework...");
	downloadFramework(deferred.resolve);

	return deferred.promise;
}

function getPlugins(pluginType) {
	var deferred = Q.defer();

	if (!pluginType) pluginType = "plugins";

	var question = questionsMap[pluginType];

	question.choices = getInstallChoices(pluginType);

	if (!question.choices.length) {
		console.log("All " + pluginType + " in registry are installed.");
		deferred.resolve();

		return deferred.promise;
	}

	inquirer.prompt(question).then(function(answer) {
		var answerCount = answer[pluginType].length;

		if (!answerCount) {
			console.log(gutil.colors.cyan(" <none>"));

			return deferred.resolve();
		}

		var waiter = new Waiter(answerCount, deferred.resolve);

		gutil.log("Installing", pluginType + "...");

		for (var i = 0; i < answerCount; i++) {
			downloadPlugin(answer[pluginType][i], waiter.done, waiter);
		}
	});

	return deferred.promise;
}

function getDefaults(pluginType) {
	var deferred = Q.defer();
	var pluginPath = path.join(config.dest, config.pluginDirs[pluginType]);
	var plugins = fs.existsSync(pluginPath) ? fs.readdirSync(pluginPath) : "";

	for (var i = 0, j = plugins.length; i < j; i++) {
		var defaultJSON = path.join(pluginPath, plugins[i], "default.json");

		if (!fs.existsSync(defaultJSON)) continue;

		var defaults = JSON.parse(fs.readFileSync(defaultJSON));
		var types = _.keys(defaults);

		for (var k = 0, l = types.length; k < l; k++) {
			var type = types[k];
			var combinedDefaults = _.union(questionsMap[type].default, defaults[type]);

			questionsMap[type].default = combinedDefaults;
		}
	}

	deferred.resolve();

	return deferred.promise;
}

function getInstalledPlugins() {
	var deferred = Q.defer();
	var pluginDirs = config.pluginDirs;
	var pluginTypes = _.keys(pluginDirs);

	if (path.basename(process.cwd()) === config.dest) config.dest = ".";

	for (var i = 0, j = pluginTypes.length; i < j; i++) {
		var pluginType = pluginTypes[i];
		var pluginPath = path.join(config.dest, pluginDirs[pluginType]);
		var plugins = fs.existsSync(pluginPath) ? fs.readdirSync(pluginPath) : "";

		if (!plugins) continue;

		for (var k = 0, l = plugins.length; k < l; k++) {
			var plugin = plugins[k];
			var directory = path.join(pluginPath, plugin);

			if (!fs.statSync(directory).isDirectory()) continue;

			var bowerPath = path.join(directory, "bower.json");
			var bowerJSON = fs.existsSync(bowerPath) ?
				JSON.parse(fs.readFileSync(bowerPath)) :
				"";

			installedPlugins.push({
				name: plugin,
				version: bowerJSON.version,
				type: pluginType
			});
		}
	}

	installedPluginsMap = _.indexBy(installedPlugins, "name");
	deferred.resolve();

	return deferred.promise;
}

function list() {
	var list = [];
	var fw = getInstalledFramework();
	var fwInfo = fw ?
		gutil.colors.cyan(fw.name + "@" + fw.version + "\n───────────────") :
		"No framework installed.";

	console.log(fwInfo);

	for (var i = 0, j = installedPlugins.length; i < j; i++) {
		var plugin = installedPlugins[i];
		var item = plugin.name;
		var version = plugin.version;

		if (version) item += "@" + version;

		list.push(item);
	}

	list.sort();
	
	return console.log(gutil.colors.cyan(list.join("\n")) || "No plugins installed.");
}

function updateFramework() {
	var deferred = Q.defer();

	checkFrameworkVersion(function(isUpdateAvailable) {
		if (!isUpdateAvailable) {
			console.log("No framework update found.");
			deferred.resolve();

			return deferred.promise;
		}

		inquirer.prompt(questionsMap.framework).then(function(answer) {
			if (answer.framework !== "Yes") return deferred.resolve();

			var dest = config.dest;
			var pluginDirs = config.pluginDirs;
			var globs = [
				path.join(dest, "**"),
				"!" + dest,
				"!" + path.join(dest, "src"),
				"!" + path.join(dest, "buildkit"),
				"!" + path.join(dest, "buildkit", "**"),
				"!" + path.join(dest, "rub*"),
			];

			for (var i in pluginDirs) {
				if (!pluginDirs.hasOwnProperty(i)) continue;

				var pluginDir = path.join(dest, pluginDirs[i]);

				globs.push("!" + pluginDir, "!" + path.join(pluginDir, "**"));
			}

			gutil.log("Updating framework...");
			del(globs).then(function() { downloadFramework(deferred.resolve); });
		});
	});

	return deferred.promise;
}

function updatePlugins() {
	var deferred = Q.defer();
	var question = questionsMap.update;

	getUpdateChoices(function(choices) {
		question.choices = choices;

		if (!question.choices.length) {
			console.log("No plugin updates found.");

			return deferred.resolve();
		}

		inquirer.prompt(question).then(function(answer) {
			var answerCount = answer.update.length;

			if (!answerCount) {
				console.log(gutil.colors.cyan(" <none>"));

				return deferred.resolve();
			}

			var waiter = new Waiter(answerCount, deferred.resolve);

			gutil.log("Updating plugins...");

			for (var i = 0; i < answerCount; i++) {
				updatePlugin(answer.update[i], waiter.done, waiter);
			}
		});
	});

	return deferred.promise;
}

function uninstallPlugins() {
	var deferred = Q.defer();
	var question = questionsMap.uninstall;

	if (!installedPlugins.length) {
		console.log("No plugins installed.");
		deferred.resolve();

		return deferred.promise;
	}

	question.choices = _.pluck(installedPlugins, "name").sort();

	inquirer.prompt(question).then(function(answer) {
		var answerCount = answer.uninstall.length;

		if (!answerCount) {
			console.log(gutil.colors.cyan(" <none>"));

			return deferred.resolve();
		}

		var waiter = new Waiter(answerCount, deferred.resolve);

		gutil.log("Uninstalling plugins...");

		for (var i = 0; i < answerCount; i++) {
			deletePlugin(answer.uninstall[i], waiter.done, waiter);
		}
	});

	return deferred.promise;
}

function finish() {
	return gutil.log("Finished.");
}

function getURL(data) {
	return "https://github.com/" + data.repo + "/" + data.name + "/archive/" +
		data.branch + ".zip";
}

function getInstallChoices(pluginType) {
	var filter = function(i) {
		return pluginType === "plugins" ? i.type !== "framework" : i.type === pluginType;
	};
	var installedPluginsList = _.pluck(_.filter(installedPlugins, filter), "name");
	var registryPluginsList = _.pluck(_.filter(registry, filter), "name");

	return _.difference(registryPluginsList, installedPluginsList).sort();
}

function getInstalledFramework() {
	var packagePath = path.join(config.dest, "package.json");
	var packageJSON = fs.existsSync(packagePath) ?
		JSON.parse(fs.readFileSync(packagePath)) :
		"";

	if (packageJSON) return { name: packageJSON.name, version: packageJSON.version };
}

function checkFrameworkVersion(callback) {
	var installedFramework = getInstalledFramework();

	if (!installedFramework) return callback();

	var framework = _.findWhere(registry, { type: "framework" });
	var URL = "https://raw.githubusercontent.com/" + framework.repo + "/" +
		framework.name + "/" + framework.branch + "/package.json";

	request(URL, function(error, response, body) {
		var isUpdateAvailable = response.statusCode === 200 &&
			JSON.parse(body).version > getInstalledFramework().version;

		return callback(isUpdateAvailable);
	});
}

function getUpdateChoices(callback) {
	var installedPluginsLength = installedPlugins.length;
	var choices = [];

	if (!installedPluginsLength) return callback(choices);

	var waiter = new Waiter(installedPluginsLength, function() {
		callback(choices.sort());
	});
	var registryPlugins = _.pluck(registry, "name");
	var checkVersion = function(installedPlugin) {
		var plugin = registryMap[installedPlugin.name];
		var URL = "https://raw.githubusercontent.com/" + plugin.repo + "/" +
			plugin.name + "/" + plugin.branch + "/bower.json";

		request(URL, function(error, response, body) {
			if (response.statusCode !== 200 ||
				JSON.parse(body).version <= installedPlugin.version) {
				return waiter.done();
			}

			choices.push(installedPlugin.name);
			waiter.done();
		});
	};

	for (var i = 0; i < installedPluginsLength; i++) {
		var installedPlugin = installedPlugins[i];

		if (!_.contains(registryPlugins, installedPlugin.name)) waiter.done();
		else checkVersion(installedPlugin);
	}
}

function downloadFramework(callback) {
	var dest = config.dest;

	request(getURL(_.findWhere(registry, { type: "framework" })))
		.pipe(source())
		.pipe(buffer())
		.pipe(decompress({
			strip: 1,
			filter: function(file) {
				var courseDir = path.normalize("src/course");

				return file.path.substring(0, courseDir.length) !== courseDir;
			}
		}))
		.pipe(gulp.dest(dest))
		.on("end", callback);
}

function downloadPlugin(choice, callback, that) {
	var plugin = registryMap[choice];
	var dest = path.join(config.dest, config.pluginDirs[plugin.type], choice);

	request(getURL(plugin))
		.pipe(source())
		.pipe(buffer())
		.pipe(decompress({ strip: 1 }))
		.pipe(gulp.dest(dest))
		.on("end", _.bind(callback, that));
}

function deletePlugin(choice, callback, that) {
	var plugin = installedPluginsMap[choice];
	var pluginPath = path.join(config.dest, config.pluginDirs[plugin.type], choice);

	del(pluginPath).then(_.bind(callback, that));
}

function updatePlugin(choice, callback, that) {
	deletePlugin(choice, function() {
		downloadPlugin(choice, _.bind(callback, that), that);
	}, that);
}

module.exports = {
	create: function() { gulp.start("create"); },
	install: function() { gulp.start("install"); },
	list: function() { gulp.start("list"); },
	uninstall: function() { gulp.start("uninstall"); },
	update: function() { gulp.start("update"); }
};