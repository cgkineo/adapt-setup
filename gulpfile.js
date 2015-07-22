var _ = require("underscore");
var buffer = require("vinyl-buffer");
var decompressUnzip = require("decompress-unzip");
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
var vinylAssign = require("vinyl-assign");
var Waiter = require("./Waiter");

var config = require("./config.json");
var questionsMap = _.indexBy(config.questions, "name");
var registry = {};

gulp.task("create", function() {
	return getRegistry()
		.then(getFramework)
		.then(function() { return getPlugins("courses"); })
		.then(function() { return getDefaults("courses"); })
		.then(function() { return getPlugins("menus"); })
		.then(function() { return getPlugins("themes"); })
		.then(function() { return getPlugins("components"); })
		.then(function() { return getPlugins("extensions"); })
		.then(function() { return gutil.log("Finished."); });
});

gulp.task("install", function() {
	return getRegistry()
		.then(function() { return getPlugins("courses"); })
		.then(function() { return getDefaults("courses"); })
		.then(function() { return getPlugins("menus"); })
		.then(function() { return getPlugins("themes"); })
		.then(function() { return getPlugins("components"); })
		.then(function() { return getPlugins("extensions"); })
		.then(function() { return gutil.log("Finished."); });
});

gulp.task("list", function() {
	var plugins = _.pluck(getInstalledPlugins(), "name").sort().join("\n");

	return console.log(gutil.colors.cyan(plugins) || "No plugins installed.");
});

gulp.task("uninstall", function() {
	return uninstallPlugins()
		.then(function() { return gutil.log("Finished."); });
});

function getRegistry() {
	var deferred = Q.defer();

	request(getURL(config.registry))
		.pipe(source())
		.pipe(buffer())
		.pipe(vinylAssign({ extract: true }))
		.pipe(decompressUnzip())
		.pipe(tap(function(file) {
			if (path.extname(file.path) !== ".json") return;

			var pluginType = path.basename(file.path, ".json");

			registry[pluginType] = JSON.parse(file.contents);
			registry[pluginType + "Map"] = _.indexBy(registry[pluginType], "name");

			for (var i = 0, j = registry[pluginType].length; i < j; i++) {
				questionsMap[pluginType].choices.push({ name: registry[pluginType][i].name });
			}
		}))
		.on("end", deferred.resolve);

	return deferred.promise;
}

function getFramework() {
	var deferred = Q.defer();

	gutil.log("Installing framework...");
	install(registry.framework, config.dest, deferred.resolve);

	return deferred.promise;
}

function getPlugins(pluginType) {
	var deferred = Q.defer();
	var question = filterChoices(pluginType);

	if (question.choices.length === 0) {
		console.log("All " + pluginType + " in registry are installed.");
		deferred.resolve();
		return deferred.promise;
	}

	inquirer.prompt(question, function(answer) {
		var answerCount = answer[pluginType].length;

		if (!answerCount) {
			console.log(gutil.colors.cyan(" <none>"));
			return deferred.resolve();
		}

		var waiter = new Waiter(answerCount, deferred.resolve);

		gutil.log("Installing", pluginType + "...");

		for (var i = 0; i < answerCount; i++) {
			var choice = registry[pluginType + "Map"][answer[pluginType][i]];
			var dest = path.join(config.dest, config.pluginDirs[pluginType], choice.name);

			install(choice, dest, waiter.done, waiter);
		}
	});

	return deferred.promise;
}

function getDefaults(pluginType) {
	var deferred = Q.defer();
	var pluginPath = path.join(config.dest, config.pluginDirs[pluginType]);
	var plugins = fs.existsSync(pluginPath) ? fs.readdirSync(pluginPath) : "";

	if (!plugins) {
		deferred.resolve();
		return deferred.promise;
	}

	for (var i = 0, j = plugins.length; i < j; i++) {
		var defaultJSON = path.join(pluginPath, plugins[i], "default.json");

		if (!fs.existsSync(defaultJSON)) continue;

		var defaults = JSON.parse(fs.readFileSync(defaultJSON));
		var types = _.keys(defaults);

		for (var k = 0, l = types.length; k < l; k++) {
			var type = types[k];

			questionsMap[type].default = _.union(questionsMap[type].default, defaults[type]);
		}
	}

	deferred.resolve();
	return deferred.promise;
}

function getInstalledPlugins() {
	var pluginDirs = config.pluginDirs;
	var pluginTypes = _.keys(pluginDirs);
	var installedPlugins = [];

	if (path.basename(process.cwd()) === config.dest) config.dest = ".";

	for (var i = 0, j = pluginTypes.length; i < j; i++) {
		var pluginPath = path.join(config.dest, pluginDirs[pluginTypes[i]]);
		var plugins = fs.existsSync(pluginPath) ? fs.readdirSync(pluginPath) : "";

		if (!plugins) continue;

		for (var k = 0, l = plugins.length; k < l; k++) {
			if (!fs.statSync(path.join(pluginPath, plugins[k])).isDirectory()) continue;

			installedPlugins.push({
				name: plugins[k],
				type: pluginTypes[i]
			});
		}
	}

	return installedPlugins;
}

function uninstallPlugins() {
	var deferred = Q.defer();
	var installedPlugins = getInstalledPlugins();
	var question = questionsMap.uninstall;

	if (installedPlugins.length === 0) {
		console.log("No plugins installed.");
		deferred.resolve();
		return deferred.promise;
	}

	question.choices = _.pluck(installedPlugins, "name").sort();
	inquirer.prompt(question, function(answer) {
		var answerCount = answer.uninstall.length;

		if (!answerCount) {
			console.log(gutil.colors.cyan(" <none>"));
			return deferred.resolve();
		}

		var installedPluginsMap = _.indexBy(installedPlugins, "name");
		var waiter = new Waiter(answerCount, deferred.resolve);
		
		gutil.log("Uninstalling plugins...");
		for (var i = 0; i < answerCount; i++) {
			var choice = answer.uninstall[i];
			var pluginDir = config.pluginDirs[installedPluginsMap[choice].type];

			del(path.join(config.dest, pluginDir, choice), _.bind(waiter.done, waiter));
		}
	});

	return deferred.promise;
}

function getURL(choice) {
	return "https://github.com/" + choice.repo + "/" + choice.name + "/archive/" +
		choice.branch + ".zip";
}

function filterChoices(pluginType) {
	var installedPlugins = _.pluck(_.where(getInstalledPlugins(), { type: pluginType }), "name");
	var question = questionsMap[pluginType];

	question.choices = _.reject(question.choices, function(i) {
		return _.contains(installedPlugins, i.name);
	});

	return question;
}

function install(choice, dest, callback, that) {
	request(getURL(choice))
		.pipe(source())
		.pipe(buffer())
		.pipe(vinylAssign({ extract: true }))
		.pipe(decompressUnzip({ strip: 1 }))
		.pipe(gulp.dest(dest))
		.on("end", _.bind(callback, that));
}

module.exports = {
	create: function() { gulp.start("create"); },
	install: function() { gulp.start("install"); },
	list: function() { gulp.start("list"); },
	uninstall: function() { gulp.start("uninstall"); }
};