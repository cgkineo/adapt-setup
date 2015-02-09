var _ = require("underscore");

var Waiter = function(total, callback) {
	this.total = total;
	this.callback = callback;
};

_.extend(Waiter.prototype, {
	doneCount: 0,
	totalCount: 0,
	done: function() {
		this.doneCount++;
		if (this.doneCount === this.total) this.callback();
	}
});

module.exports = Waiter;