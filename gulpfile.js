var _ = require("underscore");
var del = require("del");
var fs = require("fs");
var gulp = require("gulp");
var download = require("gulp-download");
var npm = require("npm");
var path = require("path");
var inquirer = require("inquirer");
var Q = require("q");
var tap = require("gulp-tap");
var unzip = require("gulp-unzip");
var Waiter = require("./Waiter");

var config = require("./config.json");
var registry = {};
var questionsMap = _.indexBy(config.questions, "name");

gulp.task("create", function() {
	getFramework()
		.then(getRegistry)
		.then(function() { return getPlugins("courses"); })
		.then(function() { return getDefaults("courses"); })
		.then(function() { return getPlugins("menus"); })
		.then(function() { return getPlugins("themes"); })
		.then(function() { return getPlugins("components"); })
		.then(function() { return getPlugins("extensions"); })
		.then(npmInstall)
		.done();
});

gulp.task("install", function() {
	getRegistry()
		.then(function() { return getPlugins("courses"); })
		.then(function() { return getDefaults("courses"); })
		.then(function() { return getPlugins("menus"); })
		.then(function() { return getPlugins("themes"); })
		.then(function() { return getPlugins("components"); })
		.then(function() { return getPlugins("extensions"); })
		.done();
});

gulp.task("list", function() {
	return console.log(_.pluck(getInstalledPlugins(), "name").join("\n"));
});

gulp.task("uninstall", function() {
	return uninstallPlugins();
});

function getFramework() {
	var deferred = Q.defer();

	install(config.framework, config.dest, deferred.resolve);
	return deferred.promise;
}

function getRegistry() {
	var deferred = Q.defer();

	download(getURL(config.registry))
		.pipe(unzip())
		.pipe(tap(function(file) {
			if (path.extname(file.path) === ".json") {
				var pluginType = path.basename(file.path, ".json");

				registry[pluginType] = JSON.parse(file.contents);
				registry[pluginType + "Map"] = _.indexBy(registry[pluginType], "name");
				for (var i = 0, j = registry[pluginType].length; i < j; i++) {
					questionsMap[pluginType].choices.push({
						name: registry[pluginType][i].name
					});
				}
			}
		}))
		.on("end", deferred.resolve);
	return deferred.promise;
}

function getPlugins(pluginType) {
	var deferred = Q.defer();

	disableChoices(pluginType);
	questionsMap[pluginType].validate = function(answer) {
		if (answer.length < 1) _.defer(deferred.resolve);
		return true;
	};
	inquirer.prompt(questionsMap[pluginType], function(answer) {
		if (!answer[pluginType]) {
			deferred.resolve();
			return deferred.promise;
		}
		var answerCount = answer[pluginType].length;
		var waiter = new Waiter(answerCount, deferred.resolve);

		for (var i = 0; i < answerCount; i++) {
			var choice = registry[pluginType + "Map"][answer[pluginType][i]];
			var dest = path.join(config.dest, config.pluginDirs[pluginType], choice.name);

			install(choice, dest, waiter.done, waiter);
		}
	});
	return deferred.promise;
}

function disableChoices(pluginType) {
	var installedPlugins = _.pluck(_.where(getInstalledPlugins(), { type: pluginType }), "name");
	// var availablePlugins = _.pluck(questionsMap[pluginType].choices, "name");
	// var choicesToDisable = _.intersection(installedPlugins, availablePlugins);
	// var choicesMap = _.indexBy(questionsMap[pluginType].choices, "name");

	// for (var i = 0, j = choicesToDisable.length; i < j; i++) {
	// 	choicesMap[choicesToDisable[i]].disabled = "already installed";
	// }

	// remove choices instead of disabling due to checkbox selection bug in inquirer 0.8.0
	questionsMap[pluginType].choices = _.reject(questionsMap[pluginType].choices, function(i) {
		return _.contains(installedPlugins, i.name);
	});
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
	var installedPluginsMap = _.indexBy(installedPlugins, "name");

	questionsMap.uninstall.choices = _.pluck(installedPlugins, "name");
	inquirer.prompt(questionsMap.uninstall, function(answer) {
		if (!answer.uninstall) return deferred.resolve();
		var answerCount = answer.uninstall.length;
		var waiter = new Waiter(answerCount, deferred.resolve);

		for (var i = 0; i < answerCount; i++) {
			var choice = answer.uninstall[i];
			var pluginDir = config.pluginDirs[installedPluginsMap[choice].type];
			var pluginPath = path.join(config.dest, pluginDir, choice);

			uninstall(choice, pluginPath, waiter.done, waiter);
		}
	});
	return deferred.promise;
}

function npmInstall() {
	var deferred = Q.defer();

	deferred.resolve();
	cwd = process.cwd();
	process.chdir(config.dest);
	npm.load(function(err) {
		if (err) return deferred.reject(err);
		npm.commands.install(function() {
			if (err) return deferred.reject(err);
			process.chdir(cwd);
			deferred.resolve();
		});
	});
	return deferred.promise;
}

function install(choice, dest, callback, that) {
	download(getURL(choice))
		.pipe(unzip())
		.pipe(tap(function(file) {
			file.path = file.path.substring(file.path.indexOf("/") + 1);
		}))
		.pipe(gulp.dest(dest))
		.on("end", _.bind(callback, that));
}

function uninstall(choice, path, callback, that) {
	del(path, function(err) {
		if (!err) console.log(choice + " uninstalled.");
		_.bind(callback, that);
	});
}

function getURL(choice) {
	return "https://github.com/" + choice.repo + "/" + choice.name + "/archive/" + choice.branch + ".zip";
}

module.exports = {
	create: function() { gulp.start("create"); },
	install: function() { gulp.start("install"); },
	list: function() { gulp.start("list"); },
	uninstall: function() { gulp.start("uninstall"); }
};