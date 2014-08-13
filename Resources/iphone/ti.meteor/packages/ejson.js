EJSON = {};

var customTypes = {};

EJSON.addType = function(name, factory) {
    if (_.has(customTypes, name)) throw new Error("Type " + name + " already present");
    customTypes[name] = factory;
};

var isInfOrNan = function(obj) {
    return _.isNaN(obj) || 1/0 === obj || obj === -1/0;
};

var builtinConverters = [ {
    matchJSONValue: function(obj) {
        return _.has(obj, "$date") && 1 === _.size(obj);
    },
    matchObject: function(obj) {
        return obj instanceof Date;
    },
    toJSONValue: function(obj) {
        return {
            $date: obj.getTime()
        };
    },
    fromJSONValue: function(obj) {
        return new Date(obj.$date);
    }
}, {
    matchJSONValue: function(obj) {
        return _.has(obj, "$InfNaN") && 1 === _.size(obj);
    },
    matchObject: isInfOrNan,
    toJSONValue: function(obj) {
        var sign;
        sign = _.isNaN(obj) ? 0 : 1/0 === obj ? 1 : -1;
        return {
            $InfNaN: sign
        };
    },
    fromJSONValue: function(obj) {
        return obj.$InfNaN / 0;
    }
}, {
    matchJSONValue: function(obj) {
        return _.has(obj, "$binary") && 1 === _.size(obj);
    },
    matchObject: function(obj) {
        return "undefined" != typeof Uint8Array && obj instanceof Uint8Array || obj && _.has(obj, "$Uint8ArrayPolyfill");
    },
    toJSONValue: function(obj) {
        return {
            $binary: base64Encode(obj)
        };
    },
    fromJSONValue: function(obj) {
        return base64Decode(obj.$binary);
    }
}, {
    matchJSONValue: function(obj) {
        return _.has(obj, "$escape") && 1 === _.size(obj);
    },
    matchObject: function(obj) {
        if (_.isEmpty(obj) || _.size(obj) > 2) return false;
        return _.any(builtinConverters, function(converter) {
            return converter.matchJSONValue(obj);
        });
    },
    toJSONValue: function(obj) {
        var newObj = {};
        _.each(obj, function(value, key) {
            newObj[key] = EJSON.toJSONValue(value);
        });
        return {
            $escape: newObj
        };
    },
    fromJSONValue: function(obj) {
        var newObj = {};
        _.each(obj.$escape, function(value, key) {
            newObj[key] = EJSON.fromJSONValue(value);
        });
        return newObj;
    }
}, {
    matchJSONValue: function(obj) {
        return _.has(obj, "$type") && _.has(obj, "$value") && 2 === _.size(obj);
    },
    matchObject: function(obj) {
        return EJSON._isCustomType(obj);
    },
    toJSONValue: function(obj) {
        var jsonValue = Meteor._noYieldsAllowed(function() {
            return obj.toJSONValue();
        });
        return {
            $type: obj.typeName(),
            $value: jsonValue
        };
    },
    fromJSONValue: function(obj) {
        var typeName = obj.$type;
        if (!_.has(customTypes, typeName)) throw new Error("Custom EJSON type " + typeName + " is not defined");
        var converter = customTypes[typeName];
        return Meteor._noYieldsAllowed(function() {
            return converter(obj.$value);
        });
    }
} ];

EJSON._isCustomType = function(obj) {
    return obj && "function" == typeof obj.toJSONValue && "function" == typeof obj.typeName && _.has(customTypes, obj.typeName());
};

var adjustTypesToJSONValue = EJSON._adjustTypesToJSONValue = function(obj) {
    if (null === obj) return null;
    var maybeChanged = toJSONValueHelper(obj);
    if (void 0 !== maybeChanged) return maybeChanged;
    if ("object" != typeof obj) return obj;
    _.each(obj, function(value, key) {
        if ("object" != typeof value && void 0 !== value && !isInfOrNan(value)) return;
        var changed = toJSONValueHelper(value);
        if (changed) {
            obj[key] = changed;
            return;
        }
        adjustTypesToJSONValue(value);
    });
    return obj;
};

var toJSONValueHelper = function(item) {
    for (var i = 0; builtinConverters.length > i; i++) {
        var converter = builtinConverters[i];
        if (converter.matchObject(item)) return converter.toJSONValue(item);
    }
    return void 0;
};

EJSON.toJSONValue = function(item) {
    var changed = toJSONValueHelper(item);
    if (void 0 !== changed) return changed;
    if ("object" == typeof item) {
        item = EJSON.clone(item);
        adjustTypesToJSONValue(item);
    }
    return item;
};

