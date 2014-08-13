function random(nBytes) {
    var words = [];
    for (var i = 0; nBytes > i; i += 4) words.push(0 | 4294967296 * Math.random());
    return words;
}

var nodeCrypto = {
    randomBytes: random,
    pseudoRandomBytes: random
};

var Alea = function() {
    function Mash() {
        var n = 4022871197;
        var mash = function(data) {
            data = data.toString();
            for (var i = 0; data.length > i; i++) {
                n += data.charCodeAt(i);
                var h = .02519603282416938 * n;
                n = h >>> 0;
                h -= n;
                h *= n;
                n = h >>> 0;
                h -= n;
                n += 4294967296 * h;
            }
            return 2.3283064365386963e-10 * (n >>> 0);
        };
        mash.version = "Mash 0.9";
        return mash;
    }
    return function(args) {
        var s0 = 0;
        var s1 = 0;
        var s2 = 0;
        var c = 1;
        0 == args.length && (args = [ +new Date() ]);
        var mash = Mash();
        s0 = mash(" ");
        s1 = mash(" ");
        s2 = mash(" ");
        for (var i = 0; args.length > i; i++) {
            s0 -= mash(args[i]);
            0 > s0 && (s0 += 1);
            s1 -= mash(args[i]);
            0 > s1 && (s1 += 1);
            s2 -= mash(args[i]);
            0 > s2 && (s2 += 1);
        }
        mash = null;
        var random = function() {
            var t = 2091639 * s0 + 2.3283064365386963e-10 * c;
            s0 = s1;
            s1 = s2;
            return s2 = t - (c = 0 | t);
        };
        random.uint32 = function() {
            return 4294967296 * random();
        };
        random.fract53 = function() {
            return random() + 1.1102230246251565e-16 * (0 | 2097152 * random());
        };
        random.version = "Alea 0.9";
        random.args = args;
        return random;
    }(Array.prototype.slice.call(arguments));
};

var UNMISTAKABLE_CHARS = "23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz";

var BASE64_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

var RandomGenerator = function(seedArray) {
    var self = this;
    void 0 !== seedArray && (self.alea = Alea.apply(null, seedArray));
};

RandomGenerator.prototype.fraction = function() {
    var self = this;
    if (self.alea) return self.alea();
    if (nodeCrypto) {
        var numerator = parseInt(self.hexString(8), 16);
        return 2.3283064365386963e-10 * numerator;
    }
    if ("undefined" != typeof window && window.crypto && window.crypto.getRandomValues) {
        var array = new Uint32Array(1);
        window.crypto.getRandomValues(array);
        return 2.3283064365386963e-10 * array[0];
    }
    throw new Error("No random generator available");
};

RandomGenerator.prototype.hexString = function(digits) {
    var self = this;
    if (nodeCrypto && !self.alea) {
        var numBytes = Math.ceil(digits / 2);
        var bytes;
        try {
            bytes = nodeCrypto.randomBytes(numBytes);
        } catch (e) {
            bytes = nodeCrypto.pseudoRandomBytes(numBytes);
        }
        var result = bytes.toString("hex");
        return result.substring(0, digits);
    }
    var hexDigits = [];
    for (var i = 0; digits > i; ++i) hexDigits.push(self.choice("0123456789abcdef"));
    return hexDigits.join("");
};

RandomGenerator.prototype._randomString = function(charsCount, alphabet) {
    var self = this;
    var digits = [];
    for (var i = 0; charsCount > i; i++) digits[i] = self.choice(alphabet);
    return digits.join("");
};

RandomGenerator.prototype.id = function(charsCount) {
    var self = this;
    void 0 === charsCount && (charsCount = 17);
    return self._randomString(charsCount, UNMISTAKABLE_CHARS);
};

RandomGenerator.prototype.secret = function(charsCount) {
    var self = this;
    void 0 === charsCount && (charsCount = 43);
    return self._randomString(charsCount, BASE64_CHARS);
};

RandomGenerator.prototype.choice = function(arrayOrString) {
    var index = Math.floor(this.fraction() * arrayOrString.length);
    return "string" == typeof arrayOrString ? arrayOrString.substr(index, 1) : arrayOrString[index];
};

var height = "undefined" != typeof window && window.innerHeight || "undefined" != typeof document && document.documentElement && document.documentElement.clientHeight || "undefined" != typeof document && document.body && document.body.clientHeight || 1;

var width = "undefined" != typeof window && window.innerWidth || "undefined" != typeof document && document.documentElement && document.documentElement.clientWidth || "undefined" != typeof document && document.body && document.body.clientWidth || 1;

var agent = "undefined" != typeof navigator && navigator.userAgent || "";

Random = nodeCrypto || "undefined" != typeof window && window.crypto && window.crypto.getRandomValues ? new RandomGenerator() : new RandomGenerator([ new Date(), height, width, agent, Math.random() ]);

Random.createWithSeeds = function() {
    if (0 === arguments.length) throw new Error("No seeds were provided");
    return new RandomGenerator(arguments);
};

exports.Random = Random;