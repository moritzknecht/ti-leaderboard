Meteor.loginWithPassword = function(selector, password, callback) {
    "string" == typeof selector && (selector = -1 === selector.indexOf("@") ? {
        username: selector
    } : {
        email: selector
    });
    Accounts.callLoginMethod({
        methodArguments: [ {
            user: selector,
            password: hashPassword(password)
        } ],
        userCallback: function(error) {
            error && 400 === error.error && "old password format" === error.reason ? srpUpgradePath({
                upgradeError: error,
                userSelector: selector,
                plaintextPassword: password
            }, callback) : error ? callback && callback(error) : callback && callback();
        }
    });
};

var hashPassword = function(password) {
    return {
        digest: Titanium.Utils.sha256(password),
        algorithm: "sha-256"
    };
};

var srpUpgradePath = function(options, callback) {
    var details;
    try {
        details = EJSON.parse(options.upgradeError.details);
    } catch (e) {}
    details && "srp" === details.format ? Accounts.callLoginMethod({
        methodArguments: [ {
            user: options.userSelector,
            srp: SHA256(details.identity + ":" + options.plaintextPassword),
            password: hashPassword(options.plaintextPassword)
        } ],
        userCallback: callback
    }) : callback && callback(new Meteor.Error(400, "Password is old. Please reset your password."));
};

Accounts.createUser = function(options, callback) {
    options = _.clone(options);
    if ("string" != typeof options.password) throw new Error("Must set options.password");
    if (!options.password) {
        callback(new Meteor.Error(400, "Password may not be empty"));
        return;
    }
    options.password = hashPassword(options.password);
    Accounts.callLoginMethod({
        methodName: "createUser",
        methodArguments: [ options ],
        userCallback: callback
    });
};

Accounts.changePassword = function(oldPassword, newPassword, callback) {
    if (!Meteor.user()) {
        callback && callback(new Error("Must be logged in to change password."));
        return;
    }
    check(newPassword, String);
    if (!newPassword) {
        callback(new Meteor.Error(400, "Password may not be empty"));
        return;
    }
    Accounts.connection.apply("changePassword", [ oldPassword ? hashPassword(oldPassword) : null, hashPassword(newPassword) ], function(error, result) {
        error || !result ? error && 400 === error.error && "old password format" === error.reason ? srpUpgradePath({
            upgradeError: error,
            userSelector: {
                id: Meteor.userId()
            },
            plaintextPassword: oldPassword
        }, function(err) {
            err ? callback && callback(err) : Accounts.changePassword(oldPassword, newPassword, callback);
        }) : callback && callback(error || new Error("No result from changePassword.")) : callback && callback();
    });
};

Accounts.forgotPassword = function(options, callback) {
    if (!options.email) throw new Error("Must pass options.email");
    Accounts.connection.call("forgotPassword", options, callback);
};

Accounts.resetPassword = function(token, newPassword, callback) {
    check(token, String);
    check(newPassword, String);
    if (!newPassword) {
        callback(new Meteor.Error(400, "Password may not be empty"));
        return;
    }
    Accounts.callLoginMethod({
        methodName: "resetPassword",
        methodArguments: [ token, hashPassword(newPassword) ],
        userCallback: callback
    });
};

Accounts.verifyEmail = function(token, callback) {
    if (!token) throw new Error("Need to pass token");
    Accounts.callLoginMethod({
        methodName: "verifyEmail",
        methodArguments: [ token ],
        userCallback: callback
    });
};