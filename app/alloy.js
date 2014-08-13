var TiMeteor = require('ti.meteor/meteor');
_ = TiMeteor._;

Meteor = TiMeteor.Meteor;
Package = TiMeteor.Package;
Deps = TiMeteor.Deps;
Session = TiMeteor.Session;
Accounts = TiMeteor.Accounts;

// add ti.meteor specific plugins

TiMeteor.WebView = require('ti.meteor/plugins/webview');

// initialize Meteor and connect to your server
TiMeteor.init({
    host: "192.168.0.70",
    port: 3000,
    use_ssl: false
});


