Meteor.userId = function() {
    return Accounts.connection.userId();
};

var loggingIn = false;

var loggingInDeps = new Deps.Dependency();

Accounts._setLoggingIn = function(x) {
    if (loggingIn !== x) {
        loggingIn = x;
        loggingInDeps.changed();
    }
};

Meteor.loggingIn = function() {
    loggingInDeps.depend();
    return loggingIn;
};

Meteor.user = function() {
    var userId = Meteor.userId();
    if (!userId) return null;
    return Meteor.users.findOne(userId);
};

Accounts.callLoginMethod = function(options) {
    options = _.extend({
        methodName: "login",
        methodArguments: [],
        _suppressLoggingIn: false
    }, options);
    _.each([ "validateResult", "userCallback" ], function(f) {
        options[f] || (options[f] = function() {});
    });
    var onceUserCallback = _.once(options.userCallback);
    var reconnected = false;
    var onResultReceived = function(err, result) {
        Accounts.connection.onReconnect = !err && result && result.token ? function() {
            reconnected = true;
            var storedToken = storedLoginToken();
            storedToken && (result = {
                token: storedToken,
                tokenExpires: storedLoginTokenExpires()
            });
            result.tokenExpires || (result.tokenExpires = Accounts._tokenExpiration(new Date()));
            Accounts._tokenExpiresSoon(result.tokenExpires) ? makeClientLoggedOut() : Accounts.callLoginMethod({
                methodArguments: [ {
                    resume: result.token
                } ],
                _suppressLoggingIn: true,
                userCallback: function(error) {
                    var storedTokenNow = storedLoginToken();
                    error && storedTokenNow && storedTokenNow === result.token && makeClientLoggedOut();
                    onceUserCallback(error);
                }
            });
        } : null;
    };
    var loggedInAndDataReadyCallback = function(error, result) {
        if (reconnected) return;
        Accounts._setLoggingIn(false);
        if (error || !result) {
            error = error || new Error("No result from call to " + options.methodName);
            onceUserCallback(error);
            return;
        }
        try {
            options.validateResult(result);
        } catch (e) {
            onceUserCallback(e);
            return;
        }
        makeClientLoggedIn(result.id, result.token, result.tokenExpires);
        onceUserCallback();
    };
    options._suppressLoggingIn || Accounts._setLoggingIn(true);
    Accounts.connection.apply(options.methodName, options.methodArguments, {
        wait: true,
        onResultReceived: onResultReceived
    }, loggedInAndDataReadyCallback);
};

makeClientLoggedOut = function() {
    unstoreLoginToken();
    Accounts.connection.setUserId(null);
    Accounts.connection.onReconnect = null;
};

makeClientLoggedIn = function(userId, token, tokenExpires) {
    storeLoginToken(userId, token, tokenExpires);
    Accounts.connection.setUserId(userId);
};

Meteor.logout = function(callback) {
    Accounts.connection.apply("logout", [], {
        wait: true
    }, function(error) {
        if (error) callback && callback(error); else {
            makeClientLoggedOut();
            callback && callback();
        }
    });
};

Meteor.logoutOtherClients = function(callback) {
    Accounts.connection.apply("getNewToken", [], {
        wait: true
    }, function(err, result) {
        err || storeLoginToken(Meteor.userId(), result.token, result.tokenExpires);
    });
    Accounts.connection.apply("removeOtherTokens", [], {
        wait: true
    }, function(err) {
        callback && callback(err);
    });
};

Accounts.loginServicesConfigured = function() {
    return loginServicesHandle.ready();
};

if (Package.ui) {
    Package.ui.UI.registerHelper("currentUser", function() {
        return Meteor.user();
    });
    Package.ui.UI.registerHelper("loggingIn", function() {
        return Meteor.loggingIn();
    });
}