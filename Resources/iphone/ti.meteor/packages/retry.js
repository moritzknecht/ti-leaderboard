Retry = function(options) {
    var self = this;
    _.extend(self, _.defaults(_.clone(options || {}), {
        baseTimeout: 1e3,
        exponent: 2.2,
        maxTimeout: 3e5,
        minTimeout: 10,
        minCount: 2,
        fuzz: .5
    }));
    self.retryTimer = null;
};

_.extend(Retry.prototype, {
    clear: function() {
        var self = this;
        self.retryTimer && clearTimeout(self.retryTimer);
        self.retryTimer = null;
    },
    _timeout: function(count) {
        var self = this;
        if (self.minCount > count) return self.minTimeout;
        var timeout = Math.min(self.maxTimeout, self.baseTimeout * Math.pow(self.exponent, count));
        timeout *= Random.fraction() * self.fuzz + (1 - self.fuzz / 2);
        return timeout;
    },
    retryLater: function(count, fn) {
        var self = this;
        var timeout = self._timeout(count);
        self.retryTimer && clearTimeout(self.retryTimer);
        self.retryTimer = Meteor.setTimeout(fn, timeout);
        return timeout;
    }
});

exports.Retry = Retry;