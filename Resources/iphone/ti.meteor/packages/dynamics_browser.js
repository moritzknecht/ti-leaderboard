var nextSlot = 0;

var currentValues = [];

Meteor.EnvironmentVariable = function() {
    this.slot = nextSlot++;
};

_.extend(Meteor.EnvironmentVariable.prototype, {
    get: function() {
        return currentValues[this.slot];
    },
    getOrNullIfOutsideFiber: function() {
        return this.get();
    },
    withValue: function(value, func) {
        var saved = currentValues[this.slot];
        try {
            currentValues[this.slot] = value;
            var ret = func();
        } finally {
            currentValues[this.slot] = saved;
        }
        return ret;
    }
});

Meteor.bindEnvironment = function(func, onException, _this) {
    var boundValues = _.clone(currentValues);
    if (!onException || "string" == typeof onException) {
        var description = onException || "callback of async function";
        onException = function(error) {
            Meteor._debug("Exception in " + description + ":", error && error.stack || error);
        };
    }
    return function() {
        var savedValues = currentValues;
        try {
            currentValues = boundValues;
            var ret = func.apply(_this, _.toArray(arguments));
        } catch (e) {
            onException(e);
        } finally {
            currentValues = savedValues;
        }
        return ret;
    };
};

Meteor._nodeCodeMustBeInFiber = function() {};