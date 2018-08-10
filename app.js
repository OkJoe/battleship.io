var express = require('express'); 
var app = express(); 
var serv = require('http').Server(app); 

//Setup 

app.get('/', function(req, res) {
	res.sendFile(__dirname + '/client/index.html'); 
}); 
app.use('/client', express.static(__dirname + '/client')); 

serv.listen(3000); 
console.log('server started'); 

//Initialize basic variables 

var DEBUG = true; 

var fps = 25; 

var mapInfo = {size:{x:500, y:500}}; 

var SOCKET_LIST = {}; 
var SHIP_LIST = {}; 

//Ship 

var Ship = function(nickname){
	var self = {
		nickname:nickname, 
		x:Math.floor(Math.random()*mapInfo.size.x), 
		y:Math.floor(Math.random()*mapInfo.size.y)
	}; 
	return self; 
}; 

//Connection, handles all packages from and to the client 

var io = require('socket.io')(serv, {}); 
io.sockets.on('connection', function(socket){
	
	console.log('New connection'); 
	
	//Sign up, check if nickname exist, add to SOCKET_LIST 
	socket.on('signUp', function(data){
		if (data.nickname in SOCKET_LIST){
			socket.emit('signUpResponse', {success:false, msg:'Nickname exists, please try another one. '}); 
		} else {
			socket.nickname = data.nickname; 
			SOCKET_LIST[socket.nickname] = socket; 
			console.log('New player ' + SOCKET_LIST[socket.nickname].nickname + ' added'); 
			
			var ship = Ship(socket.nickname); 
			SHIP_LIST[socket.nickname] = ship; 
			console.log('New ship ' + SHIP_LIST[socket.nickname].nickname + ' added'); 
			
			socket.emit('signUpResponse', {success:true}); 
		}
	}); 
	
	socket.on('disconnect', function(){
		delete SOCKET_LIST[socket.nickname]; 
		delete SHIP_LIST[socket.nickname]; 
		console.log('Player and ship ' + socket.nickname + ' disconnected and removed'); 
	}); 
	
}); 


setInterval(function(){
	var objList = []; 
	
	for(var i in SHIP_LIST){
		var ship = SHIP_LIST[i]; 
		objList.push({name:ship.nickname, x:ship.x, y:ship.y}); 
	}
	
	for(var i in SOCKET_LIST){
		var socket = SOCKET_LIST[i]; 
		//console.log(objList); 
		socket.emit('newPosition', {mapInfo:mapInfo, objList:objList}); 
	}

}, 1000/fps);