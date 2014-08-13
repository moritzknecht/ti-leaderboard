Accounts = {};

Accounts._options = {};

var DEFAULT_LOGIN_EXPIRATION_DAYS = 90;

var MIN_TOKEN_LIFETIME_CAP_SECS = 3600;

EXPIRE_TOKENS_INTERVAL_MS = 6e5;

CONNECTION_CLOSE_DELAY_MS = 1e4;

Accounts.config = function(options) {
    Meteor.isServer ? __meteor_runtime_config__.accountsConfigCalled = true : __meteor_runtime_config__.accountsConfigCalled || Meteor._debug("Accounts.config was called on the client but not on the server; some configuration options may not take effect.");
    if (_.has(options, "oauthSecretKey")) {
        if (Meteor.isClient) throw new Error("The oauthSecretKey option may only be specified on the server");
        if (!Package["oauth-encryption"]) throw new Error("The oauth-encryption package must be loaded to set oauthSecretKey");
        Package["oauth-encryption"].OAuthEncryption.loadKey(options.oauthSecretKey);
        options = _.omit(options, "oauthSecretKey");
    }
    var VALID_KEYS = [ "sendVerificationEmail", "forbidClientAccountCreation", "restrictCreationByEmailDomain", "loginExpirationInDays" ];
    _.each(_.keys(options), function(key) {
        if (!_.contains(VALID_KEYS, key)) throw new Error("Accounts.config: Invalid key: " + key);
    });
    _.each(VALID_KEYS, function(key) {
        if (key in options) {
            if (key in Accounts._options) throw new Error("Can't set `" + key + "` more than once");
            Accounts._options[key] = options[key];
        }
    });
    Meteor.isServer && maybeStopExpireTokensInterval();
};

if (Meteor.isClient) {
    Accounts.connection = Meteor.connection;
    "undefined" != typeof __meteor_runtime_config__ && __meteor_runtime_config__.ACCOUNTS_CONNECTION_URL && (Accounts.connection = DDP.connect(__meteor_runtime_config__.ACCOUNTS_CONNECTION_URL));
}

Meteor.users = new Meteor.Collection("users", {
    _preventAutopublish: true,
    connection: Meteor.isClient ? Accounts.connection : Meteor.connection
});

Accounts.LoginCancelledError = function(description) {
    this.message = description;
};

Accounts.LoginCancelledError.numericError = 145546287;

Accounts.LoginCancelledError.prototype = new Error();

Accounts.LoginCancelledError.prototype.name = "Accounts.LoginCancelledError";

getTokenLifetimeMs = function() {
    return 1e3 * 60 * 60 * 24 * (Accounts._options.loginExpirationInDays || DEFAULT_LOGIN_EXPIRATION_DAYS);
};

Accounts._tokenExpiration = function(when) {
    return new Date(new Date(when).getTime() + getTokenLifetimeMs());
};

Accounts._tokenExpiresSoon = function(when) {
    var minLifetimeMs = .1 * getTokenLifetimeMs();
    var minLifetimeCapMs = 1e3 * MIN_TOKEN_LIFETIME_CAP_SECS;
    minLifetimeMs > minLifetimeCapMs && (minLifetimeMs = minLifetimeCapMs);
    return new Date() > new Date(when) - minLifetimeMs;
};