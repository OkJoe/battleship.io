var express = require('express'); 
var app = express(); 
var serv = require('http').Server(app); 

//Utility 
var mod = function(a,b){
	return (a%b+b)%b; 
}; 

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

var mapInfo = {size:{x:10000, y:10000}}; 

var physics = {dccFactor:0.1, directionRecoverFactor:1-Math.pow((1-0.9),1/fps)}; 

var SOCKET_LIST = {}; 
var SHIP_LIST = {}; 

var Entity = function(){
	var self = {
		id: Math.random().toString(), 
		x:0, 
		y:0, 
		direction:0, 
		speed:0
	}; 
	self.updatePosition = function(){
		this.x += this.speed*Math.cos(this.direction)/fps; 
		this.y += this.speed*Math.sin(this.direction)/fps; 
		this.x = mod(this.x, mapInfo.size.x); 
		this.y = mod(this.y, mapInfo.size.y); 
	}; 
	return self; 
}; 

//Ship 

var Ship = function(name){
	var self = Entity();   
	self.name = name; 
	self.x = Math.floor(Math.random()*mapInfo.size.x); 
	self.y = Math.floor(Math.random()*mapInfo.size.y); 
	self.bearing = 0; 
	self.turnCurv = 0; 
	self.stats = {
		acc: 500*physics.dccFactor, //max speed * dccFactor
		rudderShift: 2, 
		rudderRange: 1/500 //1 / turning radius 
	}; 
	self.control = {
		pressingLeft: false, 
		pressingRight: false, 
		pressingAcc: false, 
		pressingReverse: false
	};
	self.updateTurnCurv = function(){
		if (this.control.pressingLeft){
			if (!this.control.pressingRight)
			this.turnCurv += this.stats.rudderRange/this.stats.rudderShift/fps; 
			if (this.turnCurv > this.stats.rudderRange)
				this.turnCurv = this.stats.rudderRange; 
		} else if (this.control.pressingRight){
			this.turnCurv -= this.stats.rudderRange/this.stats.rudderShift/fps; 
			if (this.turnCurv < -this.stats.rudderRange)
				this.turnCurv = -this.stats.rudderRange; 
		} else {
			this.turnCurv -= Math.sign(this.turnCurv)*this.stats.rudderRange/this.stats.rudderShift/fps; 
			if (this.turnCurv > this.stats.rudderRange) {console.log(this.turnCurv); }
		}
	}; 
	self.updateSpeed = function(){
		var speedIncrease = 0; 
		if (this.control.pressingAcc){
			speedIncrease += this.stats.acc; 
		} else if (this.speed > 0 || this.control.pressingReverse){
			speedIncrease -= this.stats.acc/4; 
		}
		speedIncrease -= this.speed*physics.dccFactor; 
		this.speed += speedIncrease/fps; 
		if (Math.abs(this.speed) < 0.01) {this.speed = 0;}
	}; 
	self.updateDirection = function(){
		this.bearing += this.speed*this.turnCurv/fps; 
		this.bearing = mod(this.bearing, 2*Math.PI); 
	}; 
	self.updateVelocityDirection = function(){
		if (this.bearing-this.direction>Math.PI) {
			this.direction += physics.directionRecoverFactor*(this.bearing-2*Math.PI-this.direction); 
			this.direction = mod(this.direction, 2*Math.PI); 
		} else if (this.bearing-this.direction<-Math.PI) {
			this.direction += physics.directionRecoverFactor*(this.bearing+2*Math.PI-this.direction); 
			this.direction = mod(this.direction, 2*Math.PI); 
		} else {
			this.direction += physics.directionRecoverFactor*(this.bearing-this.direction); 
		}
	}; 
	self.update = function(){
		this.updateTurnCurv(); 
		this.updateSpeed(); 
		this.updatePosition(); 
		this.updateDirection(); 
		this.updateVelocityDirection(); 
	}; 
	return self; 
}; 

//Connection, handles all packages from and to the client 

var io = require('socket.io')(serv, {}); 
io.sockets.on('connection', function(socket){
	
	console.log('New connection'); 
	
	//Sign up, check if name exist, add to SOCKET_LIST 
	socket.on('signUp', function(data){
		if (data.name in SOCKET_LIST){
			socket.emit('signUpResponse', {success:false, msg:'name exists, please try another one. '}); 
		} else {
			socket.name = data.name; 
			SOCKET_LIST[socket.name] = socket; 
			console.log('New player ' + SOCKET_LIST[socket.name].name + ' added'); 
			
			var ship = Ship(socket.name); 
			SHIP_LIST[socket.name] = ship; 
			console.log('New ship ' + SHIP_LIST[socket.name].name + ' added'); 
			
			socket.emit('signUpResponse', {success:true, mapInfo:mapInfo}); 
		}
	}); 
	
	socket.on('disconnect', function(){
		delete SOCKET_LIST[socket.name]; 
		delete SHIP_LIST[socket.name]; 
		console.log('Player and ship ' + socket.name + ' disconnected and removed'); 
	}); 
	
	socket.on('keyPress', function(data){
		SHIP_LIST[socket.name].control['pressing' + data.inputId] = data.state; 
	}); 
}); 


setInterval(function(){
	var objList = []; 
	
	for(var i in SHIP_LIST){
		var ship = SHIP_LIST[i]; 
		ship.update(); 
		objList.push({name:ship.name, x:ship.x, y:ship.y, bearing:ship.bearing}); 
	}
	
	for(var i in SOCKET_LIST){
		var socket = SOCKET_LIST[i]; 
		//console.log(objList); 
		socket.emit('newPosition', {objList:objList}); 
	}

}, 1000/fps);