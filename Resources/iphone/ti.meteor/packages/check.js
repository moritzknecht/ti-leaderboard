var currentArgumentChecker = new Meteor.EnvironmentVariable();

check = function(value, pattern) {
    var argChecker = currentArgumentChecker.getOrNullIfOutsideFiber();
    argChecker && argChecker.checking(value);
    try {
        checkSubtree(value, pattern);
    } catch (err) {
        err instanceof Match.Error && err.path && (err.message += " in field " + err.path);
        throw err;
    }
};

Match = {
    Optional: function(pattern) {
        return new Optional(pattern);
    },
    OneOf: function() {
        return new OneOf(_.toArray(arguments));
    },
    Any: [ "__any__" ],
    Where: function(condition) {
        return new Where(condition);
    },
    ObjectIncluding: function(pattern) {
        return new ObjectIncluding(pattern);
    },
    Integer: [ "__integer__" ],
    Error: Meteor.makeErrorType("Match.Error", function(msg) {
        this.message = "Match error: " + msg;
        this.path = "";
        this.sanitizedError = new Meteor.Error(400, "Match failed");
    }),
    test: function(value, pattern) {
        try {
            checkSubtree(value, pattern);
            return true;
        } catch (e) {
            if (e instanceof Match.Error) return false;
            throw e;
        }
    },
    _failIfArgumentsAreNotAllChecked: function(f, context, args, description) {
        var argChecker = new ArgumentChecker(args, description);
        var result = currentArgumentChecker.withValue(argChecker, function() {
            return f.apply(context, args);
        });
        argChecker.throwUnlessAllArgumentsHaveBeenChecked();
        return result;
    }
};

var Optional = function(pattern) {
    this.pattern = pattern;
};

var OneOf = function(choices) {
    if (_.isEmpty(choices)) throw new Error("Must provide at least one choice to Match.OneOf");
    this.choices = choices;
};

var Where = function(condition) {
    this.condition = condition;
};

var ObjectIncluding = function(pattern) {
    this.pattern = pattern;
};

var typeofChecks = [ [ String, "string" ], [ Number, "number" ], [ Boolean, "boolean" ], [ void 0, "undefined" ] ];

var checkSubtree = function(value, pattern) {
    if (pattern === Match.Any) return;
    for (var i = 0; typeofChecks.length > i; ++i) if (pattern === typeofChecks[i][0]) {
        if (typeof value === typeofChecks[i][1]) return;
        throw new Match.Error("Expected " + typeofChecks[i][1] + ", got " + typeof value);
    }
    if (null === pattern) {
        if (null === value) return;
        throw new Match.Error("Expected null, got " + EJSON.stringify(value));
    }
    if (pattern === Match.Integer) {
        if ("number" == typeof value && (0 | value) === value) return;
        throw new Match.Error("Expected Integer, got " + (value instanceof Object ? EJSON.stringify(value) : value));
    }
    pattern === Object && (pattern = Match.ObjectIncluding({}));
    if (pattern instanceof Array) {
        if (1 !== pattern.length) throw Error("Bad pattern: arrays must have one type element" + EJSON.stringify(pattern));
        if (!_.isArray(value) && !_.isArguments(value)) throw new Match.Error("Expected array, got " + EJSON.stringify(value));
        _.each(value, function(valueElement, index) {
            try {
                checkSubtree(valueElement, pattern[0]);
            } catch (err) {
                err instanceof Match.Error && (err.path = _prependPath(index, err.path));
                throw err;
            }
        });
        return;
    }
    if (pattern instanceof Where) {
        if (pattern.condition(value)) return;
        throw new Match.Error("Failed Match.Where validation");
    }
    pattern instanceof Optional && (pattern = Match.OneOf(void 0, pattern.pattern));
    if (pattern instanceof OneOf) {
        for (var i = 0; pattern.choices.length > i; ++i) try {
            checkSubtree(value, pattern.choices[i]);
            return;
        } catch (err) {
            if (!(err instanceof Match.Error)) throw err;
        }
        throw new Match.Error("Failed Match.OneOf or Match.Optional validation");
    }
    if (pattern instanceof Function) {
        if (value instanceof pattern) return;
        throw new Match.Error("Expected " + pattern.name);
    }
    var unknownKeysAllowed = false;
    if (pattern instanceof ObjectIncluding) {
        unknownKeysAllowed = true;
        pattern = pattern.pattern;
    }
    if ("object" != typeof pattern) throw Error("Bad pattern: unknown pattern type");
    if ("object" != typeof value) throw new Match.Error("Expected object, got " + typeof value);
    if (null === value) throw new Match.Error("Expected object, got null");
    if (value.constructor !== Object) throw new Match.Error("Expected plain object");
    var requiredPatterns = {};
    var optionalPatterns = {};
    _.each(pattern, function(subPattern, key) {
        subPattern instanceof Optional ? optionalPatterns[key] = subPattern.pattern : requiredPatterns[key] = subPattern;
    });
    _.each(value, function(subValue, key) {
        try {
            if (_.has(requiredPatterns, key)) {
                checkSubtree(subValue, requiredPatterns[key]);
                delete requiredPatterns[key];
            } else if (_.has(optionalPatterns, key)) checkSubtree(subValue, optionalPatterns[key]); else if (!unknownKeysAllowed) throw new Match.Error("Unknown key");
        } catch (err) {
            err instanceof Match.Error && (err.path = _prependPath(key, err.path));
            throw err;
        }
    });
    _.each(requiredPatterns, function(subPattern, key) {
        throw new Match.Error("Missing key '" + key + "'");
    });
};

var ArgumentChecker = function(args, description) {
    var self = this;
    self.args = _.clone(args);
    self.args.reverse();
    self.description = description;
};

_.extend(ArgumentChecker.prototype, {
    checking: function(value) {
        var self = this;
        if (self._checkingOneValue(value)) return;
        (_.isArray(value) || _.isArguments(value)) && _.each(value, _.bind(self._checkingOneValue, self));
    },
    _checkingOneValue: function(value) {
        var self = this;
        for (var i = 0; self.args.length > i; ++i) if (value === self.args[i]) {
            self.args.splice(i, 1);
            return true;
        }
        return false;
    },
    throwUnlessAllArgumentsHaveBeenChecked: function() {
        var self = this;
        if (!_.isEmpty(self.args)) throw new Error("Did not check() all arguments during " + self.description);
    }
});

var _jsKeywords = [ "do", "if", "in", "for", "let", "new", "try", "var", "case", "else", "enum", "eval", "false", "null", "this", "true", "void", "with", "break", "catch", "class", "const", "super", "throw", "while", "yield", "delete", "export", "import", "public", "return", "static", "switch", "typeof", "default", "extends", "finally", "package", "private", "continue", "debugger", "function", "arguments", "interface", "protected", "implements", "instanceof" ];

var _prependPath = function(key, base) {
    "number" == typeof key || key.match(/^[0-9]+$/) ? key = "[" + key + "]" : (!key.match(/^[a-z_$][0-9a-z_$]*$/i) || _.contains(_jsKeywords, key)) && (key = JSON.stringify([ key ]));
    if (base && "[" !== base[0]) return key + "." + base;
    return key + base;
};

module.exports = {
    check: check,
    Match: Match
};