var adjustTypesFromJSONValue = EJSON._adjustTypesFromJSONValue = function(obj) {
    if (null === obj) return null;
    var maybeChanged = fromJSONValueHelper(obj);
    if (maybeChanged !== obj) return maybeChanged;
    if ("object" != typeof obj) return obj;
    _.each(obj, function(value, key) {
        if ("object" == typeof value) {
            var changed = fromJSONValueHelper(value);
            if (value !== changed) {
                obj[key] = changed;
                return;
            }
            adjustTypesFromJSONValue(value);
        }
    });
    return obj;
};

var fromJSONValueHelper = function(value) {
    if ("object" == typeof value && null !== value && 2 >= _.size(value) && _.all(value, function(v, k) {
        return "string" == typeof k && "$" === k.substr(0, 1);
    })) for (var i = 0; builtinConverters.length > i; i++) {
        var converter = builtinConverters[i];
        if (converter.matchJSONValue(value)) return converter.fromJSONValue(value);
    }
    return value;
};

EJSON.fromJSONValue = function(item) {
    var changed = fromJSONValueHelper(item);
    if (changed === item && "object" == typeof item) {
        item = EJSON.clone(item);
        adjustTypesFromJSONValue(item);
        return item;
    }
    return changed;
};

EJSON.stringify = function(item, options) {
    var json = EJSON.toJSONValue(item);
    return options && (options.canonical || options.indent) ? EJSON._canonicalStringify(json, options) : JSON.stringify(json);
};

EJSON.parse = function(item) {
    if ("string" != typeof item) throw new Error("EJSON.parse argument should be a string");
    return EJSON.fromJSONValue(JSON.parse(item));
};

EJSON.isBinary = function(obj) {
    return !!("undefined" != typeof Uint8Array && obj instanceof Uint8Array || obj && obj.$Uint8ArrayPolyfill);
};

EJSON.equals = function(a, b, options) {
    var i;
    var keyOrderSensitive = !!(options && options.keyOrderSensitive);
    if (a === b) return true;
    if (_.isNaN(a) && _.isNaN(b)) return true;
    if (!a || !b) return false;
    if (!("object" == typeof a && "object" == typeof b)) return false;
    if (a instanceof Date && b instanceof Date) return a.valueOf() === b.valueOf();
    if (EJSON.isBinary(a) && EJSON.isBinary(b)) {
        if (a.length !== b.length) return false;
        for (i = 0; a.length > i; i++) if (a[i] !== b[i]) return false;
        return true;
    }
    if ("function" == typeof a.equals) return a.equals(b, options);
    if ("function" == typeof b.equals) return b.equals(a, options);
    if (a instanceof Array) {
        if (!(b instanceof Array)) return false;
        if (a.length !== b.length) return false;
        for (i = 0; a.length > i; i++) if (!EJSON.equals(a[i], b[i], options)) return false;
        return true;
    }
    switch (EJSON._isCustomType(a) + EJSON._isCustomType(b)) {
      case 1:
        return false;

      case 2:
        return EJSON.equals(EJSON.toJSONValue(a), EJSON.toJSONValue(b));
    }
    var ret;
    if (keyOrderSensitive) {
        var bKeys = [];
        _.each(b, function(val, x) {
            bKeys.push(x);
        });
        i = 0;
        ret = _.all(a, function(val, x) {
            if (i >= bKeys.length) return false;
            if (x !== bKeys[i]) return false;
            if (!EJSON.equals(val, b[bKeys[i]], options)) return false;
            i++;
            return true;
        });
        return ret && i === bKeys.length;
    }
    i = 0;
    ret = _.all(a, function(val, key) {
        if (!_.has(b, key)) return false;
        if (!EJSON.equals(val, b[key], options)) return false;
        i++;
        return true;
    });
    return ret && _.size(b) === i;
};

EJSON.clone = function(v) {
    var ret;
    if ("object" != typeof v) return v;
    if (null === v) return null;
    if (v instanceof Date) return new Date(v.getTime());
    if (v instanceof RegExp) return v;
    if (EJSON.isBinary(v)) {
        ret = EJSON.newBinary(v.length);
        for (var i = 0; v.length > i; i++) ret[i] = v[i];
        return ret;
    }
    if (_.isArray(v) || _.isArguments(v)) {
        ret = [];
        for (i = 0; v.length > i; i++) ret[i] = EJSON.clone(v[i]);
        return ret;
    }
    if ("function" == typeof v.clone) return v.clone();
    if (EJSON._isCustomType(v)) return EJSON.fromJSONValue(EJSON.clone(EJSON.toJSONValue(v)), true);
    ret = {};
    _.each(v, function(value, key) {
        ret[key] = EJSON.clone(value);
    });
    return ret;
};

exports.EJSON = EJSON;