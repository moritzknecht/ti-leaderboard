var Players = new Meteor.Collection("players");
var items = [];

function onItemclick(e) {
	console.log("onItemclick: e = "+JSON.stringify(e));
 	var id = items[e.itemIndex]._id;
 	Players.update(id, {$inc: {score: 5}});
}

var dep = Deps.autorun(function() {

	items = [];
	var players = Players.find({}, {sort:{score:-1}}, {limit:1}).fetch();

	_.each(players, function(player) {
		items.push({
			template:"player",
			name: {
				text:player.name
			},
			score: {
				text:player.score
			},
			_id:player._id
		});
	});	

	$.players.setItems(items);
	$.list.setSections([$.players]);
});

Meteor.subscribe("players");

$.index.open();
